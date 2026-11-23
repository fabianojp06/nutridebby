/**
 * Plano 25 (US-440, US-450; RN-441, RN-442, RN-447, RN-453, RN-465, RN-475; CH-D39): a conversa da nutricionista com o
 * paciente — liberar (com o registro do TCLE de telenutrição), pausar, retomar e o estado que as telas mostram. O gatilho
 * chat_conversas_regras (0128) é a rede: liberação, pausa e retomada só pela sessão `nutri`, em nome da usuária, de titular
 * ativo e com o carimbo do consultório. O módulo confere antes e devolve os códigos da interface.
 *
 * Auditoria (RN-453, CH-D39): o gatilho da linha grava a entidade neutra `chat_conversa` (fora da tela: o recado também
 * cria conversas, e a pausa é um UPDATE como a liberação de uma conversa nascida de recado); o ato vai por recordAudit
 * (`chat_liberacao`, `chat_pausa`, `chat_retomada`), na mesma transação.
 *
 * Travas (RN-447): paciente → conversa → mensagem. Liberar trava o paciente FOR SHARE (o gatilho lê a situação do titular
 * sem trava e correria com um arquivar concorrente); pausar e retomar o travam FOR UPDATE (o envio do paciente também, e a
 * pausa não pode passar por um envio que já viu a conversa aberta) e só então a conversa, FOR NO KEY UPDATE.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { chatConversas, FORMAS_TCLE, patients, tenants, type FormaTcle } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { recordAudit } from '@/modules/plataforma/audit';
import { exigirNutri } from './sessao';

export type SituacaoDoTitular = 'ativo' | 'arquivado' | 'bloqueado' | 'anonimizado';
export type EstadoDaConversa = {
  existe: boolean;
  liberadaEm: Date | null;
  formaDoTcle: FormaTcle | null;
  pausada: boolean;
  titular: SituacaoDoTitular;
  temConta: boolean;
  carimbo: boolean;
};

type Titular = { id: string; status: string; anonimizadoEm: Date | null };
const situacao = (p: Titular): SituacaoDoTitular => (p.anonimizadoEm ? 'anonimizado' : (p.status as SituacaoDoTitular));
const ativo = (p: Titular) => situacao(p) === 'ativo';

/** O titular travado (paciente → conversa, RN-447). Fora do consultório (a RLS esconde) ou id inválido → não encontrado. */
async function travarTitular(tx: Tx, patientId: string, modo: 'share' | 'update'): Promise<Titular> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const [p] = await tx
    .select({ id: patients.id, status: patients.status, anonimizadoEm: patients.anonimizadoEm })
    .from(patients)
    .where(eq(patients.id, patientId))
    .for(modo);
  if (!p) throw new PacienteNaoEncontradoError();
  return p;
}

const daConversa = (tenantId: string, patientId: string) => and(eq(chatConversas.tenantId, tenantId), eq(chatConversas.patientId, patientId));

/** RN-475: o consultório tem nome profissional e CRN (o carimbo de cada mensagem da nutricionista). Nada lê a tabela `user`. */
async function temCarimbo(tx: Tx, tenantId: string): Promise<boolean> {
  const [t] = await tx.select({ nome: tenants.nomeProfissional, crn: tenants.crn }).from(tenants).where(eq(tenants.id, tenantId));
  return !!t?.nome && !!t.crn;
}

/**
 * O estado da conversa para as telas (painel e portal), na transação do chamador — sem auditRead (só a situação: liberada,
 * forma do TCLE, pausa, titular, conta e carimbo; nenhum texto). Paciente fora do consultório (ou de outra sessão de
 * paciente) ou id inválido → PacienteNaoEncontradoError.
 */
export async function estadoDaConversa(tx: Tx, patientId: string): Promise<EstadoDaConversa> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const [r] = await tx
    .select({
      status: patients.status,
      anonimizadoEm: patients.anonimizadoEm,
      temConta: sql<boolean>`${patients.userId} is not null`,
      carimbo: sql<boolean>`${tenants.nomeProfissional} is not null and ${tenants.crn} is not null`,
      conversaId: chatConversas.id,
      liberadaEm: chatConversas.liberadaEm,
      tcleForma: chatConversas.tcleForma,
      pausadaEm: chatConversas.pausadaEm,
    })
    .from(patients)
    .innerJoin(tenants, eq(tenants.id, patients.tenantId))
    .leftJoin(chatConversas, and(eq(chatConversas.tenantId, patients.tenantId), eq(chatConversas.patientId, patients.id)))
    .where(eq(patients.id, patientId));
  if (!r) throw new PacienteNaoEncontradoError();
  return {
    existe: r.conversaId !== null,
    liberadaEm: r.liberadaEm,
    formaDoTcle: r.tcleForma as FormaTcle | null,
    pausada: r.pausadaEm !== null,
    titular: r.anonimizadoEm ? 'anonimizado' : (r.status as SituacaoDoTitular),
    temConta: r.temConta,
    carimbo: r.carimbo,
  };
}

