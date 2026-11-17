import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { finCategorias, finLancamentos, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { recordAudit } from '@/modules/plataforma/audit';
import { configuracaoNaTransacao } from './configuracoes';
import { csvFluxo, csvLancamentos } from './csv';
import { exigirNutri } from './erros';
import { periodoValido } from './meses';
import { fluxoNaTransacao } from './resumo';
import { situacaoDoLancamento } from './situacao';
import type { LinhaCsv } from './tipos';

/**
 * Os CSV para o contador (US-306, RN-321), com o registro do download: a leitura, o `exportar` (entidade `financeiro`) e a
 * montagem do arquivo numa transação só — se algo falhar depois da leitura, o registro não fica (regra 8). Sem `auditRead`:
 * o download é `exportar`, não `ler`.
 */
type Deps = { db?: Db; agora?: Date };
type Tenant = { fuso: string };

const L = finLancamentos;
/** Data de referência (RN-306): o pagamento, ou o vencimento em aberto. */
const referencia = sql<string>`coalesce(${L.pagoEm}, ${L.vencimento})`;

/**
 * CSV dos lançamentos com data de referência de `de` a `ate` (até 366 dias; RangeError fora disso — a rota confere antes),
 * cancelados incluídos com a situação, do mais antigo ao mais novo. O nome do paciente é o **nome civil**
 * (`patients.nome`: documento fiscal) e vem em toda linha com paciente — sem `comPacientes`, `csvLancamentos` tira a coluna
 * e esvazia a descrição dessas linhas. `exportar`: um por paciente presente no arquivo com `comPacientes`; senão (ou sem
 * nenhum paciente no período), um sem paciente.
 */
export async function exportarLancamentosCsv(
  ctx: TenantContext,
  tenant: Tenant,
  pedido: { de: string; ate: string; comPacientes: boolean },
  deps: Deps = {},
): Promise<string> {
  exigirNutri(ctx);
  const { de, ate, comPacientes } = pedido;
  if (!periodoValido(de, ate)) throw new RangeError('financeiro: período do CSV inválido');
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(
    ctx,
    async (tx) => {
      const linhas = await tx
        .select({ l: L, categoria: finCategorias.nome, paciente: patients.nome })
        .from(L)
        .innerJoin(finCategorias, and(eq(finCategorias.tenantId, L.tenantId), eq(finCategorias.id, L.categoriaId)))
        .leftJoin(patients, and(eq(patients.tenantId, L.tenantId), eq(patients.id, L.patientId)))
        .where(and(eq(L.tenantId, ctx.tenantId), sql`${referencia} between ${de} and ${ate}`))
        .orderBy(asc(referencia), asc(L.createdAt), asc(L.id));
      const presentes = [...new Set(linhas.flatMap((r) => (r.l.patientId ? [r.l.patientId] : [])))];
      await recordAudit(
        tx,
        comPacientes && presentes.length
          ? presentes.map((patientId) => ({ acao: 'exportar' as const, entidade: 'financeiro', entidadeId: null, patientId }))
          : { acao: 'exportar', entidade: 'financeiro', entidadeId: null, patientId: null },
      );
      return csvLancamentos(
        linhas.map(
          ({ l, categoria, paciente }): LinhaCsv => ({
            vencimento: l.vencimento,
            pagoEm: l.pagoEm,
            tipo: l.tipo,
            categoria,
            descricao: l.descricao,
            paciente: l.patientId ? (paciente ?? '') : null,
            forma: l.formaPagamento,
            valorCentavos: l.valorCentavos,
            situacao: situacaoDoLancamento(l, hoje),
          }),
        ),
        { comPacientes },
      );
    },
    deps.db ?? getDb(),
  );
}

/** CSV do fluxo de caixa do ano (US-306), com um `exportar` sem paciente (o fluxo não tem nomes). Ano fora de 2000 a 2100: RangeError. */
export async function exportarFluxoCsv(ctx: TenantContext, ano: number, deps: Deps = {}): Promise<string> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const fluxo = await fluxoNaTransacao(tx, ctx.tenantId, ano, await configuracaoNaTransacao(tx));
      await recordAudit(tx, { acao: 'exportar', entidade: 'financeiro', entidadeId: null, patientId: null });
      return csvFluxo(fluxo);
    },
    deps.db ?? getDb(),
  );
}
