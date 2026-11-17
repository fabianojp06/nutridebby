/**
 * Plano 17 (§5.3, Tarefa 6): os lembretes de rotina pelo próprio paciente — o que Eu › Lembretes lê e muda, e o sim/não
 * de Eu e de Hoje. Sempre pela sessão do paciente (withTenant com o `patientId` da sessão; a RLS só deixa ver as próprias
 * linhas). O paciente só desliga/religa cada lembrete (`desligado_pelo_paciente_em`) e pausa/retoma todos
 * (`patients.lembretes_pausados_em`); o gatilho da 0119 grava o relógio do banco ao desligar e ao pausar.
 *
 * Regra de precisão: nunca reenviar um valor lido dessas colunas (o Date do JS perde os microssegundos). Aqui só vão
 * `new Date()` (o banco troca pelo clock_timestamp()) ou null, e só quando o estado muda (UPDATE condicional).
 */
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { lembretesRotina, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { pacienteDaSessao } from '@/modules/portal/sessao';
import { validarConfig, type LembreteNovo } from './config';
import { rotuloDaAntecedencia, rotuloDoIntervalo, rotuloDosDias, rotuloDosHorarios } from './constantes';

export type LembreteDoPaciente = { id: string; tipo: LembreteNovo['tipo']; resumo: string; textoDaNutri: string | null; desligado: boolean };

export const MSG_LEMBRETES_PACIENTE = {
  naoEncontrado: 'Lembrete não encontrado. Recarregue a página.',
} as const;

/** O lembrete não é do paciente da sessão (ou não existe mais): a RLS não o deixa ver. */
export class LembreteDoPacienteError extends Error {
  override name = 'LembreteDoPacienteError';
  constructor() {
    super(MSG_LEMBRETES_PACIENTE.naoEncontrado);
  }
}

const ORDEM_TIPO: Record<LembreteNovo['tipo'], number> = { agua: 0, refeicoes: 1, suplemento: 2, livre: 3 };

/** O resumo da tela, com os formatadores do painel (`constantes.ts`). Sem o texto da nutricionista (vai em `textoDaNutri`). */
function resumo(l: ReturnType<typeof validarConfig> & { ok: true }): string {
  const v = l.valor;
  switch (v.tipo) {
    case 'agua':
      return `Água: das ${v.config.inicio} às ${v.config.fim}, a cada ${rotuloDoIntervalo(v.config.intervaloMin)} · ${rotuloDosDias(v.config.dias)}`;
    case 'refeicoes':
      return `Refeições: aviso ${rotuloDaAntecedencia(v.config.antecedenciaMin)}, nas refeições do seu plano`;
    case 'suplemento':
      return `Suplemento: ${rotuloDosHorarios(v.config.horarios)} · ${rotuloDosDias(v.config.dias)}`;
    case 'livre':
      return `Lembrete: ${rotuloDosHorarios(v.config.horarios)} · ${rotuloDosDias(v.config.dias)}`;
  }
}

/**
 * Os lembretes ligados pela equipe (o desligado por ela não aparece; o desligado pelo paciente aparece como `desligado`)
 * e a pausa geral. A config é revalidada (`validarConfig`): linha malformada é pulada, sem derrubar a tela. Leitura
 * auditada (`auditRead`, entidade `lembretes`, CLAUDE.md regra 8) quando devolve algum lembrete — o nome do suplemento e o
 * texto livre são parte da conduta.
 */
export async function meusLembretes(ctx: TenantContext, deps: { db?: Db } = {}): Promise<{ lembretes: LembreteDoPaciente[]; pausadoEm: Date | null }> {
  const patientId = pacienteDaSessao(ctx, 'meusLembretes');
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ pausadoEm: patients.lembretesPausadosEm }).from(patients).where(eq(patients.id, patientId));
      const linhas = await tx
        .select({ id: lembretesRotina.id, tipo: lembretesRotina.tipo, config: lembretesRotina.config, texto: lembretesRotina.texto, desligadoEm: lembretesRotina.desligadoPeloPacienteEm })
        .from(lembretesRotina)
        .where(and(eq(lembretesRotina.patientId, patientId), eq(lembretesRotina.ligado, true)))
        .orderBy(asc(lembretesRotina.createdAt), asc(lembretesRotina.id));
      const lembretes = linhas
        .flatMap((r): LembreteDoPaciente[] => {
          const tipo = r.tipo as LembreteNovo['tipo'];
          const v = validarConfig(tipo, r.config);
          if (!v.ok) return [];
          const comTexto = tipo === 'suplemento' || tipo === 'livre';
          return [{ id: r.id, tipo, resumo: resumo(v), textoDaNutri: comTexto ? r.texto : null, desligado: r.desligadoEm !== null }];
        })
        .sort((a, b) => ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]); // estável: dentro do tipo, a ordem de criação
      if (lembretes.length) await auditRead(tx, { entidade: 'lembretes', entidadeId: null, patientId });
      return { lembretes, pausadoEm: p?.pausadoEm ?? null };
    },
    deps.db ?? getDb(),
  );
}

