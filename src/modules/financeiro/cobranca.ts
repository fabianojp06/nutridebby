import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, consultations, finCategorias, finLancamentos, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { ConsultaNaoEncontradaError } from '@/modules/agenda/consultas';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { auditRead } from '@/modules/plataforma/audit';
import { configuracaoNaTransacao } from './configuracoes';
import { MSG_FINANCEIRO } from './constantes';
import { exigirNutri, FinanceiroError, FinanceiroNaoConfiguradoError } from './erros';
import { naTela, selecionarNaTela, validarValor } from './lancamentos';
import type { LancamentoNaTela } from './tipos';

/**
 * US-303 / RN-310 a RN-314 (Plano 20, F-D13, F-D19): a cobrança da consulta — um lugar só, chamado pelos dois caminhos que
 * levam a consulta a "Realizada" (`registrarPresenca` e `registrarAtendimento`) na transação deles, depois das travas deles
 * (paciente → consulta), e pela seção "Cobrança" da tela da consulta.
 */
export type ResultadoCobranca =
  // passagem a Realizada
  | { tipo: 'criada'; valorCentavos: number }
  | { tipo: 'sem_valor' }
  | { tipo: 'bloqueado' }
  | { tipo: 'ja_existia' }
  // correção para Faltou (só leitura)
  | { tipo: 'aberta' }
  | { tipo: 'recebida' }
  | { tipo: 'nenhuma' };
export type TipoDeResultado = ResultadoCobranca['tipo'];

type Deps = { db?: Db; agora?: Date };
type Consulta = { id: string; patientId: string; inicio: Date };

/** RN-314: "Registrar cobrança" numa consulta que não é (ou deixou de ser) "Realizada": a tela volta ao estado atual. */
export class ConsultaNaoRealizadaError extends Error {
  override name = 'ConsultaNaoRealizadaError';
  constructor() {
    super('Consulta não realizada');
  }
}

/**
 * O paciente com `FOR KEY SHARE` e a situação lida **sob a trava** (RN-317): quem chama já travou o paciente (refazer não
 * custa nada), mas o estado nunca vem de fora — lido antes da trava, um bloqueio que confirmasse no meio faria o gatilho
 * recusar o INSERT (42501) e derrubar a presença inteira, em vez de devolver `bloqueado`.
 */
async function pacienteSemBloqueio(tx: Tx, patientId: string): Promise<boolean> {
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId)).for('key share');
  return !!p && p.status !== 'bloqueado' && !p.anonimizadoEm;
}

/** A cobrança ativa (não cancelada) da consulta — no máximo uma (`fin_lancamentos_consulta_ativa_unique`). */
async function cobrancaAtiva(tx: Tx, consultaId: string) {
  const [l] = await tx
    .select({ id: finLancamentos.id, pagoEm: finLancamentos.pagoEm })
    .from(finLancamentos)
    .where(and(eq(finLancamentos.appointmentId, consultaId), isNull(finLancamentos.canceladoEm)));
  return l ?? null;
}

/**
 * RN-310 (c): `INSERT … ON CONFLICT (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL AND cancelado_em IS NULL
 * DO NOTHING` — o predicado igual ao do índice parcial; quem perde a corrida espera o outro confirmar e não insere.
 * Vencimento = a data do início da consulta no fuso; categoria "Consultas" (`chave`); sem forma nem descrição. `criado_por`
 * é a usuária da sessão (`app_current_user()`, que o gatilho também grava). Devolve o id, ou null se a consulta já tinha
 * cobrança ativa.
 */
