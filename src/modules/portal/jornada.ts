import { and, asc, count, desc, eq, gt, inArray, min } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { anthropometry, appointments, consultations } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { MAX_CONSULTAS_FUTURAS_PUBLICO } from '@/modules/agenda/constantes';
import { listarConsultasNaTransacao, STATUS_ATIVOS, type Consulta, type TenantAgenda } from '@/modules/agenda/consultas';
import { pesoOcultoNaTransacao } from '@/modules/pacientes/peso-oculto';
import { auditRead } from '@/modules/plataforma/audit';
import { miniJornada, montarJornada, type AvaliacaoDaJornada, type Jornada, type MiniJornada } from './jornada-regras';
import { pacienteDaSessao } from './sessao';

// P08-13: o paciente também no filtro (a RLS já restringe; assim a consulta usa o índice do paciente, não o do tenant)
const futuras = (tx: Tx, patientId: string, agora: Date) =>
  listarConsultasNaTransacao(tx, and(eq(appointments.patientId, patientId), inArray(appointments.status, [...STATUS_ATIVOS]), gt(appointments.fim, agora)), { ordem: 'asc', limite: 20 });
// T-1 (Plano 05): o mesmo teto do servidor (RN-16): ativas que ainda vão começar
const podeAgendar = (lista: Consulta[], agora: Date) => lista.filter((c) => c.inicio > agora).length < MAX_CONSULTAS_FUTURAS_PUBLICO;

/** As avaliações do paciente; com o peso oculto (RN-203) peso_kg e imc nem saem do banco. Sem dobras nem densidade (P06 D14). */
async function avaliacoesNaTransacao(tx: Tx, patientId: string, o: { semPeso: boolean; percGordura: boolean }): Promise<AvaliacaoDaJornada[]> {
  const base = { id: anthropometry.id, data: anthropometry.data, consultationId: anthropometry.consultationId, percGordura: anthropometry.percGordura, circunferencias: anthropometry.circunferencias };
  const ordem = [desc(anthropometry.data), desc(anthropometry.createdAt)] as const;
  const linhas = o.semPeso
    ? (await tx.select(base).from(anthropometry).where(eq(anthropometry.patientId, patientId)).orderBy(...ordem)).map((a) => ({ ...a, pesoKg: null, imc: null }))
    : await tx.select({ ...base, pesoKg: anthropometry.pesoKg, imc: anthropometry.imc }).from(anthropometry).where(eq(anthropometry.patientId, patientId)).orderBy(...ordem);
  return linhas.map((a) => ({ ...a, percGordura: o.percGordura ? a.percGordura : null, circunferencias: a.circunferencias ?? {} }));
}

/**
 * Plano 16 (§4.5, US-194): atendimentos (data e orientação ao paciente — nunca a nota privada, staff_only), avaliações e a
 * próxima consulta, numa transação com o contexto do paciente. auditRead de atendimentos e de antropometria (como
 * orientacoesDoPaciente e listarAntropometrias); a agenda sem auditRead (P05 D10). Com o peso oculto, sem gráfico de
 * medida corporal em destaque (G-D16 a).
 */
export async function jornadaDoPaciente(ctx: TenantContext, tenant: TenantAgenda & { mostrarPercGorduraPaciente: boolean }, agora: Date, db: Db = getDb()): Promise<Jornada> {
  const patientId = pacienteDaSessao(ctx, 'jornadaDoPaciente');
  const d = await withTenant(
    ctx,
    async (tx) => {
      const semPeso = await pesoOcultoNaTransacao(tx, patientId);
      const atendimentos = await tx
        .select({ id: consultations.id, data: consultations.data, orientacao: consultations.orientacoesPaciente })
        .from(consultations)
        .where(eq(consultations.patientId, patientId))
        .orderBy(desc(consultations.data));
      if (atendimentos.length) await auditRead(tx, { entidade: 'atendimentos', entidadeId: null, patientId });
      const avaliacoes = await avaliacoesNaTransacao(tx, patientId, { semPeso, percGordura: tenant.mostrarPercGorduraPaciente });
      if (avaliacoes.length) await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId });
      return { semPeso, atendimentos, avaliacoes, futuras: await futuras(tx, patientId, agora) };
    },
    db,
  );
  const p = d.futuras[0];
  return montarJornada(
    {
      atendimentos: d.atendimentos,
      avaliacoes: d.avaliacoes,
      proxima: p ? { id: p.id, inicio: p.inicio, modalidade: p.modalidade } : null,
      podeAgendar: podeAgendar(d.futuras, agora),
      percGordura: tenant.mostrarPercGorduraPaciente,
      pesoOculto: d.semPeso,
    },
    agora,
    tenant.fuso,
  );
}

/**
 * RN-202: a mini-jornada da faixa de Hoje. Com o peso visível, lê só data e peso (auditRead de antropometria); com o peso
 * oculto, não lê a antropometria (conta atendimentos — sem conteúdo, sem auditRead).
 */
export async function miniJornadaDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db: Db = getDb()): Promise<MiniJornada> {
  const patientId = pacienteDaSessao(ctx, 'miniJornadaDoPaciente');
  return withTenant(ctx, (tx) => miniJornadaNaTransacao(tx, patientId, tenant, agora), db);
}

/** P08-13: o mesmo, dentro da transação da faixa de Hoje (faixaDeHoje), com o contexto do paciente; o auditRead fica nela. */
export async function miniJornadaNaTransacao(tx: Tx, patientId: string, tenant: Pick<TenantAgenda, 'fuso'>, agora: Date): Promise<MiniJornada> {
  const semPeso = await pesoOcultoNaTransacao(tx, patientId);
  const pesos = semPeso
    ? []
    : await tx.select({ data: anthropometry.data, valor: anthropometry.pesoKg }).from(anthropometry).where(eq(anthropometry.patientId, patientId)).orderBy(asc(anthropometry.data), asc(anthropometry.createdAt));
  if (pesos.length) await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId });
  const [c] = await tx.select({ n: count(), primeira: min(consultations.data) }).from(consultations).where(eq(consultations.patientId, patientId));
  const d = { pesos, atendimentos: c?.n ?? 0, primeira: c?.primeira ?? null, futuras: await futuras(tx, patientId, agora) };
  return miniJornada(
    { pesos: d.pesos, atendimentos: d.atendimentos, primeiroAtendimento: d.primeira, proxima: d.futuras[0] ? { inicio: d.futuras[0].inicio } : null, podeAgendar: podeAgendar(d.futuras, agora) },
    agora,
    tenant.fuso,
  );
}
