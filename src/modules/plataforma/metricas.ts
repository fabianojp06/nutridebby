import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { adminActions, tenants } from '@/db/schema';
import { logger } from '@/lib/logger';
import { dataValida } from '@/modules/pacientes/datas';
import { ContaNaoEncontradaError } from './tenant-status';

export type MetricasTenant = {
  tenantId: string;
  arquivos: number;
  armazenamentoBytes: number;
  pacientesAtivos: number | null;
  consultasMes: number | null;
  mensagensWhatsappMes: number | null;
};

const n = (v: string | number | null) => (v === null ? null : Number(v));

/** §3 / §4.1: só contagens, vindas da função SECURITY DEFINER. */
export async function metricasPorTenant(db: Db = getDb()): Promise<Map<string, MetricasTenant>> {
  const r = await db.execute<{
    tenant_id: string; arquivos: string; armazenamento_bytes: string;
    pacientes_ativos: string | null; consultas_mes: string | null; mensagens_whatsapp_mes: string | null;
  }>(sql`select * from admin_tenant_metrics()`);
  return new Map(
    r.rows.map((x) => [
      x.tenant_id,
      {
        tenantId: x.tenant_id,
        arquivos: Number(x.arquivos),
        armazenamentoBytes: Number(x.armazenamento_bytes),
        pacientesAtivos: n(x.pacientes_ativos),
        consultasMes: n(x.consultas_mes),
        mensagensWhatsappMes: n(x.mensagens_whatsapp_mes),
      },
    ]),
  );
}

export type MetricasSucessoTenant = { comConta: number; abriram: number; faltasMes: number; iniciadasMes: number };

/** D15: CS-02 e CS-03 por tenant, só contagens (função SECURITY DEFINER, 0087). */
export async function metricasDeSucessoPorTenant(db: Db = getDb()): Promise<Map<string, MetricasSucessoTenant>> {
  const r = await db.execute<{ tenant_id: string; pacientes_com_conta: string; abriram_7_dias: string; faltas_mes: string; iniciadas_mes: string }>(
    sql`select * from admin_metricas_sucesso()`,
  );
  return new Map(
    r.rows.map((x) => [x.tenant_id, { comConta: Number(x.pacientes_com_conta), abriram: Number(x.abriram_7_dias), faltasMes: Number(x.faltas_mes), iniciadasMes: Number(x.iniciadas_mes) }]),
  );
}

export const MSG_COTA_WA = 'Informe um número inteiro de 0 a 100000';
const cotaSchema = z.string().trim().regex(/^\d{1,6}$/, MSG_COTA_WA).transform(Number).pipe(z.number().max(100_000, MSG_COTA_WA));

export class CotaWhatsappError extends Error {
  override name = 'CotaWhatsappError';
}

/** §3: o admin ajusta a cota mensal de WhatsApp do tenant (RN-09 usa no Plano 05). */
export async function ajustarCotaWhatsapp(tenantId: string, valor: string, adminId: string, db: Db = getDb()): Promise<void> {
  const r = cotaSchema.safeParse(valor);
  if (!r.success) throw new CotaWhatsappError(MSG_COTA_WA);
  const up = await db.update(tenants).set({ waCotaMensal: r.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
  if (!up.length) throw new ContaNaoEncontradaError();
  logger.info({ tenantId, adminId, cota: r.data }, 'cota de WhatsApp ajustada');
}

export const MSG_METRICAS = {
  taxa: 'Informe um percentual de 0 a 100',
  data: 'Informe a data no formato dd/mm/aaaa',
} as const;

// até duas casas, como a coluna numeric(5,2); vírgula ou ponto (RNF-12)
const taxaSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{1,3}([.,]\d{1,2})?$/.test(v), MSG_METRICAS.taxa)
  .transform((v) => (v === '' ? null : Number(v.replace(',', '.'))))
  .refine((v) => v === null || v <= 100, MSG_METRICAS.taxa);
const dataSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || dataValida(v), MSG_METRICAS.data)
  .transform((v) => (v === '' ? null : v));

/**
 * D15: o admin grava a base do CS-03 (E-08) e o início do uso (CS-01). `tenants` não tem RLS; o id vem da tela do admin.
 * Fica neste módulo (e não em metricas-sucesso.ts, que tem as leituras da nutricionista) para a guarda
 * sem-tabelas-tenant.test.ts conferir o caminho do admin (regra 1: o admin nunca consulta tabelas 🔒).
 */