async function inserirCobranca(tx: Tx, a: { tenantId: string; fuso: string; consulta: Consulta; valorCentavos: number }): Promise<string | null> {
  const [categoria] = await tx.select({ id: finCategorias.id }).from(finCategorias).where(eq(finCategorias.chave, 'consultas'));
  if (!categoria) throw new FinanceiroNaoConfiguradoError(); // não acontece: "Consultas" nasce com a configuração e não se apaga
  const linhas = await tx
    .insert(finLancamentos)
    .values({
      tenantId: a.tenantId,
      tipo: 'entrada',
      categoriaId: categoria.id,
      valorCentavos: a.valorCentavos,
      vencimento: hojeNoFuso(a.fuso, a.consulta.inicio),
      patientId: a.consulta.patientId,
      appointmentId: a.consulta.id,
      criadoPor: sql`app_current_user()`,
    })
    .onConflictDoNothing({
      target: [finLancamentos.tenantId, finLancamentos.appointmentId],
      where: and(isNotNull(finLancamentos.appointmentId), isNull(finLancamentos.canceladoEm)),
    })
    .returning({ id: finLancamentos.id });
  return linhas[0]?.id ?? null;
}

/**
 * RN-310: na transação que leva a consulta de outra situação a "Realizada", depois das travas do caminho. Não cria quando
 * o paciente está bloqueado ou anonimizado (F-D20), quando a consulta já tem cobrança ativa, ou sem o valor da consulta
 * configurado (F-D21) — nessa ordem: a mensagem de "informe o valor" só quando ela de fato faltou.
 */
export async function cobrarConsultaRealizada(tx: Tx, a: { tenantId: string; fuso: string; consulta: Consulta }): Promise<ResultadoCobranca> {
  if (!(await pacienteSemBloqueio(tx, a.consulta.patientId))) return { tipo: 'bloqueado' };
  if (await cobrancaAtiva(tx, a.consulta.id)) return { tipo: 'ja_existia' };
  const valorCentavos = (await configuracaoNaTransacao(tx))?.valorConsultaCentavos ?? null;
  if (valorCentavos === null) return { tipo: 'sem_valor' };
  const id = await inserirCobranca(tx, { ...a, valorCentavos });
  return id ? { tipo: 'criada', valorCentavos } : { tipo: 'ja_existia' };
}

/**
 * RN-312 / F-D19 v0.2: a correção de "Realizada" para "Faltou" **não** cancela nem altera a cobrança — só lê a ativa, na
 * mesma transação, para a tela avisar.
 */
export async function aoCorrigirParaFaltou(tx: Tx, a: { consultaId: string }): Promise<ResultadoCobranca> {
  const l = await cobrancaAtiva(tx, a.consultaId);
  if (!l) return { tipo: 'nenhuma' };
  return l.pagoEm ? { tipo: 'recebida' } : { tipo: 'aberta' };
}

export type SecaoDaCobranca = {
  cobranca: LancamentoNaTela | null;
  podeRegistrar: boolean;
  /** Por que "Registrar cobrança" não aparece (sem cobrança ativa); null com cobrança ou quando pode registrar. */
  motivo: 'nao_configurado' | 'bloqueado' | 'nao_realizada' | null;
  /** RN-314: o valor da consulta das Configurações (editável no formulário). */
  valorSugerido: number | null;
};

/**
 * A seção "Cobrança" da tela da consulta (US-303, RN-314). RN-318: com cobrança, `ler` (entidade `financeiro`, o id do
 * lançamento, o paciente); sem ela, nenhum. Consulta inválida ou de outro consultório (RLS) → como não realizada.
 */
export async function cobrancaDaConsulta(ctx: TenantContext, tenant: { fuso: string }, consultaId: string, deps: Deps = {}): Promise<SecaoDaCobranca> {
  exigirNutri(ctx);
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(
    ctx,
    async (tx) => {
      const config = await configuracaoNaTransacao(tx);
      const valorSugerido = config?.valorConsultaCentavos ?? null;
      const [c] = idValido(consultaId)
        ? await tx.select({ status: appointments.status, patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, consultaId))
        : [];
      const [r] = c ? await selecionarNaTela(tx).where(and(eq(finLancamentos.appointmentId, consultaId), isNull(finLancamentos.canceladoEm))) : [];
      if (r) {
        await auditRead(tx, { entidade: 'financeiro', entidadeId: r.l.id, patientId: r.l.patientId });
        return { cobranca: naTela(r, hoje), podeRegistrar: false, motivo: null, valorSugerido };
      }
      const [p] = c ? await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, c.patientId)) : [];
      const motivo =
        c?.status !== 'realizada' ? 'nao_realizada' : !config ? 'nao_configurado' : !p || p.status === 'bloqueado' || p.anonimizadoEm ? 'bloqueado' : null;
      return { cobranca: null, podeRegistrar: motivo === null, motivo, valorSugerido };
    },
    deps.db ?? getDb(),
  );
}

