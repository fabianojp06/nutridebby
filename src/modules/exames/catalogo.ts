import { asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { examesCatalogo, type ExameCatalogoRow, type FaixaDoConsultorio } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarNome, normUnidade } from '@/modules/ia/correspondencia';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { CatalogoError, validarExameDoCatalogo, type ExameDoCatalogoEntrada, type FaixaEntrada } from './catalogo-regras';
import type { ExameParaCasar } from './classificacao';
import { CATALOGO_MAX, MSG_EXAMES, NOMES_PARA_COMECAR, PAINEIS_PARA_COMECAR } from './constantes';

/**
 * Plano 22 (T3, US-370; RN-370 a RN-375): o catálogo de exames do consultório no banco. Só a sessão `nutri` (a tabela é
 * `staff_only`: numa sessão de paciente a leitura voltaria vazia em silêncio, por isso o assert vem antes da transação).
 * A unicidade normalizada do nome **e** dos outros nomes, o teto de 500 e a unidade com faixas são conferidos sob a trava
 * transacional do catálogo do consultório (`pg_advisory_xact_lock`), a mesma de `adicionarNomesParaComecar`; o
 * `UNIQUE (tenant_id, lower(nome))` é a barreira do banco para o nome. Nomes, faixas e notas nunca vão a log nem à
 * mensagem de erro técnica (RNF-370): só as mensagens da §6.2, nos campos do formulário.
 */

export type ItemParaLancamento = ExameParaCasar;
export type { ExameCatalogoRow };

const E = MSG_EXAMES.erros;
/** A mensagem técnica do nome repetido (a do campo cita o nome; RNF-370). */
const NOME_REPETIDO = 'exames: nome repetido no catálogo';

export function exigirNutri(ctx: TenantContext): void {
  if (ctx.role !== 'nutri') throw new Error('exames: só a sessão nutri');
}

