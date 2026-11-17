import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { fkViolation } from '@/db/errors';
import { refeicoesModelo, refeicoesModeloItens } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { idValido } from '@/modules/pacientes/base';
import { alimentosInvisiveis, itensComValoresAtuais, lerItem, travarConsultorio, type ItemLido } from './biblioteca';
import { MAX_ITENS_MINHA_REFEICAO, MAX_MINHAS_REFEICOES, MSG_MINHAS_REFEICOES, NOME_MINHA_REFEICAO_MAX, type MinhaRefeicaoDaLista } from './biblioteca-constantes';
import { itensComoTexto, totalDosItens } from './calculo';
import { MAX_TEXTO, MSG_PLANO } from './constantes';
import { TODOS_OS_DIAS } from './dias';
import { TIPOS_DE_REFEICAO, type TipoDeRefeicao } from './tipos-de-refeicao';
import type { ItemPlano, ModoPlano, RefeicaoPlano } from './tipos';

/**
 * RN-250 (Plano 19, US-237, D21): "Minhas refeições" — refeições do consultório (`refeicoes_modelo` e `_itens`,
 * `staff_only`, sem paciente e sem gatilho de auditoria) para carregar nos planos. Nascem só pelo editor ("Salvar como
 * minha refeição"), sem a observação, a não ser que a nutricionista marque "Incluir a observação" (LGPD, art. 6º,
 * III). A kcal é calculada na hora com os valores atuais (RN-11), sem cópia congelada. Nome, observação e texto livre
 * são da nutricionista e nunca vão para log nem para a mensagem de erro.
 */

export class RefeicaoModeloError extends Error {
  override name = 'RefeicaoModeloError';
  constructor(readonly erros: Record<string, string>) {
    super('Minha refeição inválida');
  }
}

/** A minha refeição inteira: na página dela (ids gravados) e na base do "Carregar" (que troca os ids). */
export type MinhaRefeicao = {
  id: string;
  nome: string;
  tipo: TipoDeRefeicao;
  horario: string;
  modo: ModoPlano;
  descricaoLivre: string | null;
  observacao: string;
  itens: ItemPlano[];
};

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;
const MODOS: readonly ModoPlano[] = ['calculado', 'livre'];
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');
const ehTipo = (t: unknown): t is TipoDeRefeicao => (TIPOS_DE_REFEICAO as readonly unknown[]).includes(t);

type ItemValido = ItemLido & { telaId: string; substituiTelaId: string | null };
type Validada = { nome: string; tipo: TipoDeRefeicao; horario: string | null; observacao: string; modo: ModoPlano; descricaoLivre: string | null; itens: ItemValido[] };

/**
 * RN-250: nome 1 a 60, tipo da lista `TIPOS_DE_REFEICAO`, horário opcional (HH:MM), observação até 2000; no modo
 * `calculado`, de 1 a 40 itens com as regras de `meal_items` (quantidade, medida, substituição ligada a um principal
 * da mesma refeição); no `livre`, o texto (1 a 2000) e nenhum item. Erros com as chaves do editor; nada é gravado.
 */