/**
 * RN-314: "Registrar cobrança" à mão na tela da consulta — só consulta "Realizada", sem cobrança ativa, paciente nem
 * bloqueado nem anonimizado e Financeiro configurado; o valor é obrigatório (o sugerido vem preenchido). Travas (RN-317):
 * paciente `FOR KEY SHARE` com a situação conferida sob a trava → consulta `FOR SHARE` (a presença não muda no meio) →
 * INSERT. Duas abas ao mesmo tempo: a que perde vê "Esta consulta já tem uma cobrança.".
 */
export async function registrarCobrancaManual(ctx: TenantContext, tenant: { fuso: string }, consultaId: string, valor: string, deps: Deps = {}): Promise<{ id: string }> {
  exigirNutri(ctx);
  if (!idValido(consultaId)) throw new ConsultaNaoEncontradaError();
  const erros: Record<string, string> = {};
  const valorCentavos = validarValor(valor, erros);
  if (valorCentavos === null) throw new FinanceiroError(erros);
  return withTenant(
    ctx,
    async (tx) => {
      const [antes] = await tx.select({ patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, consultaId));
      if (!antes) throw new ConsultaNaoEncontradaError();
      const semBloqueio = await pacienteSemBloqueio(tx, antes.patientId);
      const [c] = await tx
        .select({ id: appointments.id, patientId: appointments.patientId, inicio: appointments.inicio, status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, consultaId))
        .for('share');
      if (!c) throw new ConsultaNaoEncontradaError();
      if (c.status !== 'realizada') throw new ConsultaNaoRealizadaError();
      if (!(await configuracaoNaTransacao(tx))) throw new FinanceiroNaoConfiguradoError();
      if (!semBloqueio) throw new FinanceiroError({ geral: MSG_FINANCEIRO.consulta.bloqueado });
      if (await cobrancaAtiva(tx, c.id)) throw new FinanceiroError({ geral: MSG_FINANCEIRO.erros.jaTemCobranca });
      const id = await inserirCobranca(tx, { tenantId: ctx.tenantId, fuso: tenant.fuso, consulta: c, valorCentavos });
      if (!id) throw new FinanceiroError({ geral: MSG_FINANCEIRO.erros.jaTemCobranca });
      return { id };
    },
    deps.db ?? getDb(),
  );
}

/**
 * O valor da cobrança ativa da consulta ligada ao atendimento, para a mensagem "Atendimento registrado. Cobrança de {valor}
 * criada no Financeiro." (US-303; o valor nunca vai na URL). Devolve o financeiro de um paciente identificado: `ler`
 * (RN-318), como a seção da consulta. Sem consulta ligada ou sem cobrança → null.
 */
export async function valorDaCobrancaDoAtendimento(ctx: TenantContext, atendimentoId: string, deps: Deps = {}): Promise<number | null> {
  exigirNutri(ctx);
  if (!idValido(atendimentoId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [l] = await tx
        .select({ id: finLancamentos.id, patientId: finLancamentos.patientId, valorCentavos: finLancamentos.valorCentavos })
        .from(consultations)
        .innerJoin(
          finLancamentos,
          and(eq(finLancamentos.tenantId, consultations.tenantId), eq(finLancamentos.appointmentId, consultations.appointmentId), isNull(finLancamentos.canceladoEm)),
        )
        .where(eq(consultations.id, atendimentoId));
      if (!l) return null;
      await auditRead(tx, { entidade: 'financeiro', entidadeId: l.id, patientId: l.patientId });
      return l.valorCentavos;
    },
    deps.db ?? getDb(),
  );
}