export async function salvarMetricasBase(tenantId: string, entrada: { taxaBase: string; goLiveEm: string }, adminId: string, db: Db = getDb()): Promise<void> {
  const taxa = taxaSchema.safeParse(entrada.taxaBase);
  if (!taxa.success) throw new Error(MSG_METRICAS.taxa);
  const data = dataSchema.safeParse(entrada.goLiveEm);
  if (!data.success) throw new Error(MSG_METRICAS.data);
  const up = await db
    .update(tenants)
    .set({ taxaFaltasBase: taxa.data, goLiveEm: data.data, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning({ id: tenants.id });
  if (!up.length) throw new ContaNaoEncontradaError(); // M9, como ajustarCotaWhatsapp
  logger.info({ tenantId, adminId }, 'métricas de sucesso ajustadas');
}

export const MSG_COTA_IA = 'Informe um valor entre 0 e 1000';
const cotaIaSchema = z
  .string()
  .trim()
  .regex(/^\d{1,4}([.,]\d{1,2})?$/, MSG_COTA_IA)
  .transform((v) => Number(v.replace(',', '.')))
  .pipe(z.number().max(1000, MSG_COTA_IA));

export class CotaIaAdminError extends Error {
  override name = 'CotaIaAdminError';
}

/** US-100: limite mensal de IA (US$) do consultório; trilha em admin_actions; o valor só no log (como a cota de WhatsApp). */
export async function ajustarCotaIa(tenantId: string, valor: string, adminId: string, db: Db = getDb()): Promise<void> {
  const r = cotaIaSchema.safeParse(valor);
  if (!r.success) throw new CotaIaAdminError(MSG_COTA_IA);
  await db.transaction(async (tx) => {
    const up = await tx.update(tenants).set({ iaCotaMensalUsd: r.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
    if (!up.length) throw new ContaNaoEncontradaError();
    await tx.insert(adminActions).values({ adminUserId: adminId, acao: 'ajustar_cota_ia', alvoTenantId: tenantId, origem: 'admin' });
  });
  logger.info({ tenantId, adminId, cotaIaUsd: r.data }, 'limite de IA ajustado');
}

/**
 * Plano 15 (D3, US-176): limite mensal da IA Nutri (US$, escopo paciente) do consultório, no molde de ajustarCotaIa — mesma
 * validação e mensagem, trilha `ajustar_cota_ia_nutri` em admin_actions, o valor só no log.
 */
export async function ajustarCotaIaNutri(tenantId: string, valor: string, adminId: string, db: Db = getDb()): Promise<void> {
  const r = cotaIaSchema.safeParse(valor);
  if (!r.success) throw new CotaIaAdminError(MSG_COTA_IA);
  await db.transaction(async (tx) => {
    const up = await tx.update(tenants).set({ iaNutriCotaMensalUsd: r.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
    if (!up.length) throw new ContaNaoEncontradaError();
    await tx.insert(adminActions).values({ adminUserId: adminId, acao: 'ajustar_cota_ia_nutri', alvoTenantId: tenantId, origem: 'admin' });
  });
  logger.info({ tenantId, adminId, cotaIaNutriUsd: r.data }, 'limite da IA Nutri ajustado');
}

export type MetricasIaTenant = { tarefasMes: number; custoMesMicroUsd: number };
export type MetricasIaNutriTenant = { perguntasMes: number; usosMes: number; custoMesMicroUsd: number };
type LinhaMetricasIa = {
  tenant_id: string;
  perguntas_mes: string;
  usos_mes: string;
  custo_mes_micro_usd: string;
  nutri_tarefas_mes: string;
  nutri_custo_mes_micro_usd: string;
};

/**
 * US-100 (A-06) e DP-11 (Plano 15): a IA da NUTRICIONISTA (comparada com a cota dela) e a IA Nutri (escopo paciente), de UMA
 * chamada à função SECURITY DEFINER admin_metricas_ia_nutri() (0117) — os dois escopos saem do mesmo SELECT por tenant, só
 * contagens e somas do mês. /code-review do PR #37: subtrair a IA Nutri de uma segunda chamada (à 0099, que soma tudo) lia
 * dois momentos diferentes e podia dar "-1 tarefa" ou custo negativo; a 0099 não é mais lida pelo app.
 */
export async function metricasDeIaPorEscopo(db: Db = getDb()): Promise<Map<string, { nutri: MetricasIaTenant; paciente: MetricasIaNutriTenant }>> {
  const r = await db.execute<LinhaMetricasIa>(sql`select * from admin_metricas_ia_nutri()`);
  return new Map(
    r.rows.map((x) => [
      x.tenant_id,
      {
        nutri: { tarefasMes: Number(x.nutri_tarefas_mes), custoMesMicroUsd: Number(x.nutri_custo_mes_micro_usd) },
        paciente: { perguntasMes: Number(x.perguntas_mes), usosMes: Number(x.usos_mes), custoMesMicroUsd: Number(x.custo_mes_micro_usd) },
      },
    ]),
  );
}

/** US-100: só a IA da nutricionista (os chamadores atuais não mudam; a conversa do paciente fica de fora, DP-11). */
export async function metricasDeIaPorTenant(db: Db = getDb()): Promise<Map<string, MetricasIaTenant>> {
  return new Map([...(await metricasDeIaPorEscopo(db))].map(([id, m]) => [id, m.nutri]));
}

/** Plano 15 (§3): só a IA Nutri (perguntas que foram ao modelo, usos e custo do mês). */
export async function metricasDeIaNutriPorTenant(db: Db = getDb()): Promise<Map<string, MetricasIaNutriTenant>> {
  return new Map([...(await metricasDeIaPorEscopo(db))].map(([id, m]) => [id, m.paciente]));
}

export type MetricasExamesTenant = { enviadosMes: number; pendentes: number };

/** Plano 12 (§3): envios de exame do mês e aguardando revisão, só contagens (função SECURITY DEFINER, 0102). */
export async function metricasDeExamesEnviadosPorTenant(db: Db = getDb()): Promise<Map<string, MetricasExamesTenant>> {
  const r = await db.execute<{ tenant_id: string; enviados_mes: string; pendentes: string }>(sql`select * from admin_metricas_exames_enviados()`);
  return new Map(r.rows.map((x) => [x.tenant_id, { enviadosMes: Number(x.enviados_mes), pendentes: Number(x.pendentes) }]));
}