/**
 * Interruptor do paciente: `desligar` grava a marca (o banco põe o relógio dele), religar a limpa. Só quando o estado muda
 * (desligar de novo não troca a data). `updated_at` novo: ao religar, o worker não manda um slot de antes do religamento.
 * Lembrete de outro paciente, apagado ou id qualquer → LembreteDoPacienteError.
 */
export async function desligarMeuLembrete(ctx: TenantContext, id: string, desligar: boolean, deps: { db?: Db } = {}): Promise<void> {
  const patientId = pacienteDaSessao(ctx, 'desligarMeuLembrete');
  if (!idValido(id)) throw new LembreteDoPacienteError();
  await withTenant(
    ctx,
    async (tx) => {
      const doPaciente = and(eq(lembretesRotina.id, id), eq(lembretesRotina.patientId, patientId));
      const mudou = await tx
        .update(lembretesRotina)
        .set({ desligadoPeloPacienteEm: desligar ? new Date() : null, updatedAt: new Date() })
        .where(and(doPaciente, desligar ? isNull(lembretesRotina.desligadoPeloPacienteEm) : isNotNull(lembretesRotina.desligadoPeloPacienteEm)))
        .returning({ id: lembretesRotina.id });
      if (mudou.length) return;
      const [existe] = await tx.select({ id: lembretesRotina.id }).from(lembretesRotina).where(doPaciente);
      if (!existe) throw new LembreteDoPacienteError();
    },
    deps.db ?? getDb(),
  );
}

/** "Pausar todos os lembretes" / "Retomar os lembretes": só quando o estado muda (pausar de novo não troca a data). */
export async function pausarMeusLembretes(ctx: TenantContext, pausar: boolean, deps: { db?: Db } = {}): Promise<void> {
  const patientId = pacienteDaSessao(ctx, 'pausarMeusLembretes');
  await withTenant(
    ctx,
    (tx) =>
      tx
        .update(patients)
        .set({ lembretesPausadosEm: pausar ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(patients.id, patientId), pausar ? isNull(patients.lembretesPausadosEm) : isNotNull(patients.lembretesPausadosEm))),
    deps.db ?? getDb(),
  );
}

/**
 * Só sim/não (sem `auditRead`: nada do lembrete sai daqui): algum lembrete ligado pela equipe e não desligado pelo
 * paciente. A pausa geral não conta — Eu continua levando à tela onde se retoma.
 */
export async function temLembretes(ctx: TenantContext, deps: { db?: Db } = {}): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'temLembretes');
  const r = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: lembretesRotina.id })
        .from(lembretesRotina)
        .where(and(eq(lembretesRotina.patientId, patientId), eq(lembretesRotina.ligado, true), isNull(lembretesRotina.desligadoPeloPacienteEm)))
        .limit(1),
    deps.db ?? getDb(),
  );
  return r.length > 0;
}

/**
 * Revisão da Tarefa 6 (T6-01): Eu mostra a seção Lembretes enquanto houver lembrete ligado pela equipe — o mesmo conjunto
 * que `meusLembretes` lista —, mesmo que o paciente tenha desligado todos ou pausado: é o único caminho para religar (§5.3,
 * só o paciente religa o que desligou). Só sim/não, sem `auditRead`. O cartão de Hoje continua com `temLembretes`.
 */
export async function temLembretesNaTela(ctx: TenantContext, deps: { db?: Db } = {}): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'temLembretesNaTela');
  const r = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: lembretesRotina.id })
        .from(lembretesRotina)
        .where(and(eq(lembretesRotina.patientId, patientId), eq(lembretesRotina.ligado, true)))
        .limit(1),
    deps.db ?? getDb(),
  );
  return r.length > 0;
}
