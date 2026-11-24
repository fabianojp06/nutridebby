import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { appointments, consultationNotes, consultations } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { caracteres } from '@/lib/text';
import { motivoParaNaoIniciarAtendimento } from '@/modules/agenda/presenca';
import { previsaoNaFaixa, retornoEmSemanas } from '@/modules/agenda/retorno';
import { cobrarConsultaRealizada, type ResultadoCobranca } from '@/modules/financeiro/cobranca';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido } from './base';
import { dataValida, hojeNoFuso } from './datas';

export const MSG_ATENDIMENTO = {
  data: 'Informe a data do atendimento',
  futuro: 'A data não pode ser no futuro',
  notas: 'Use no máximo 20000 caracteres nas notas privadas',
  orientacoes: 'Use no máximo 5000 caracteres nas orientações',
  naoEncontrado: 'Atendimento não encontrado.',
  consultaJaAtendida: 'Esta consulta já tem um atendimento registrado.',
  consultaInvalida: 'Consulta não encontrada para este paciente.',
  /** Code-review do PR #7: a consulta foi movida para o futuro depois de a tela abrir (ou o POST foi montado). */
  consultaNaoComecou: 'Esta consulta ainda não começou.',
  /** Plano 23 (§4.3, §6.2 "Atendimento"): a consulta ligada ainda é um pedido (`solicitada`). */
  pedido: 'Aceite o pedido antes de registrar o atendimento.',
  /** Plano 23 (RN-430, §6.2 "Atendimento"): a previsão de retorno fora da faixa do CHECK `consultations_retorno_previsto_faixa`. */
  retornoPrevisto: 'A previsão de retorno deve ficar entre a data do atendimento e 2 anos depois.',
} as const;

export class AtendimentoError extends Error {
  override name = 'AtendimentoError';
  constructor(readonly erros: Record<string, string>) {
    super('Atendimento inválido');
  }
}

export type Atendimento = { id: string; data: string; orientacoesPaciente: string | null; notasPrivadas: string | null; retornoPrevistoEm: string | null; createdAt: Date };
/**
 * `appointmentId` (Plano 05): só no registro, quando o atendimento é iniciado pela agenda; a edição ignora.
 * Plano 23 (US-410, RN-430): "Retorno previsto (opcional)" — `retornoPrevistoEm` (a data) ou `retornoSemanas` ("Em {n}
 * semanas", contadas da data do atendimento, que já está no fuso do consultório); com as semanas preenchidas, elas valem.
 * Os dois vazios ('') tiram a previsão; os dois ausentes (`undefined`, quem chama sem o campo) mantêm a gravada na edição.
 */
type Entrada = { data: unknown; notasPrivadas: unknown; orientacoes: unknown; appointmentId?: unknown; retornoPrevistoEm?: unknown; retornoSemanas?: unknown };

/** Semanas: inteiro de 1 a 104 (o `min`/`max` do campo; 104 semanas = 728 dias, dentro dos 2 anos); outro texto não vira previsão. */
const SEMANAS = /^\d{1,3}$/;
const semanasValidas = (s: string) => SEMANAS.test(s) && Number(s) >= 1 && Number(s) <= 104;

/**
 * A previsão pedida: `undefined` = não informada (manter a gravada), `null` = sem previsão, `string` = a data, ou `false`
 * quando o texto não forma uma data (a mensagem da RN-430). A faixa é conferida depois, contra a data do atendimento.
 */
function previsaoPedida(input: Entrada, data: string): string | null | undefined | false {
  if (input.retornoPrevistoEm === undefined && input.retornoSemanas === undefined) return undefined;
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const semanas = texto(input.retornoSemanas);
  if (semanas) return semanasValidas(semanas) && dataValida(data) ? retornoEmSemanas(data, Number(semanas)) : false;
  const dia = texto(input.retornoPrevistoEm);
  if (!dia) return null;
  return dataValida(dia) ? dia : false;
}

function validar(input: Entrada, hoje: string): { data: string; notas: string | null; orientacoes: string | null; retorno: string | null | undefined } {
  const erros: Record<string, string> = {};
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_ATENDIMENTO.data;
  else if (data > hoje) erros.data = MSG_ATENDIMENTO.futuro;
  // RN-430: entre a data do atendimento e + 730 dias, antes do banco (o CHECK é a última defesa: o 23514 levaria a linha ao log)
  const retorno = previsaoPedida(input, data);
  // com a data do atendimento inválida, só o erro da data (a faixa da previsão depende dela)
  if (!erros.data && (retorno === false || (typeof retorno === 'string' && !previsaoNaFaixa(data, retorno)))) erros.retornoPrevistoEm = MSG_ATENDIMENTO.retornoPrevisto;
  // o navegador envia quebra de linha como CRLF, mas o maxLength do textarea conta 1 caractere: normaliza antes de medir
  const limpo = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');
  const notas = limpo(input.notasPrivadas);
  if (caracteres(notas) > 20000) erros.notasPrivadas = MSG_ATENDIMENTO.notas;
  const orientacoes = limpo(input.orientacoes);
  if (caracteres(orientacoes) > 5000) erros.orientacoes = MSG_ATENDIMENTO.orientacoes;
  if (Object.keys(erros).length) throw new AtendimentoError(erros);
  return { data, notas: notas || null, orientacoes: orientacoes || null, retorno: retorno === false ? null : retorno };
}

