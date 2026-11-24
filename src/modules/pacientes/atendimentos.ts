import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { appointments, consultationNotes, consultations } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { caracteres } from '@/lib/text';
import { motivoParaNaoIniciarAtendimento } from '@/modules/agenda/presenca';
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
} as const;

export class AtendimentoError extends Error {
  override name = 'AtendimentoError';
  constructor(readonly erros: Record<string, string>) {
    super('Atendimento inválido');
  }
}

export type Atendimento = { id: string; data: string; orientacoesPaciente: string | null; notasPrivadas: string | null; createdAt: Date };
/** `appointmentId` (Plano 05): só no registro, quando o atendimento é iniciado pela agenda; a edição ignora. */
type Entrada = { data: unknown; notasPrivadas: unknown; orientacoes: unknown; appointmentId?: unknown };

function validar(input: Entrada, hoje: string): { data: string; notas: string | null; orientacoes: string | null } {
  const erros: Record<string, string> = {};
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_ATENDIMENTO.data;
  else if (data > hoje) erros.data = MSG_ATENDIMENTO.futuro;
  // o navegador envia quebra de linha como CRLF, mas o maxLength do textarea conta 1 caractere: normaliza antes de medir
  const limpo = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');
  const notas = limpo(input.notasPrivadas);
  if (caracteres(notas) > 20000) erros.notasPrivadas = MSG_ATENDIMENTO.notas;
  const orientacoes = limpo(input.orientacoes);
  if (caracteres(orientacoes) > 5000) erros.orientacoes = MSG_ATENDIMENTO.orientacoes;
  if (Object.keys(erros).length) throw new AtendimentoError(erros);
  return { data, notas: notas || null, orientacoes: orientacoes || null };
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
          if (motivo) throw new AtendimentoError({ geral: motivo === 'cancelada' ? MSG_ATENDIMENTO.consultaInvalida : MSG_ATENDIMENTO.consultaNaoComecou });
          if (c.status !== 'realizada') {
            await tx.update(appointments).set({ status: 'realizada', presencaEm: now, updatedAt: now }).where(eq(appointments.id, c.id));
            cobranca = await cobrarConsultaRealizada(tx, { tenantId: ctx.tenantId, fuso: tenant.fuso, consulta: { id: c.id, patientId: p.id, inicio: c.inicio } });
          }
        }
        const [c] = await tx
          .insert(consultations)
          .values({ tenantId: ctx.tenantId, patientId: p.id, data: v.data, orientacoesPaciente: v.orientacoes, appointmentId: appointmentId as string | null, createdAt: now, updatedAt: now })
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
      const [c] = idValido(id)
        ? await tx
            .update(consultations)
            .set({ data: v.data, orientacoesPaciente: v.orientacoes, updatedAt: now })
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
