import { eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaNutriConsentimentos, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { lerPausa } from '@/modules/plataforma/ia-nutri-pausa';
import { conferirTextoExibidoIaNutri, IA_NUTRI_TERMO_VERSAO } from '../textos-legais';
import { MSG_IA_NUTRI } from './constantes';
import type { DepsIaNutri } from './deps';
import { consentimentoVigente, entradaNaTransacao, ultimoEvento } from './estado';
import { IaNutriError } from './participacao';
import type { DadosRevogacaoIaNutri } from './revogacao-job';

export type { TextoExibidoIaNutri } from '../textos-legais';

/** A sessão de paciente sem conta (link, convite) já é recusada pelo assertContext com ator (tenant.ts): basta exigir o ator. */
const comConta = (ctx: TenantContext) => ctx.role === 'paciente' && !!ctx.patientId && !!ctx.actorUserId;
const ua = (s: string | null | undefined) => (s ? s.slice(0, 300) : null);
const ip = (s: string | null | undefined) => (s ? s.slice(0, 45) : null);

/**
 * US-171 "Autorizo o uso da IA Nutri": paciente travado (FOR UPDATE) → a situação de agora (entrada `decidir` ou
 * `texto_mudou`) → o texto que a tela mostrou (versão e destino) confere com o de agora (senão "O texto mudou. Leia de novo
 * antes de decidir.", nada gravado) → a linha `aceite` (a política e o gatilho conferem a conta e o papel). Já vigente
 * (clique duplo, outra aba) → nada novo.
 */
export async function aceitarNoApp(ctx: TenantContext, exibido: unknown, deps: DepsIaNutri): Promise<'registrado' | 'ja_vigente'> {
  if (!comConta(ctx)) throw new Error('aceitarNoApp: só a sessão de paciente com conta');
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, ctx.patientId!)).for('update');
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      const destino = deps.ia.destino;
      if (!p || !t || !destino) throw new IaNutriError(MSG_IA_NUTRI.naoDisponivel);
      const entrada = await entradaNaTransacao(tx, p.id, t, deps.ia, deps.pausa ?? (await lerPausa(tx)));
      if (consentimentoVigente(await ultimoEvento(tx, p.id), destino)) return 'ja_vigente';
      if (entrada !== 'decidir' && entrada !== 'texto_mudou') throw new IaNutriError(MSG_IA_NUTRI.naoDisponivel);
      if (!conferirTextoExibidoIaNutri(exibido, destino)) throw new IaNutriError(MSG_IA_NUTRI.textoMudouNoToque);
      await tx.insert(iaNutriConsentimentos).values({
        tenantId: ctx.tenantId, patientId: p.id, evento: 'aceite', versao: IA_NUTRI_TERMO_VERSAO, destino, canal: 'app',
        registradoPor: ctx.actorUserId!, ip: ip(deps.ip), userAgent: ua(deps.userAgent),
      });
      return 'registrado';
    },
    deps.db ?? getDb(),
  );
}

/** O job de estorno da revogação, na transação dela (como enqueueEmail): payload só com ids (regra 3). */
async function enfileirarRevogacao(boss: PgBoss, tx: Tx, d: DadosRevogacaoIaNutri): Promise<void> {
  const job = await boss.send('ia-nutri-revogacao', d, { db: fromDrizzle(tx, sql) });
  if (!job) throw new Error('A fila recusou a revogação da IA Nutri');
}

/**
 * US-177 / RN-182: "Desativar a IA Nutri e apagar as conversas" — sempre possível (com o paciente bloqueado, o consultório
 * desligado ou a plataforma pausada). A função fechada grava a revogação e apaga o conteúdo; o estorno das reservas é do
 * job `ia-nutri-revogacao`, enfileirado NA MESMA transação (a sessão de paciente não alcança ia_uso; regra 1).
 */
export async function desativarNoApp(ctx: TenantContext, deps: DepsIaNutri): Promise<'desativada' | 'nada_a_desativar'> {
  if (!comConta(ctx)) throw new Error('desativarNoApp: só a sessão de paciente com conta');
  const boss = deps.boss ?? (await getBoss());
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx.execute(sql`select * from app_ia_nutri_revogar(${ip(deps.ip)}, ${ua(deps.userAgent)})`);
      const { revogacao_id: revogacaoId } = r.rows[0] as { revogacao_id: string | null; canceladas: number };
      if (!revogacaoId) return 'nada_a_desativar';
      await enfileirarRevogacao(boss, tx, { tenantId: ctx.tenantId, patientId: ctx.patientId!, revogacaoId });
      return 'desativada';
    },
    deps.db ?? getDb(),
  );
}

/**
 * DP-17 (LGPD art. 8º, § 5º; art. 18, IX): a desativação a pedido do paciente, registrada pela nutricionista na aba "IA
 * Nutri" da ficha — o caminho de quem não entra no app (arquivado ou bloqueado; RN-08). O consultório suspenso (RN-15) fica
 * fora: a equipe também não entra (suspenderConta revoga as sessões) — o pedido espera a reativação ou o suporte (P15-B10).
 * A mesma função fechada (canal `nutricionista`, registrado_por = a usuária da sessão), o mesmo apagamento e o mesmo job de
 * estorno. Paciente fora do tenant (a RLS esconde) → PacienteNaoEncontradoError, antes da função (que recusaria com 42501).
 */
export async function desativarPelaNutri(ctx: TenantContext, patientId: string, deps: { db?: Db; boss?: PgBoss } = {}): Promise<'desativada' | 'nada_a_desativar'> {
  if (ctx.role !== 'nutri' || !ctx.actorUserId) throw new Error('desativarPelaNutri: só a sessão da nutricionista');
  if (!idValido(patientId)) return 'nada_a_desativar';
  const boss = deps.boss ?? (await getBoss());
  const r = await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId));
      if (!p) throw new PacienteNaoEncontradoError();
      const x = await tx.execute(sql`select * from app_ia_nutri_revogar(null, null, ${p.id}::uuid)`);
      const { revogacao_id: revogacaoId } = x.rows[0] as { revogacao_id: string | null };
      if (!revogacaoId) return 'nada_a_desativar' as const;
      await enfileirarRevogacao(boss, tx, { tenantId: ctx.tenantId, patientId: p.id, revogacaoId });
      return 'desativada' as const;
    },
    deps.db ?? getDb(),
  );
  logger.info({ tenantId: ctx.tenantId, actorUserId: ctx.actorUserId, resultado: r }, 'IA Nutri desativada a pedido do paciente, pela nutricionista');
  return r;
}