async function gravarNota(tx: Tx, a: { tenantId: string; patientId: string; consultationId: string }, notas: string | null, now: Date) {
  if (!notas) {
    await tx.delete(consultationNotes).where(eq(consultationNotes.consultationId, a.consultationId));
    return;
  }
  await tx
    .insert(consultationNotes)
    .values({ ...a, texto: notas, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: consultationNotes.consultationId, set: { texto: notas, updatedAt: now } });
}

/**
 * US-016: atendimento do dia. Notas vazias não criam linha em consultation_notes.
 * Plano 05 ("Iniciar atendimento" na agenda): com `appointmentId`, a consulta precisa ser deste paciente, não
 * cancelada e já começada (a regra da tela, `motivoParaNaoIniciarAtendimento`); o atendimento fica ligado a ela (no máximo um por consulta) e ela vira "realizada" — inclusive a marcada
 * como "faltou" por engano: houve atendimento. Ordem das travas: paciente → consulta (a mesma da agenda).
 * Plano 20 (F-D13, RN-310): a passagem a "realizada" cobra na mesma transação; `cobranca` é nulo sem consulta ou quando ela
 * já era "realizada" (sem retroativo).
 */
export async function registrarAtendimento(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  input: Entrada,
  deps: { db?: Db; now?: Date } = {},
): Promise<{ id: string; cobranca: ResultadoCobranca | null }> {
  const now = deps.now ?? new Date();
  const v = validar(input, hojeNoFuso(tenant.fuso, now));
  const appointmentId = input.appointmentId === undefined || input.appointmentId === null || input.appointmentId === '' ? null : input.appointmentId;
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, patientId);
        let cobranca: ResultadoCobranca | null = null;
        if (appointmentId !== null) {
          const [c] = idValido(appointmentId)
            ? await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, p.id))).for('update')
            : [];
          if (!c) throw new AtendimentoError({ geral: MSG_ATENDIMENTO.consultaInvalida });
          // a regra da tela, conferida de novo sob a trava da consulta (R11: motivoParaNaoIniciarAtendimento)
          const motivo = motivoParaNaoIniciarAtendimento(c, now);
          if (motivo) throw new AtendimentoError({ geral: { cancelada: MSG_ATENDIMENTO.consultaInvalida, pedido: MSG_ATENDIMENTO.pedido, nao_comecou: MSG_ATENDIMENTO.consultaNaoComecou }[motivo] });
          if (c.status !== 'realizada') {
            await tx.update(appointments).set({ status: 'realizada', presencaEm: now, updatedAt: now }).where(eq(appointments.id, c.id));
            cobranca = await cobrarConsultaRealizada(tx, { tenantId: ctx.tenantId, fuso: tenant.fuso, consulta: { id: c.id, patientId: p.id, inicio: c.inicio } });
          }
        }
        const [c] = await tx
          .insert(consultations)
          .values({ tenantId: ctx.tenantId, patientId: p.id, data: v.data, orientacoesPaciente: v.orientacoes, retornoPrevistoEm: v.retorno ?? null, appointmentId: appointmentId as string | null, createdAt: now, updatedAt: now })
          .returning({ id: consultations.id });
        await gravarNota(tx, { tenantId: ctx.tenantId, patientId: p.id, consultationId: c.id }, v.notas, now);
        return { id: c.id, cobranca };
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'consultations_consulta_idx') throw new AtendimentoError({ geral: MSG_ATENDIMENTO.consultaJaAtendida });
    throw e;
  }
}