function validar(entrada: unknown): Validada {
  const o = (entrada ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object' || !MODOS.includes(o.modo as ModoPlano)) throw new RefeicaoModeloError({ geral: MSG_PLANO.invalido });
  const modo = o.modo as ModoPlano;
  const lista = o.itens === undefined || o.itens === null ? [] : o.itens;
  if (!Array.isArray(lista)) throw new RefeicaoModeloError({ geral: MSG_PLANO.invalido });
  if (lista.length > MAX_ITENS_MINHA_REFEICAO) throw new RefeicaoModeloError({ geral: MSG_MINHAS_REFEICOES.limiteItens });
  if (modo === 'livre' && lista.length) throw new RefeicaoModeloError({ geral: MSG_PLANO.invalido }); // RN-243: texto, não alimentos

  const erros: Record<string, string> = {};
  const nome = normalizarTexto(o.nome);
  if (!nome || nome.length > NOME_MINHA_REFEICAO_MAX) erros.nome = MSG_MINHAS_REFEICOES.nome;
  if (!ehTipo(o.tipo)) erros.tipo = MSG_MINHAS_REFEICOES.tipo;
  const horario = typeof o.horario === 'string' ? o.horario.trim() : '';
  if (horario && !HORARIO.test(horario)) erros.horario = MSG_PLANO.horario;
  const observacao = typeof o.observacao === 'string' ? o.observacao.trim() : '';
  if (observacao.length > MAX_TEXTO) erros.observacao = MSG_PLANO.texto;
  let descricaoLivre: string | null = null;
  if (modo === 'livre') {
    const texto = typeof o.descricaoLivre === 'string' ? o.descricaoLivre.trim() : '';
    if (texto.length > MAX_TEXTO) erros.descricaoLivre = MSG_PLANO.texto;
    else if (!texto) erros.descricaoLivre = MSG_MINHAS_REFEICOES.vazia;
    descricaoLivre = texto;
  } else if (!lista.length) erros.geral = MSG_MINHAS_REFEICOES.vazia;

  const ids = new Set<string>();
  const brutos = lista as Record<string, unknown>[];
  for (const i of brutos) {
    if (!idValido(i?.id) || ids.has(i.id)) throw new RefeicaoModeloError({ geral: MSG_PLANO.invalido });
    ids.add(i.id);
  }
  const principais = new Set(brutos.filter((i) => i.substituiItemId === null || i.substituiItemId === undefined).map((i) => i.id as string));
  const itens: ItemValido[] = [];
  for (const i of brutos) {
    const lido = lerItem(i, erros);
    const sub = (i.substituiItemId ?? null) as string | null;
    if (sub !== null && (sub === i.id || !principais.has(sub))) erros[`item:${i.id}:substituiItemId`] = MSG_PLANO.substituicao;
    if (lido) itens.push({ ...lido, telaId: i.id as string, substituiTelaId: sub });
  }
  if (Object.keys(erros).length) throw new RefeicaoModeloError(erros);
  return { nome, tipo: o.tipo as TipoDeRefeicao, horario: horario || null, observacao, modo, descricaoLivre, itens };
}

/** Itens com ids novos, principais antes das substituições (FK `refeicoes_modelo_itens_principal_fk`), na ordem da tela. */
async function gravarItens(tx: Tx, tenantId: string, refeicaoId: string, itens: ItemValido[]): Promise<void> {
  const novoId = new Map(itens.map((i) => [i.telaId, randomUUID()]));
  const linha = (i: ItemValido, ordem: number) => ({
    id: novoId.get(i.telaId)!, tenantId, refeicaoId, foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida,
    substituiItemId: i.substituiTelaId ? novoId.get(i.substituiTelaId)! : null, ordem,
  });
  const comOrdem = itens.map((i, ordem) => ({ i, ordem }));
  const principais = comOrdem.filter(({ i }) => !i.substituiTelaId).map(({ i, ordem }) => linha(i, ordem));
  const subs = comOrdem.filter(({ i }) => i.substituiTelaId).map(({ i, ordem }) => linha(i, ordem));
  if (principais.length) await tx.insert(refeicoesModeloItens).values(principais);
  if (subs.length) await tx.insert(refeicoesModeloItens).values(subs);
}

async function conferirAlimentos(tx: Tx, itens: ItemValido[]) {
  const invisiveis = await alimentosInvisiveis(tx, itens);
  if (Object.keys(invisiveis).length) throw new RefeicaoModeloError(invisiveis);
}

/** O "Meu alimento" excluído entre a conferência e o INSERT (FK RESTRICT do item): o erro do alimento, não um 500. */
function alimentoSaiu(e: unknown): never {
  if (fkViolation(e) !== null) throw new RefeicaoModeloError({ geral: MSG_PLANO.alimento });
  throw e;
}

/**
 * US-237 "Salvar do editor": grava a refeição da tela como minha refeição. A observação só vai com "Incluir a
 * observação" marcado (`incluirObservacao: true`). Até 200 por consultório, contadas com o tenant travado.
 */
export async function salvarComoMinhaRefeicao(ctx: TenantContext, entrada: unknown, deps: { db?: Db } = {}): Promise<MinhaRefeicaoDaLista> {
  const v = validar(entrada);
  const incluir = (entrada as Record<string, unknown> | null)?.incluirObservacao === true;
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        await conferirAlimentos(tx, v.itens);
        await travarConsultorio(tx, ctx.tenantId);
        const salvas = await tx.select({ id: refeicoesModelo.id }).from(refeicoesModelo);
        if (salvas.length >= MAX_MINHAS_REFEICOES) throw new RefeicaoModeloError({ geral: MSG_MINHAS_REFEICOES.limiteConsultorio });
        const [r] = await tx
          .insert(refeicoesModelo)
          .values({ tenantId: ctx.tenantId, nome: v.nome, tipo: v.tipo, horario: v.horario, modo: v.modo, descricaoLivre: v.descricaoLivre, observacao: incluir ? v.observacao : '' })
          .returning({ id: refeicoesModelo.id });
        await gravarItens(tx, ctx.tenantId, r.id, v.itens);
        return { id: r.id, nome: v.nome, tipo: v.tipo, horario: v.horario ?? '', modo: v.modo, kcal: await kcalDe(tx, r.id, v.modo) };
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    alimentoSaiu(e);
  }
}

