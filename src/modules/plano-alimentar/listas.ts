import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { fkViolation, uniqueViolation } from '@/db/errors';
import { listasSubstituicao, listasSubstituicaoGrupos, listasSubstituicaoItens } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { idValido } from '@/modules/pacientes/base';
import { alimentosInvisiveis, itensComValoresAtuais, lerItem, travarConsultorio, type ItemLido } from './biblioteca';
import {
  MAX_GRUPOS_LISTA, MAX_ITENS_GRUPO, MAX_LISTAS, MSG_LISTAS, NOME_GRUPO_MAX, NOME_LISTA_MAX, ORIENTACAO_LISTA_MAX, type ListaDaBiblioteca,
} from './biblioteca-constantes';
import { nutrientesDoItem } from './calculo';
import { MSG_PLANO } from './constantes';
import type { ItemPlano } from './tipos';

/**
 * RN-251 (Plano 19, US-238, D22): listas de substituição do consultório (`listas_substituicao`, `_grupos`, `_itens`;
 * `staff_only`, sem paciente e sem gatilho de auditoria). A plataforma não traz listas prontas. A energia de cada item
 * é calculada na hora (valores atuais, RN-11); o plano guarda uma cópia na ligação (RN-252, Tarefa 9), então editar ou
 * excluir a lista não muda plano nenhum. Nome, orientação e nome do grupo nunca vão para log nem para a mensagem.
 */

export class ListaError extends Error {
  override name = 'ListaError';
  constructor(readonly erros: Record<string, string>) {
    super('Lista de substituição inválida');
  }
}

/** Item da lista com os valores atuais e a energia da quantidade (nula sem kcal na fonte). */
export type ItemDaLista = ItemPlano & { kcal: number | null };
export type Lista = { id: string; nome: string; orientacao: string; grupos: { id: string; nome: string; itens: ItemDaLista[] }[] };

type GrupoValido = { nome: string; itens: ItemLido[] };
type Validada = { nome: string; orientacao: string; grupos: GrupoValido[] };

/**
 * RN-251: nome 1 a 80, orientação até 1000, de 1 a 20 grupos (nome 1 a 60) com 1 a 30 itens cada (quantidade 0,1 a
 * 5000 g ou medida caseira, como `meal_items`). Erros por campo: `nome`, `orientacao`, `grupo:<id>:nome`,
 * `grupo:<id>:itens` e os do item (`item:<id>:…`, as chaves do editor); nada é gravado.
 */
function validar(entrada: unknown): Validada {
  const o = (entrada ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object' || !Array.isArray(o.grupos)) throw new ListaError({ geral: MSG_PLANO.invalido });
  const brutos = o.grupos as Record<string, unknown>[];
  if (brutos.length > MAX_GRUPOS_LISTA || brutos.some((g) => Array.isArray(g?.itens) && g.itens.length > MAX_ITENS_GRUPO)) throw new ListaError({ geral: MSG_LISTAS.limite });
  const erros: Record<string, string> = {};
  const nome = normalizarTexto(o.nome);
  if (!nome || nome.length > NOME_LISTA_MAX) erros.nome = MSG_LISTAS.nome;
  const orientacao = typeof o.orientacao === 'string' ? o.orientacao.trim() : '';
  if (orientacao.length > ORIENTACAO_LISTA_MAX) erros.orientacao = MSG_LISTAS.orientacao;
  if (!brutos.length) erros.geral = MSG_LISTAS.semGrupo;

  const ids = new Set<string>();
  const novo = (id: unknown) => {
    if (!idValido(id) || ids.has(id)) throw new ListaError({ geral: MSG_PLANO.invalido });
    ids.add(id);
  };
  const grupos: GrupoValido[] = [];
  for (const g of brutos) {
    novo(g?.id);
    if (!Array.isArray(g.itens)) throw new ListaError({ geral: MSG_PLANO.invalido });
    const nomeGrupo = normalizarTexto(g.nome);
    if (!nomeGrupo || nomeGrupo.length > NOME_GRUPO_MAX) erros[`grupo:${g.id}:nome`] = MSG_LISTAS.grupoNome;
    if (!g.itens.length) erros[`grupo:${g.id}:itens`] = MSG_LISTAS.grupoVazio;
    const itens: ItemLido[] = [];
    for (const i of g.itens as Record<string, unknown>[]) {
      novo(i?.id);
      if (i.substituiItemId !== undefined && i.substituiItemId !== null) throw new ListaError({ geral: MSG_PLANO.invalido }); // a lista não tem substituição
      const lido = lerItem(i, erros);
      if (lido) itens.push(lido);
    }
    grupos.push({ nome: nomeGrupo, itens });
  }
  if (Object.keys(erros).length) throw new ListaError(erros);
  return { nome, orientacao, grupos };
}

async function gravarGrupos(tx: Tx, tenantId: string, listaId: string, grupos: GrupoValido[]): Promise<void> {
  const linhasGrupo = grupos.map((g, ordem) => ({ id: randomUUID(), tenantId, listaId, nome: g.nome, ordem }));
  if (!linhasGrupo.length) return;
  await tx.insert(listasSubstituicaoGrupos).values(linhasGrupo);
  const itens = grupos.flatMap((g, k) =>
    g.itens.map((i, ordem) => ({ tenantId, listaId, grupoId: linhasGrupo[k].id, foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida, ordem })),
  );
  if (itens.length) await tx.insert(listasSubstituicaoItens).values(itens);
}

async function conferirAlimentos(tx: Tx, v: Validada) {
  const invisiveis = await alimentosInvisiveis(tx, v.grupos.flatMap((g) => g.itens));
  if (Object.keys(invisiveis).length) throw new ListaError(invisiveis);
}

/**
 * US-238: cria (`id` nulo, "Nova lista") ou altera uma lista (os grupos e itens são regravados). Nome repetido no
 * consultório → erro no campo; até 100 listas por consultório, contadas com o tenant travado (sem TOCTOU).
 */
export async function salvarLista(ctx: TenantContext, id: string | null, entrada: unknown, deps: { db?: Db } = {}): Promise<{ id: string }> {
  if (id !== null && !idValido(id)) throw new ListaError({ geral: MSG_LISTAS.naoEncontrada });
  const v = validar(entrada);
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        await conferirAlimentos(tx, v);
        if (id === null) {
          await travarConsultorio(tx, ctx.tenantId);
          const existentes = await tx.select({ id: listasSubstituicao.id }).from(listasSubstituicao);
          if (existentes.length >= MAX_LISTAS) throw new ListaError({ geral: MSG_LISTAS.limiteConsultorio });
          const [l] = await tx.insert(listasSubstituicao).values({ tenantId: ctx.tenantId, nome: v.nome, orientacao: v.orientacao }).returning({ id: listasSubstituicao.id });
          await gravarGrupos(tx, ctx.tenantId, l.id, v.grupos);
          return l;
        }
        const [l] = await tx.update(listasSubstituicao).set({ nome: v.nome, orientacao: v.orientacao, updatedAt: new Date() }).where(eq(listasSubstituicao.id, id)).returning({ id: listasSubstituicao.id });
        if (!l) throw new ListaError({ geral: MSG_LISTAS.naoEncontrada });
        await tx.delete(listasSubstituicaoGrupos).where(eq(listasSubstituicaoGrupos.listaId, id)); // os itens saem em cascata
        await gravarGrupos(tx, ctx.tenantId, id, v.grupos);
        return l;
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'listas_substituicao_nome_unique') throw new ListaError({ nome: MSG_LISTAS.nomeRepetido });
    // o "Meu alimento" excluído entre a conferência e o INSERT (FK RESTRICT do item): o erro do alimento, não um 500
    if (fkViolation(e) !== null) throw new ListaError({ geral: MSG_PLANO.alimento });
    throw e;
  }
}

