import { asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { examesModelosSolicitacao, type ExameDaLista, type ModeloSolicitacaoRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { DocumentoError } from '@/modules/documentos/erros';
import { ORIENTACOES_SOLICITACAO_MAX, textoLivre, validarListaDeExames } from '@/modules/documentos/solicitacao';
import { idValido } from '@/modules/pacientes/base';
import { catalogoParaLancamentoNaTransacao, exigirNutri, type ItemParaLancamento } from './catalogo';
import { expandirParaAnalise } from './catalogo-regras';
import { indiceDoCatalogo } from './classificacao';
import { LISTA_DE_EXAMES_MAX, MSG_EXAMES, NOME_MAX } from './constantes';

/**
 * Plano 22 (T3, US-376, RN-391; EP-D5 a EP-D7): modelos de solicitação de exames do consultório — nome (único sem
 * diferença de maiúsculas), 1 a 40 exames por cópia (sem FK para o catálogo) e orientações ao paciente (até 1000, em
 * marcação). **Sem** indicação clínica nem dado do paciente. Só a sessão `nutri` (staff_only; assert antes da transação).
 * Não dependem de `documentos_liberados`: servem também para lançar exames (RN-391).
 */

export type { ModeloSolicitacaoRow };
export type ModeloParaUsar = { id: string; nome: string; exames: ExameDaLista[]; orientacoes: string };

const M = MSG_EXAMES.modelosSolicitacao.erros;

export class ModeloSolicitacaoError extends Error {
  override name = 'ModeloSolicitacaoError';
  constructor(readonly erros: Record<string, string>) {
    super(Object.values(erros)[0] ?? 'Modelo de solicitação inválido.');
  }
}

const umaLinha = (s: string) => s.replace(/\u0000/g, '').trim().replace(/\s+/g, ' ');

/** RN-391: nome, exames e orientações; qualquer outra chave (a indicação clínica) é ignorada. */
function validar(input: unknown): { nome: string; exames: ExameDaLista[]; orientacoes: string } {
  const b = (input ?? {}) as { nome?: unknown; exames?: unknown; orientacoes?: unknown };
  const erros: Record<string, string> = {};
  const nome = typeof b.nome === 'string' ? umaLinha(b.nome) : '';
  if (!nome || nome.length > NOME_MAX) erros.nome = M.nome;
  let exames: ExameDaLista[] = [];
  try {
    exames = validarListaDeExames(b.exames, { max: LISTA_DE_EXAMES_MAX, para: 'modelo' });
  } catch (e) {
    if (!(e instanceof DocumentoError)) throw e;
    Object.assign(erros, e.erros);
  }
  const orientacoes = typeof b.orientacoes === 'string' ? textoLivre(b.orientacoes) : '';
  if (orientacoes.length > ORIENTACOES_SOLICITACAO_MAX) erros.orientacoes = M.orientacoes;
  if (Object.keys(erros).length) throw new ModeloSolicitacaoError(erros);
  return { nome, exames, orientacoes };
}

const ordem = asc(sql`lower(${examesModelosSolicitacao.nome})`);

export async function listarModelosSolicitacao(ctx: TenantContext, deps: { db?: Db } = {}): Promise<ModeloSolicitacaoRow[]> {
  exigirNutri(ctx);
  return withTenant(ctx, (tx) => tx.select().from(examesModelosSolicitacao).orderBy(ordem), deps.db ?? getDb());
}

/** "Carregar modelo de solicitação" (T4) e "Carregar modelo" da solicitação (T8), na transação de quem chama (RNF-371). */
export async function modelosSolicitacaoNaTransacao(tx: Tx): Promise<ModeloParaUsar[]> {
  return tx
    .select({ id: examesModelosSolicitacao.id, nome: examesModelosSolicitacao.nome, exames: examesModelosSolicitacao.exames, orientacoes: examesModelosSolicitacao.orientacoes })
    .from(examesModelosSolicitacao)
    .orderBy(ordem);
}

/** O catálogo e os modelos numa transação só (editor da solicitação, T8; telas da T3). */
export async function bibliotecasParaExames(ctx: TenantContext, deps: { db?: Db } = {}): Promise<{ catalogo: ItemParaLancamento[]; modelos: ModeloParaUsar[] }> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const catalogo = await catalogoParaLancamentoNaTransacao(tx);
      const modelos = await modelosSolicitacaoNaTransacao(tx);
      return { catalogo, modelos };
    },
    deps.db ?? getDb(),
  );
}

export async function abrirModeloSolicitacao(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<ModeloSolicitacaoRow | null> {
  exigirNutri(ctx);
  if (!idValido(id)) return null;
  const [m] = await withTenant(ctx, (tx) => tx.select().from(examesModelosSolicitacao).where(eq(examesModelosSolicitacao.id, id)), deps.db ?? getDb());
  return m ?? null;
}

/** US-376: cria (`id` nulo) ou altera um modelo e devolve o id. Lança `ModeloSolicitacaoError` com as chaves do formulário. */
export async function salvarModeloSolicitacao(ctx: TenantContext, id: string | null, input: unknown, deps: { db?: Db } = {}): Promise<string> {
  exigirNutri(ctx);
  if (id !== null && !idValido(id)) throw new ModeloSolicitacaoError({ geral: M.naoEncontrado });
  const v = validar(input);
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        if (id !== null) {
          const [m] = await tx
            .update(examesModelosSolicitacao)
            .set({ ...v, updatedAt: new Date() })
            .where(eq(examesModelosSolicitacao.id, id))
            .returning({ id: examesModelosSolicitacao.id });
          if (!m) throw new ModeloSolicitacaoError({ geral: M.naoEncontrado });
          return m.id;
        }
        const [novo] = await tx.insert(examesModelosSolicitacao).values({ tenantId: ctx.tenantId, ...v }).returning({ id: examesModelosSolicitacao.id });
        return novo.id;
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'exames_modelos_solicitacao_nome_unico') throw new ModeloSolicitacaoError({ nome: M.repetido });
    throw e;
  }
}

export async function excluirModeloSolicitacao(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<boolean> {
  exigirNutri(ctx);
  if (!idValido(id)) return false;
  const apagados = await withTenant(ctx, (tx) => tx.delete(examesModelosSolicitacao).where(eq(examesModelosSolicitacao.id, id)).returning({ id: examesModelosSolicitacao.id }), deps.db ?? getDb());
  return apagados.length > 0;
}

/**
 * RN-373, RN-391: o modelo para usar — `exames` como estão (o painel conta como um, para a solicitação) e `linhas` para
 * a análise (o painel vira uma linha por componente, com a unidade do exame do catálogo que casar). Catálogo e modelo
 * numa transação. `null` se o modelo não existe (ou é de outro consultório).
 */
export async function exameDosModelos(
  ctx: TenantContext,
  modeloId: string,
  deps: { db?: Db } = {},
): Promise<{ exames: ExameDaLista[]; linhas: { nome: string; unidade: string | null }[]; orientacoes: string } | null> {
  exigirNutri(ctx);
  if (!idValido(modeloId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [m] = await tx.select().from(examesModelosSolicitacao).where(eq(examesModelosSolicitacao.id, modeloId));
      if (!m) return null;
      const indice = indiceDoCatalogo(await catalogoParaLancamentoNaTransacao(tx));
      return { exames: m.exames, linhas: expandirParaAnalise(m.exames, indice), orientacoes: m.orientacoes };
    },
    deps.db ?? getDb(),
  );
}
