import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { appointments, finCategorias, finLancamentos } from '@/db/schema';
import { ROTULO_FORMA, type FormaPagamento } from './constantes';
import { formatarReais } from './dinheiro';
import { ROTULO_SITUACAO, situacaoDoLancamento, type Situacao } from './situacao';

/**
 * Um lançamento do titular no `dados.json` (US-307, spec §10, F-D22): datas 'AAAA-MM-DD' (vencimento, pagamento) e ISO 8601
 * (início da consulta, cancelamento); a situação no dia da exportação, no fuso do consultório. Nunca quem lançou nem quem
 * cancelou (dado da equipe, não do titular).
 */
export type FinanceiroExportado = {
  vencimento: string;
  pagoEm: string | null;
  valorCentavos: number;
  /** "R$ 250,00". */
  valor: string;
  formaDePagamento: FormaPagamento | null;
  formaDePagamentoRotulo: string | null;
  situacao: Situacao;
  situacaoRotulo: string;
  /** O nome da categoria. */
  categoria: string;
  descricao: string | null;
  consultaInicio: string | null;
  canceladoEm: string | null;
  motivoCancelamento: string | null;
};

/**
 * US-307: os lançamentos do paciente para a exportação (os dois escopos), do vencimento mais antigo ao mais novo. Roda no
 * job da exportação (contexto `worker`, sem a exigência da sessão `nutri`): `fin_lancamentos` é staff_only, por isso a
 * inclusão explícita em `montarDados`. `hoje` = `hojeNoFuso(tenant.fuso, agora)` (RN-305).
 */
export async function financeiroParaExportacao(tx: Tx, patientId: string, hoje: string): Promise<FinanceiroExportado[]> {
  const L = finLancamentos;
  const linhas = await tx
    .select({ l: L, categoria: finCategorias.nome, consultaInicio: appointments.inicio })
    .from(L)
    .innerJoin(finCategorias, and(eq(finCategorias.tenantId, L.tenantId), eq(finCategorias.id, L.categoriaId)))
    .leftJoin(appointments, and(eq(appointments.tenantId, L.tenantId), eq(appointments.id, L.appointmentId)))
    .where(eq(L.patientId, patientId))
    .orderBy(asc(L.vencimento), asc(L.createdAt), asc(L.id));
  return linhas.map(({ l, categoria, consultaInicio }) => {
    const situacao = situacaoDoLancamento(l, hoje);
    return {
      vencimento: l.vencimento,
      pagoEm: l.pagoEm,
      valorCentavos: l.valorCentavos,
      valor: formatarReais(l.valorCentavos),
      formaDePagamento: l.formaPagamento,
      formaDePagamentoRotulo: l.formaPagamento ? ROTULO_FORMA[l.formaPagamento] : null,
      situacao,
      situacaoRotulo: ROTULO_SITUACAO[situacao],
      categoria,
      descricao: l.descricao,
      consultaInicio: consultaInicio?.toISOString() ?? null,
      canceladoEm: l.canceladoEm?.toISOString() ?? null,
      motivoCancelamento: l.motivoCancelamento,
    };
  });
}

/**
 * RN-316 (F-D23): o titular tem algum lançamento do Financeiro? `anonimizarVencidos` (`src/modules/pacientes/lgpd.ts`, contexto
 * `worker`) só chama `app_anonimizar_financeiro` com lançamento: a função confere o prazo pelo relógio do banco, e o `now`
 * do job pode ser outro (testes). A leitura fica aqui, no módulo do Financeiro (regra 1 do CLAUDE.md: no contexto `worker`,
 * só este arquivo e a função leem as tabelas `fin_*`).
 */
export async function temLancamentos(tx: Tx, patientId: string): Promise<boolean> {
  const [linha] = await tx.select({ id: finLancamentos.id }).from(finLancamentos).where(eq(finLancamentos.patientId, patientId)).limit(1);
  return linha !== undefined;
}