export async function atualizarAtendimento(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  id: string,
  input: Entrada,
  deps: { db?: Db; now?: Date } = {},
): Promise<void> {
  const now = deps.now ?? new Date();
  const v = validar(input, hojeNoFuso(tenant.fuso, now));
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (v.retorno === undefined && idValido(id)) {
        // sem os campos da previsão, ela fica — e é conferida contra a data nova antes do UPDATE (nunca o 23514, RN-430)
        const [atual] = await tx
          .select({ retorno: consultations.retornoPrevistoEm })
          .from(consultations)
          .where(and(eq(consultations.id, id), eq(consultations.patientId, p.id)))
          .for('no key update');
        if (atual?.retorno && !previsaoNaFaixa(v.data, atual.retorno)) throw new AtendimentoError({ retornoPrevistoEm: MSG_ATENDIMENTO.retornoPrevisto });
      }
      const [c] = idValido(id)
        ? await tx
            .update(consultations)
            .set({ data: v.data, orientacoesPaciente: v.orientacoes, ...(v.retorno === undefined ? {} : { retornoPrevistoEm: v.retorno }), updatedAt: now })
            .where(and(eq(consultations.id, id), eq(consultations.patientId, p.id)))
            .returning({ id: consultations.id })
        : [];
      if (!c) throw new AtendimentoError({ geral: MSG_ATENDIMENTO.naoEncontrado });
      await gravarNota(tx, { tenantId: ctx.tenantId, patientId: p.id, consultationId: c.id }, v.notas, now);
    },
    deps.db ?? getDb(),
  );
}

const COLUNAS = {
  id: consultations.id,
  data: consultations.data,
  orientacoesPaciente: consultations.orientacoesPaciente,
  // Plano 23 (RN-430): a previsão de retorno, na tela da equipe (o portal lê os atendimentos por outras funções, sem ela)
  retornoPrevistoEm: consultations.retornoPrevistoEm,
  createdAt: consultations.createdAt,
};

/**
 * Só o atendimento aberto lê a nota (e audita "Notas privadas"): a lista mostra data e orientações, e
 * lê-la com a nota gravaria "Visualizou Notas privadas" a cada visita, sem nota nenhuma na tela.
 * Numa sessão de paciente, a política staff_only devolve a nota como nula (LEFT JOIN sem linha).
 */
async function ler(tx: Tx, patientId: string, id?: string): Promise<Atendimento[]> {
  const r: Atendimento[] = id
    ? await tx
        .select({ ...COLUNAS, notasPrivadas: consultationNotes.texto })
        .from(consultations)
        .leftJoin(consultationNotes, eq(consultationNotes.consultationId, consultations.id))
        .where(and(eq(consultations.patientId, patientId), eq(consultations.id, id)))
    : (
        await tx
          .select(COLUNAS)
          .from(consultations)
          .where(eq(consultations.patientId, patientId))
          .orderBy(desc(consultations.data), desc(consultations.createdAt))
      ).map((a) => ({ ...a, notasPrivadas: null }));
  if (r.length) {
    const notas = r.some((a) => a.notasPrivadas !== null);
    await auditRead(tx, [
      { entidade: 'atendimentos', entidadeId: id ?? null, patientId },
      ...(notas ? [{ entidade: 'notas_privadas', entidadeId: id ?? null, patientId }] : []),
    ]);
  }
  return r;
}

export async function listarAtendimentos(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Atendimento[]> {
  if (!idValido(patientId)) return [];
  return withTenant(ctx, (tx) => ler(tx, patientId), db);
}

export async function buscarAtendimento(ctx: TenantContext, patientId: string, id: string, db: Db = getDb()): Promise<Atendimento | null> {
  if (!idValido(patientId) || !idValido(id)) return null;
  return (await withTenant(ctx, (tx) => ler(tx, patientId, id), db))[0] ?? null;
}

/**
 * Para o portal (Plano 06): só as orientações, só do paciente da sessão. Não toca em consultation_notes
 * — e, mesmo que tocasse, a política staff_only esconderia (US-016 "nem no JSON da API").
 * Recusa o contexto da nutricionista (devolveria as orientações de todos os pacientes) e audita a leitura.
 */
export async function orientacoesDoPaciente(ctx: TenantContext, db: Db = getDb()): Promise<{ data: string; orientacoes: string }[]> {
  const patientId = ctx.role === 'paciente' ? ctx.patientId : undefined;
  if (!patientId) throw new Error('orientacoesDoPaciente só roda em sessão de paciente');
  const r = await withTenant(
    ctx,
    async (tx) => {
      const linhas = await tx
        .select({ data: consultations.data, orientacoes: consultations.orientacoesPaciente })
        .from(consultations)
        .where(and(eq(consultations.patientId, patientId), isNotNull(consultations.orientacoesPaciente)))
        .orderBy(desc(consultations.data));
      if (linhas.length) await auditRead(tx, { entidade: 'atendimentos', entidadeId: null, patientId });
      return linhas;
    },
    db,
  );
  return r.map((x) => ({ data: x.data, orientacoes: x.orientacoes ?? '' }));
}