/**
 * US-440 e RN-441: libera a conversa com o registro do TCLE de telenutrição (`termo_assinado` ou `aceite_escrito`; sem a
 * forma verbal, CH-D3). A conversa pode já existir sem liberação (nascida de um recado): aí é um UPDATE da mesma linha.
 * Conferências, nesta ordem: titular ativo e não anonimizado (`titular_inativo`), conversa já liberada (`ja_liberada`) e o
 * carimbo do consultório (`sem_carimbo`); nada é gravado nesses casos. Duas liberações ao mesmo tempo: a segunda encontra a
 * linha já liberada no ON CONFLICT e devolve `ja_liberada`. A forma e a confirmação vêm validadas da tela; fora disso, Error.
 */
export async function liberarConversa(
  ctx: TenantContext,
  patientId: string,
  i: { forma: FormaTcle; confirmou: true },
  db: Db = getDb(),
): Promise<'ok' | 'ja_liberada' | 'titular_inativo' | 'sem_carimbo'> {
  exigirNutri(ctx);
  if (!i || !(FORMAS_TCLE as readonly unknown[]).includes(i.forma) || i.confirmou !== true) throw new Error('mensagens: forma do TCLE ou confirmação inválida');
  return withTenant(
    ctx,
    async (tx) => {
      const p = await travarTitular(tx, patientId, 'share');
      if (!ativo(p)) return 'titular_inativo';
      const [c] = await tx.select({ liberadaEm: chatConversas.liberadaEm }).from(chatConversas).where(daConversa(ctx.tenantId, p.id));
      if (c?.liberadaEm) return 'ja_liberada';
      if (!(await temCarimbo(tx, ctx.tenantId))) return 'sem_carimbo';
      // liberada_em: o gatilho grava clock_timestamp(); liberada_por: o gatilho confere = app_current_user()
      const r = await tx.execute<{ id: string }>(sql`
        insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma)
        values (${ctx.tenantId}, ${p.id}, now(), ${ctx.actorUserId}, ${i.forma})
        on conflict (tenant_id, patient_id) do update
          set liberada_em = excluded.liberada_em, liberada_por = excluded.liberada_por, tcle_forma = excluded.tcle_forma, updated_at = now()
          where chat_conversas.liberada_em is null
        returning id`);
      const id = r.rows[0]?.id;
      if (!id) return 'ja_liberada';
      await recordAudit(tx, { acao: 'criar', entidade: 'chat_liberacao', entidadeId: id, patientId: p.id });
      return 'ok';
    },
    db,
  );
}

/** O titular (FOR UPDATE) e depois a conversa (FOR NO KEY UPDATE), na ordem da RN-447. */
async function travarParaPausa(tx: Tx, ctx: TenantContext, patientId: string) {
  const p = await travarTitular(tx, patientId, 'update');
  if (!ativo(p)) return { p, c: null, inativo: true as const };
  const [c] = await tx
    .select({ id: chatConversas.id, liberadaEm: chatConversas.liberadaEm, pausadaEm: chatConversas.pausadaEm })
    .from(chatConversas)
    .where(daConversa(ctx.tenantId, p.id))
    .for('no key update');
  return { p, c: c ?? null, inativo: false as const };
}

/**
 * US-450 e RN-442: pausa a conversa — nem paciente nem nutricionista enviam mensagem individual; recados continuam. A
 * liberação não se desfaz. Titular arquivado, bloqueado ou anonimizado: a conversa é só para consulta (`titular_inativo`).
 */
export async function pausarConversa(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<'ok' | 'nao_liberada' | 'ja_pausada' | 'titular_inativo'> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const { p, c, inativo } = await travarParaPausa(tx, ctx, patientId);
      if (inativo) return 'titular_inativo';
      if (!c?.liberadaEm) return 'nao_liberada';
      if (c.pausadaEm) return 'ja_pausada';
      // pausada_em: o gatilho grava clock_timestamp(); pausada_por: o gatilho confere = app_current_user()
      await tx.update(chatConversas).set({ pausadaEm: sql`now()`, pausadaPor: ctx.actorUserId!, updatedAt: sql`now()` }).where(eq(chatConversas.id, c.id));
      await recordAudit(tx, { acao: 'criar', entidade: 'chat_pausa', entidadeId: c.id, patientId: p.id });
      return 'ok';
    },
    db,
  );
}

/** US-450 e RN-442: retoma a conversa pausada, sem pedir o TCLE de novo. Titular inativo: `titular_inativo`. */
export async function retomarConversa(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<'ok' | 'nao_pausada' | 'titular_inativo'> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    async (tx) => {
      const { p, c, inativo } = await travarParaPausa(tx, ctx, patientId);
      if (inativo) return 'titular_inativo';
      if (!c?.pausadaEm) return 'nao_pausada';
      await tx.update(chatConversas).set({ pausadaEm: null, pausadaPor: null, updatedAt: sql`now()` }).where(eq(chatConversas.id, c.id));
      await recordAudit(tx, { acao: 'criar', entidade: 'chat_retomada', entidadeId: c.id, patientId: p.id });
      return 'ok';
    },
    db,
  );
}