/** RN-371, M6: a trava do catálogo do consultório (salvar e "Nomes de exames para começar" disputam a mesma). */
const travarCatalogo = (tx: Tx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`exames_catalogo:${tenantId}`}, 0))`);

const ordem = asc(sql`lower(${examesCatalogo.nome})`);

export async function listarCatalogo(ctx: TenantContext, deps: { db?: Db } = {}): Promise<ExameCatalogoRow[]> {
  exigirNutri(ctx);
  return withTenant(ctx, (tx) => tx.select().from(examesCatalogo).orderBy(ordem), deps.db ?? getDb());
}

export async function abrirExameDoCatalogo(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<ExameCatalogoRow | null> {
  exigirNutri(ctx);
  if (!idValido(id)) return null;
  const [e] = await withTenant(ctx, (tx) => tx.select().from(examesCatalogo).where(eq(examesCatalogo.id, id)), deps.db ?? getDb());
  return e ?? null;
}

/** Os exames do catálogo para casar com as linhas (T4, T5a, T8), na transação de quem chama (lido uma vez, RNF-371). */
export async function catalogoParaLancamentoNaTransacao(tx: Tx): Promise<ItemParaLancamento[]> {
  return tx
    .select({
      id: examesCatalogo.id,
      nome: examesCatalogo.nome,
      unidade: examesCatalogo.unidade,
      sinonimos: examesCatalogo.sinonimos,
      componentes: examesCatalogo.componentes,
      faixas: examesCatalogo.faixas,
    })
    .from(examesCatalogo)
    .orderBy(ordem);
}

export type ItemParaDetalhe = ItemParaLancamento & { modeloNotaAbaixo: string | null; modeloNotaAcima: string | null };

/** O catálogo do detalhe do exame (T5a): o de lançamento mais os modelos de nota (RN-375), lido uma vez (RNF-371). */
export async function catalogoParaDetalheNaTransacao(tx: Tx): Promise<ItemParaDetalhe[]> {
  return tx
    .select({
      id: examesCatalogo.id,
      nome: examesCatalogo.nome,
      unidade: examesCatalogo.unidade,
      sinonimos: examesCatalogo.sinonimos,
      componentes: examesCatalogo.componentes,
      faixas: examesCatalogo.faixas,
      modeloNotaAbaixo: examesCatalogo.modeloNotaAbaixo,
      modeloNotaAcima: examesCatalogo.modeloNotaAcima,
    })
    .from(examesCatalogo)
    .orderBy(ordem);
}

type Resumo = Pick<ExameCatalogoRow, 'id' | 'nome' | 'sinonimos'>;
/** Nome normalizado (nome e outros nomes) → nome do exame do catálogo que o usa. */
function nomesUsados(itens: Resumo[], fora?: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of itens) {
    if (e.id === fora) continue;
    for (const n of [e.nome, ...e.sinonimos]) {
      const chave = normalizarNome(n);
      if (chave && !m.has(chave)) m.set(chave, e.nome);
    }
  }
  return m;
}

const mesmaFaixa = (a: FaixaEntrada, b: FaixaDoConsultorio) =>
  a.sexo === b.sexo &&
  a.idadeMin === b.idadeMin &&
  a.idadeMax === b.idadeMax &&
  a.aPartirDe === b.aPartirDe &&
  a.abaixoDe === b.abaixoDe &&
  a.categoria === b.categoria &&
  a.fonte === b.fonte;

/**
 * US-370: cria (`id` nulo) ou altera um exame do catálogo e devolve o id. Lança `CatalogoError` com as chaves do formulário
 * (`nome`, `sinonimos`, `unidade`, `componentes`, `faixas`, `faixas.<i>.<campo>`, `modeloNota…`, `geral`). `atualizadaEm`
 * é hoje (no fuso do consultório) só na faixa nova ou mudada; a que ficou igual guarda a data dela.
 */
export async function salvarExameDoCatalogo(
  ctx: TenantContext,
  tenant: { fuso: string },
  id: string | null,
  input: unknown,
  deps: { db?: Db; agora?: Date } = {},
): Promise<string> {
  exigirNutri(ctx);
  if (id !== null && !idValido(id)) throw new CatalogoError({ geral: E.naoEncontrado });
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  let nomeTentado = '';
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        await travarCatalogo(tx, ctx.tenantId);
        const todos = await tx.select({ id: examesCatalogo.id, nome: examesCatalogo.nome, sinonimos: examesCatalogo.sinonimos }).from(examesCatalogo);
        let atual: ExameCatalogoRow | undefined;
        if (id !== null) {
          [atual] = await tx.select().from(examesCatalogo).where(eq(examesCatalogo.id, id));
          if (!atual) throw new CatalogoError({ geral: E.naoEncontrado });
        }
        const comFaixas = !!atual?.faixas.length;
        let v: ExameDoCatalogoEntrada;
        try {
          v = validarExameDoCatalogo(input);
        } catch (e) {
          // RN-374: apagar a unidade de um exame com faixas gravadas é trocar a unidade (a mensagem da troca, não a do vazio)
          if (e instanceof CatalogoError && comFaixas && e.erros.faixas === E.semUnidade) throw new CatalogoError({ unidade: E.trocarUnidade });
          throw e;
        }
        nomeTentado = v.nome;
        if (!atual && todos.length >= CATALOGO_MAX) throw new CatalogoError({ geral: E.catalogoCheio });
        const usados = nomesUsados(todos, id ?? undefined);
        const doNome = usados.get(normalizarNome(v.nome));
        if (doNome) throw new CatalogoError({ nome: E.nomeRepetido(doNome) }, NOME_REPETIDO);
        const doOutro = v.sinonimos.map((s) => usados.get(normalizarNome(s))).find(Boolean);
        if (doOutro) throw new CatalogoError({ sinonimos: E.nomeRepetido(doOutro) }, NOME_REPETIDO);
        // RN-374: com faixas gravadas, a unidade não muda (a não ser que a gravação tire todas as faixas junto)
        if (atual && comFaixas && v.faixas.length && normUnidade(v.unidade) !== normUnidade(atual.unidade)) throw new CatalogoError({ unidade: E.trocarUnidade });

        const faixas: FaixaDoConsultorio[] = v.faixas.map((f) => ({ ...f, atualizadaEm: atual?.faixas.find((g) => mesmaFaixa(f, g))?.atualizadaEm ?? hoje }));
        const linha = {
          nome: v.nome,
          unidade: v.unidade,
          sinonimos: v.sinonimos,
          componentes: v.componentes,
          faixas,
          modeloNotaAbaixo: v.modeloNotaAbaixo,
          modeloNotaAcima: v.modeloNotaAcima,
        };
        if (atual) {
          await tx.update(examesCatalogo).set({ ...linha, updatedAt: new Date() }).where(eq(examesCatalogo.id, atual.id));
          return atual.id;
        }
        const [novo] = await tx.insert(examesCatalogo).values({ tenantId: ctx.tenantId, ...linha }).returning({ id: examesCatalogo.id });
        return novo.id;
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    // a barreira do banco (o índice do nome): a mesma mensagem
    if (uniqueViolation(e) === 'exames_catalogo_nome_unico') throw new CatalogoError({ nome: E.nomeRepetido(nomeTentado) }, NOME_REPETIDO);
    throw e;
  }
}

export async function excluirExameDoCatalogo(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<boolean> {
  exigirNutri(ctx);
  if (!idValido(id)) return false;
  // RN-371: exames, modelos e documentos guardam cópia do nome (sem FK) — nada mais muda
  const apagados = await withTenant(ctx, (tx) => tx.delete(examesCatalogo).where(eq(examesCatalogo.id, id)).returning({ id: examesCatalogo.id }), deps.db ?? getDb());
  return apagados.length > 0;
}

export type NomeParaComecar = { nome: string; sinonimos: string[]; componentes: string[] };
const PARA_COMECAR: readonly NomeParaComecar[] = [
  ...NOMES_PARA_COMECAR.map((n) => ({ nome: n.nome, sinonimos: [...n.sinonimos], componentes: [] })),
  ...PAINEIS_PARA_COMECAR.map((p) => ({ nome: p.nome, sinonimos: [], componentes: [...p.componentes] })),
];

/** RN-372: os nomes da lista cujo nome (normalizado) ainda não é nome nem outro nome de um exame do catálogo. */
export async function nomesParaComecarFaltando(ctx: TenantContext, deps: { db?: Db } = {}): Promise<NomeParaComecar[]> {
  exigirNutri(ctx);
  const todos = await withTenant(ctx, (tx) => tx.select({ id: examesCatalogo.id, nome: examesCatalogo.nome, sinonimos: examesCatalogo.sinonimos }).from(examesCatalogo), deps.db ?? getDb());
  const usados = nomesUsados(todos);
  return PARA_COMECAR.filter((n) => !usados.has(normalizarNome(n.nome)));
}

/**
 * RN-372, M6: grava os nomes escolhidos (só os da lista; outro texto é ignorado), sob a mesma trava do `salvar`. Os
 * comuns entram com nome e outros nomes; o painel, com os componentes (só nomes). Nome já presente (nome ou outro nome,
 * normalizado) é ignorado, e o outro nome que já está em uso sai do exame novo (a unicidade vale). Se o total passar de
 * 500, recusa tudo e nada é gravado. Devolve quantos entraram.
 */
export async function adicionarNomesParaComecar(ctx: TenantContext, nomes: unknown, deps: { db?: Db } = {}): Promise<number> {
  exigirNutri(ctx);
  const pedidos = new Set((Array.isArray(nomes) ? nomes : []).filter((n): n is string => typeof n === 'string'));
  const escolhidos = PARA_COMECAR.filter((n) => pedidos.has(n.nome));
  if (!escolhidos.length) return 0;
  return withTenant(
    ctx,
    async (tx) => {
      await travarCatalogo(tx, ctx.tenantId);
      const todos = await tx.select({ id: examesCatalogo.id, nome: examesCatalogo.nome, sinonimos: examesCatalogo.sinonimos }).from(examesCatalogo);
      const usados = new Set(nomesUsados(todos).keys());
      const novos: NomeParaComecar[] = [];
      for (const n of escolhidos) {
        if (usados.has(normalizarNome(n.nome))) continue;
        usados.add(normalizarNome(n.nome));
        const sinonimos = n.sinonimos.filter((s) => {
          const chave = normalizarNome(s);
          if (usados.has(chave)) return false;
          usados.add(chave);
          return true;
        });
        novos.push({ ...n, sinonimos });
      }
      if (!novos.length) return 0;
      if (todos.length + novos.length > CATALOGO_MAX) throw new CatalogoError({ geral: E.catalogoCheio });
      await tx.insert(examesCatalogo).values(novos.map((n) => ({ tenantId: ctx.tenantId, nome: n.nome, sinonimos: n.sinonimos, componentes: n.componentes })));
      return novos.length;
    },
    deps.db ?? getDb(),
  );
}