/** US-237 "Tela de cadastro": altera nome, tipo, horário, observação, texto e itens (os itens são regravados). */
export async function alterarMinhaRefeicao(ctx: TenantContext, id: string, entrada: unknown, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(id)) throw new RefeicaoModeloError({ geral: MSG_MINHAS_REFEICOES.naoEncontrada });
  const v = validar(entrada);
  try {
    await withTenant(
      ctx,
      async (tx) => {
        const [atual] = await tx.select({ id: refeicoesModelo.id }).from(refeicoesModelo).where(eq(refeicoesModelo.id, id)).for('update');
        if (!atual) throw new RefeicaoModeloError({ geral: MSG_MINHAS_REFEICOES.naoEncontrada });
        await conferirAlimentos(tx, v.itens);
        await tx
          .update(refeicoesModelo)
          .set({ nome: v.nome, tipo: v.tipo, horario: v.horario, modo: v.modo, descricaoLivre: v.descricaoLivre, observacao: v.observacao, updatedAt: new Date() })
          .where(eq(refeicoesModelo.id, id));
        await tx.delete(refeicoesModeloItens).where(eq(refeicoesModeloItens.refeicaoId, id));
        await gravarItens(tx, ctx.tenantId, id, v.itens);
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    alimentoSaiu(e);
  }
}

/** Exclui a minha refeição (os itens saem em cascata). Os planos em que ela foi carregada não mudam (são cópias). */
export async function excluirMinhaRefeicao(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(id)) throw new RefeicaoModeloError({ geral: MSG_MINHAS_REFEICOES.naoEncontrada });
  const apagadas = await withTenant(ctx, (tx) => tx.delete(refeicoesModelo).where(eq(refeicoesModelo.id, id)).returning({ id: refeicoesModelo.id }), deps.db ?? getDb());
  if (!apagadas.length) throw new RefeicaoModeloError({ geral: MSG_MINHAS_REFEICOES.naoEncontrada });
}

/** kcal da refeição com os valores atuais (só principais, RN-02); nula no texto livre. */
async function kcalDe(tx: Tx, id: string, modo: ModoPlano): Promise<number | null> {
  if (modo === 'livre') return null;
  const [r] = await lerRefeicoes(tx, [id]);
  return r ? totalDosItens(r.itens).kcal : null;
}