/** US-238: exclui a lista (grupos e itens em cascata). As cópias ligadas aos planos não mudam (RN-252). */
export async function excluirLista(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(id)) throw new ListaError({ geral: MSG_LISTAS.naoEncontrada });
  const apagadas = await withTenant(ctx, (tx) => tx.delete(listasSubstituicao).where(eq(listasSubstituicao.id, id)).returning({ id: listasSubstituicao.id }), deps.db ?? getDb());
  if (!apagadas.length) throw new ListaError({ geral: MSG_LISTAS.naoEncontrada });
}

/** US-238: as listas do consultório por nome, com quantos grupos e itens cada uma tem. */
export async function listarListas(ctx: TenantContext, db: Db = getDb()): Promise<ListaDaBiblioteca[]> {
  return withTenant(
    ctx,
    async (tx) => {
      const ls = await tx.select({ id: listasSubstituicao.id, nome: listasSubstituicao.nome }).from(listasSubstituicao).orderBy(asc(listasSubstituicao.nome));
      const gs = await tx.select({ listaId: listasSubstituicaoGrupos.listaId }).from(listasSubstituicaoGrupos);
      const is = await tx.select({ listaId: listasSubstituicaoItens.listaId }).from(listasSubstituicaoItens);
      const contar = (linhas: { listaId: string }[], id: string) => linhas.filter((x) => x.listaId === id).length;
      return ls.map((l) => ({ id: l.id, nome: l.nome, grupos: contar(gs, l.id), itens: contar(is, l.id) }));
    },
    db,
  );
}

/** A lista inteira (RLS: a de outro consultório não aparece), com a energia de cada item calculada agora. */
export async function carregarLista(ctx: TenantContext, id: string, db: Db = getDb()): Promise<Lista | null> {
  if (!idValido(id)) return null;
  return withTenant(ctx, (tx) => lerListaNaTransacao(tx, id), db);
}

/** `carregarLista` na transação de quem chama: também a cópia da lista ligada ao plano (RN-252, `ligados.ts`). */
export async function lerListaNaTransacao(tx: Tx, id: string): Promise<Lista | null> {
  if (!idValido(id)) return null;
  const [l] = await tx.select().from(listasSubstituicao).where(eq(listasSubstituicao.id, id));
  if (!l) return null;
  const gs = await tx.select().from(listasSubstituicaoGrupos).where(eq(listasSubstituicaoGrupos.listaId, id)).orderBy(asc(listasSubstituicaoGrupos.ordem));
  const its = gs.length
    ? await tx
        .select()
        .from(listasSubstituicaoItens)
        .where(inArray(listasSubstituicaoItens.grupoId, gs.map((g) => g.id)))
        .orderBy(asc(listasSubstituicaoItens.ordem))
    : [];
  const itens = await itensComValoresAtuais(tx, its.map((i) => ({ id: i.id, foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida ?? null, substituiItemId: null })));
  const grupoDoItem = new Map(its.map((i) => [i.id, i.grupoId]));
  const comKcal = (i: ItemPlano): ItemDaLista => {
    const n = nutrientesDoItem(i.porCem, i.quantidadeG);
    return { ...i, kcal: n.semValor.includes('kcal') ? null : n.kcal };
  };
  return {
    id: l.id,
    nome: l.nome,
    orientacao: l.orientacao,
    grupos: gs.map((g) => ({ id: g.id, nome: g.nome, itens: itens.filter((i) => grupoDoItem.get(i.id) === g.id).map(comKcal) })),
  };
}
