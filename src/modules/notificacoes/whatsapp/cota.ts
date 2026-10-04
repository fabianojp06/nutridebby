import { and, count, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { notifications, whatsappConexoes, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { inicioDoMes, inicioDoMesSeguinte, partesNoFuso } from '@/modules/agenda/fuso';
import type { TipoNotificacao } from '../tipos';

/** D15: o que conta na cota — lembretes e convite. Respostas automáticas a "1"/"2" (dentro da conversa) não contam. */
export const CONTA_COTA = ['lembrete_24h', 'lembrete_2h', 'convite_paciente'] as const satisfies readonly TipoNotificacao[];
/** Os outros tipos que saem por WhatsApp (as respostas): seguem o ritmo, mas não a cota. */
export const FORA_DA_COTA = ['resposta_confirmacao', 'resposta_remarcar'] as const satisfies readonly TipoNotificacao[];
export const contaCota = (tipo: string) => (CONTA_COTA as readonly string[]).includes(tipo);
/** 'AAAA-MM' do mês civil de `instante` no fuso do tenant (RN-09). */
export const mesDe = (instante: Date, fuso: string) => partesNoFuso(instante, fuso).data.slice(0, 7);

export const MSG_COTA = {
  uso: (usadas: number, cota: number) => `WhatsApps do mês: ${usadas} de ${cota}`,
  aviso: 'Você usou 80% dos WhatsApps do mês',
  esgotada: 'Cota de WhatsApp do mês esgotada: os lembretes seguem por e-mail e notificação no app até o mês que vem.',
} as const;

/**
 * RN-09: aceitas pela Evolution (`enviada_em`) no mês civil do tenant. `comEnviando` (reserva do envio) soma as que
 * estão saindo agora, para duas voltas não passarem da cota; o aviso e a tela contam só as aceitas.
 */
export async function usoDoMes(tx: Tx, fuso: string, agora: Date, opts: { comEnviando?: boolean } = {}): Promise<number> {
  const doMes = and(gte(notifications.enviadaEm, inicioDoMes(agora, fuso)), lt(notifications.enviadaEm, inicioDoMesSeguinte(agora, fuso)));
  const [{ n }] = await tx
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.canal, 'whatsapp'), inArray(notifications.tipo, [...CONTA_COTA]), opts.comEnviando ? or(doMes, eq(notifications.status, 'enviando')) : doMes));
  return Number(n);
}

export type NivelCota = 'ok' | 'aviso' | 'esgotada';
/** RN-09: 80% → aviso; 100% → esgotada (cota 0 = esgotada). */
export function nivelDaCota(usadas: number, cota: number): NivelCota {
  if (usadas >= cota) return 'esgotada';
  return usadas >= Math.ceil(cota * 0.8) ? 'aviso' : 'ok';
}

export type SituacaoCota = { usadas: number; cota: number; nivel: NivelCota };

/** Uso do mês para o painel (US-036): só as aceitas. */
export async function situacaoDaCota(ctx: TenantContext, tenant: Pick<TenantRow, 'fuso' | 'waCotaMensal'>, agora: Date = new Date(), db: Db = getDb()): Promise<SituacaoCota> {
  return withTenant(ctx, (tx) => situacaoDaCotaNaTransacao(tx, tenant, agora), db);
}

export async function situacaoDaCotaNaTransacao(tx: Tx, tenant: Pick<TenantRow, 'fuso' | 'waCotaMensal'>, agora: Date): Promise<SituacaoCota> {
  const usadas = await usoDoMes(tx, tenant.fuso, agora);
  return { usadas, cota: tenant.waCotaMensal, nivel: nivelDaCota(usadas, tenant.waCotaMensal) };
}

/**
 * US-036: ao chegar a 80% (ou passar), um e-mail à nutricionista por mês (`aviso_cota_mes`). Roda na transação que
 * registra o envio: trava só a linha de `whatsapp_conexoes` do tenant (e só quando marca o aviso) — nunca consultas
 * nem pacientes (revisão da T7).
 */
export async function avisarSeChegou80(tx: Tx, tenant: TenantRow, agora: Date, appUrl: string): Promise<void> {
  const usadas = await usoDoMes(tx, tenant.fuso, agora); // só as aceitas: as outras do lote ainda estão "enviando"
  if (nivelDaCota(usadas, tenant.waCotaMensal) === 'ok') return;
  const mes = mesDe(agora, tenant.fuso);
  const [marcou] = await tx
    .update(whatsappConexoes)
    .set({ avisoCotaMes: mes, updatedAt: agora })
    .where(and(eq(whatsappConexoes.tenantId, tenant.id), or(isNull(whatsappConexoes.avisoCotaMes), ne(whatsappConexoes.avisoCotaMes, mes))))
    .returning({ id: whatsappConexoes.id });
  if (!marcou) return; // já avisado neste mês
  const link = urlDoApp(appUrl, '/painel/whatsapp');
  await avisarNutri(tx, tenant.id, (para) => ({ tipo: 'cota_whatsapp', para, usadas, cota: tenant.waCotaMensal, link }));
}