/** As refeições pedidas, com os itens (valores atuais, na ordem gravada), na ordem dos ids. */
async function lerRefeicoes(tx: Tx, ids: string[] | null): Promise<MinhaRefeicao[]> {
  const rs = ids === null ? await tx.select().from(refeicoesModelo) : ids.length ? await tx.select().from(refeicoesModelo).where(inArray(refeicoesModelo.id, ids)) : [];
  if (!rs.length) return [];
  const its = await tx
    .select()
    .from(refeicoesModeloItens)
    .where(inArray(refeicoesModeloItens.refeicaoId, rs.map((r) => r.id)))
    .orderBy(asc(refeicoesModeloItens.ordem));
  const itens = await itensComValoresAtuais(tx, its.map((i) => ({ id: i.id, foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida ?? null, substituiItemId: i.substituiItemId })));
  const refeicaoDoItem = new Map(its.map((i) => [i.id, i.refeicaoId]));
  return rs.map((r) => ({
    id: r.id,
    nome: r.nome,
    tipo: r.tipo as TipoDeRefeicao,
    horario: hhmm(r.horario),
    modo: r.modo as ModoPlano,
    descricaoLivre: r.descricaoLivre,
    observacao: r.observacao,
    itens: itens.filter((i) => refeicaoDoItem.get(i.id) === r.id),
  }));
}

const ORDEM_TIPO = new Map<string, number>(TIPOS_DE_REFEICAO.map((t, k) => [t, k]));

/**
 * US-237 "Tela de cadastro" e "Carregar minha refeição": as refeições do consultório na ordem do dia (tipo) e por
 * nome, com "Cerca de {kcal} kcal" calculada na hora (texto livre: sem kcal). `tipo` filtra a lista.
 */
export async function listarMinhasRefeicoes(ctx: TenantContext, o: { tipo?: TipoDeRefeicao } = {}, db: Db = getDb()): Promise<MinhaRefeicaoDaLista[]> {
  const rs = await withTenant(ctx, (tx) => lerRefeicoes(tx, null), db);
  return rs
    .filter((r) => !o.tipo || r.tipo === o.tipo)
    .sort((a, b) => ORDEM_TIPO.get(a.tipo)! - ORDEM_TIPO.get(b.tipo)! || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((r) => ({ id: r.id, nome: r.nome, tipo: r.tipo, horario: r.horario, modo: r.modo, kcal: r.modo === 'livre' ? null : totalDosItens(r.itens).kcal }));
}

/** A minha refeição do consultório (RLS: a de outro consultório não aparece); id inválido ou de outro → null. */
export async function carregarMinhaRefeicao(ctx: TenantContext, id: string, db: Db = getDb()): Promise<MinhaRefeicao | null> {
  if (!idValido(id)) return null;
  const [r] = await withTenant(ctx, (tx) => lerRefeicoes(tx, [id]), db);
  return r ?? null;
}

/**
 * US-237 "Carregar": a refeição como entra no rascunho — ids novos (refeição e itens, com as substituições apontando
 * para os principais novos), os 7 dias, o horário e a observação salvos e os valores atuais dos alimentos. Num plano
 * em texto livre, os itens viram o texto (`itensComoTexto`, RN-245). A refeição em texto livre não entra num plano com
 * alimentos (`soNoLivre`): o texto não vira alimentos. O editor grava pelo salvamento automático de sempre (D7).
 */
export async function refeicaoParaPlano(ctx: TenantContext, id: string, modo: ModoPlano, db: Db = getDb()): Promise<RefeicaoPlano> {
  if (!MODOS.includes(modo)) throw new RefeicaoModeloError({ geral: MSG_PLANO.invalido });
  const r = await carregarMinhaRefeicao(ctx, id, db);
  if (!r) throw new RefeicaoModeloError({ geral: MSG_MINHAS_REFEICOES.naoEncontrada });
  if (r.modo === 'livre' && modo === 'calculado') throw new RefeicaoModeloError({ geral: MSG_MINHAS_REFEICOES.soNoLivre });
  const base = { id: randomUUID(), nome: r.nome, horario: r.horario, observacao: r.observacao, diasSemana: [...TODOS_OS_DIAS] };
  if (modo === 'livre') return { ...base, descricaoLivre: r.modo === 'livre' ? r.descricaoLivre : itensComoTexto(r.itens), itens: [] };
  const novoId = new Map(r.itens.map((i) => [i.id, randomUUID()]));
  return {
    ...base,
    descricaoLivre: null,
    itens: r.itens.map((i) => ({ ...i, id: novoId.get(i.id)!, substituiItemId: i.substituiItemId ? (novoId.get(i.substituiItemId) ?? null) : null })),
  };
}

