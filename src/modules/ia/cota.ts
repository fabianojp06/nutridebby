import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaGastoPlataforma, iaTarefas, iaUso, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { usdParaMicro } from './constantes';
import type { UsoTokens } from './provedor';

/**
 * RN-104 / D3 (spec v0.3 §5.5): cota em micro-dólares. ORDEM DE TRAVAS (evita deadlock): paciente → exame → tenant
 * (`FOR NO KEY UPDATE`) → linhas de ia_tarefas → linha de ia_uso → linha do mês em ia_gasto_plataforma. Acerto e estorno
 * só descem (não travam o tenant). O aviso de 80% roda numa transação própria, depois do acerto (trava o tenant de novo).
 * O tenant é travado com NO KEY UPDATE, nunca com FOR UPDATE: toda escrita auditada (gatilho → audit_log) e toda linha
 * nova com FK para tenants pedem FOR KEY SHARE no tenant, que conflita com FOR UPDATE — o worker que já travou a tarefa
 * e grava a auditoria esperaria quem travou o tenant e espera a tarefa (ciclo, 40P01; revisão final, travas.test.ts).
 * NO KEY UPDATE segue serializando com o UPDATE de tenants (desativarIa, a admin, a suspensão), com outro pedido e com o
 * FOR SHARE do portão do envio e do passo 6.
 */
/** O teto global conta o mês civil de Brasília (um contador só para a plataforma). */
export const FUSO_DA_PLATAFORMA = 'America/Sao_Paulo';
export const mesNoFuso = (agora: Date, fuso: string) => partesNoFuso(agora, fuso).data.slice(0, 7);
const CONTAM = ['reservado', 'confirmado', 'incerto'] as const;

export class CotaIaError extends Error {
  override name = 'CotaIaError';
  constructor(readonly motivo: 'cota' | 'teto_plataforma') {
    super(`IA: ${motivo}`);
  }
}

/** Soma do mês do tenant (a RLS restringe ao tenant do withTenant). */
export async function gastoDoMes(tx: Tx, mes: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<string>`coalesce(sum(${iaUso.custoMicroUsd}), 0)` })
    .from(iaUso)
    .where(and(eq(iaUso.mes, mes), inArray(iaUso.situacao, [...CONTAM])));
  return Number(r.n);
}

/** Soma `delta` ao contador global do mês; com teto, só se couber (senão, CotaIaError("teto_plataforma")). */
async function somarNaPlataforma(tx: Tx, mes: string, delta: number, teto: number | null, agora: Date): Promise<void> {
  if (delta === 0) return;
  if (teto !== null && delta > teto) throw new CotaIaError('teto_plataforma');
  const r = await tx
    .insert(iaGastoPlataforma)
    .values({ mes, custoMicroUsd: Math.max(0, delta), updatedAt: agora })
    .onConflictDoUpdate({
      target: iaGastoPlataforma.mes,
      set: { custoMicroUsd: sql`greatest(0, ${iaGastoPlataforma.custoMicroUsd} + ${delta})`, updatedAt: agora },
      ...(teto === null ? {} : { setWhere: sql`${iaGastoPlataforma.custoMicroUsd} + ${delta} <= ${teto}` }),
    })
    .returning({ mes: iaGastoPlataforma.mes });
  if (!r.length) throw new CotaIaError('teto_plataforma');
}

async function travarTenant(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ cota: tenants.iaCotaMensalUsd, fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, tenantId)).for('no key update');
  if (!t) throw new Error('tenant não encontrado');
  return t;
}

export type Reserva = { tenantId: string; tarefaId: string; tipo: string; modelo: string; promptVersao: string; microUsd: number; agora: Date; tetoGlobalMicroUsd: number };

/** App, na transação que cria a tarefa (US-102: sem saldo, a tarefa não nasce e nada sai ao provedor). */
export async function reservar(tx: Tx, r: Reserva): Promise<void> {
  const t = await travarTenant(tx, r.tenantId);
  const mes = mesNoFuso(r.agora, t.fuso);
  if ((await gastoDoMes(tx, mes)) + r.microUsd > usdParaMicro(t.cota)) throw new CotaIaError('cota');
  await somarNaPlataforma(tx, mesNoFuso(r.agora, FUSO_DA_PLATAFORMA), r.microUsd, r.tetoGlobalMicroUsd, r.agora);
  await tx.insert(iaUso).values({
    tenantId: r.tenantId, tarefaId: r.tarefaId, tipo: r.tipo, modelo: r.modelo, promptVersao: r.promptVersao,
    custoMicroUsd: r.microUsd, situacao: 'reservado', mes, criadoEm: r.agora, updatedAt: r.agora,
  });
}

async function linhaReservada(tx: Tx, tarefaId: string) {
  const [u] = await tx.select().from(iaUso).where(eq(iaUso.tarefaId, tarefaId)).for('update');
  return u?.situacao === 'reservado' ? u : null;
}

/**
 * Worker, no portão do envio (T11): a reserva do app (teto de 15 páginas) desce ao teto das páginas contadas. Só desce —
 * como o acerto e o estorno, não trava o tenant (sem risco de deadlock com quem trava tarefa e depois tenant).
 */
export async function reduzirReserva(tx: Tx, tarefaId: string, novoMicroUsd: number, agora: Date): Promise<void> {
  const u = await linhaReservada(tx, tarefaId);
  if (!u || novoMicroUsd >= u.custoMicroUsd) return;
  await somarNaPlataforma(tx, mesNoFuso(u.criadoEm, FUSO_DA_PLATAFORMA), novoMicroUsd - u.custoMicroUsd, null, agora);
  await tx.update(iaUso).set({ custoMicroUsd: novoMicroUsd, updatedAt: agora }).where(eq(iaUso.id, u.id));
  await tx.update(iaTarefas).set({ reservaMicroUsd: novoMicroUsd, updatedAt: agora }).where(eq(iaTarefas.id, tarefaId));
}

/** O pedido saiu e voltou: a reserva vira o custo real (idempotente: só age sobre "reservado"). */
export async function acertar(
  tx: Tx,
  a: { tarefaId: string; custoMicroUsd: number; uso: UsoTokens; recusaCategoria: string | null; requestId: string | null; agora: Date },
): Promise<void> {
  const u = await linhaReservada(tx, a.tarefaId);
  if (!u) return;
  await somarNaPlataforma(tx, mesNoFuso(u.criadoEm, FUSO_DA_PLATAFORMA), a.custoMicroUsd - u.custoMicroUsd, null, a.agora);
  await tx
    .update(iaUso)
    .set({
      situacao: 'confirmado', custoMicroUsd: a.custoMicroUsd, tokensEntrada: a.uso.entrada, tokensCacheLeitura: a.uso.cacheLeitura,
      tokensCacheGravacao: a.uso.cacheGravacao, tokensSaida: a.uso.saida, inferenceGeo: a.uso.geo?.slice(0, 20) ?? null,
      recusaCategoria: a.recusaCategoria?.slice(0, 60) ?? null, requestId: a.requestId?.slice(0, 200) ?? null, updatedAt: a.agora,
    })
    .where(eq(iaUso.id, u.id));
}

/** Resultado incerto (tempo esgotado depois do envio): o provedor pode ter cobrado — a reserva fica como custo. */
export async function marcarIncerto(tx: Tx, tarefaId: string, agora: Date): Promise<void> {
  const u = await linhaReservada(tx, tarefaId);
  if (u) await tx.update(iaUso).set({ situacao: 'incerto', updatedAt: agora }).where(eq(iaUso.id, u.id));
}

/** O pedido não saiu: devolve a reserva (à cota do tenant e ao contador global). */
export async function estornar(tx: Tx, tarefaId: string, agora: Date): Promise<void> {
  const u = await linhaReservada(tx, tarefaId);
  if (!u) return;
  await somarNaPlataforma(tx, mesNoFuso(u.criadoEm, FUSO_DA_PLATAFORMA), -u.custoMicroUsd, null, agora);
  await tx.update(iaUso).set({ situacao: 'estornado', updatedAt: agora }).where(eq(iaUso.id, u.id));
}

export type SituacaoCotaIa = { usadoMicroUsd: number; cotaMicroUsd: number; percentual: number; nivel: 'ok' | 'aviso' | 'esgotada' };

function nivel(usado: number, cota: number): SituacaoCotaIa['nivel'] {
  if (usado >= cota) return 'esgotada';
  return usado >= Math.ceil(cota * 0.8) ? 'aviso' : 'ok';
}

/** US-101/US-102: "Uso da IA neste mês: {p}% do limite" (a nutricionista vê só a porcentagem). */
export async function situacaoDaCotaIa(
  ctx: TenantContext,
  tenant: Pick<TenantRow, 'fuso' | 'iaCotaMensalUsd'>,
  agora: Date = new Date(),
  db: Db = getDb(),
): Promise<SituacaoCotaIa> {
  const usado = await withTenant(ctx, (tx) => gastoDoMes(tx, mesNoFuso(agora, tenant.fuso)), db);
  const cota = usdParaMicro(tenant.iaCotaMensalUsd);
  return { usadoMicroUsd: usado, cotaMicroUsd: cota, percentual: cota > 0 ? Math.min(100, Math.floor((usado * 100) / cota)) : 100, nivel: nivel(usado, cota) };
}

/** US-102: um e-mail à nutricionista por mês ao chegar a 80% (molde de avisarSeChegou80 do WhatsApp). Transação própria. */
export async function avisarSeChegou80Ia(db: Db, tenantId: string, agora: Date, appUrl: string): Promise<void> {
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const [t] = await tx.select({ cota: tenants.iaCotaMensalUsd, fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, tenantId));
      if (!t) return;
      const mes = mesNoFuso(agora, t.fuso);
      if (nivel(await gastoDoMes(tx, mes), usdParaMicro(t.cota)) === 'ok') return;
      const [marcou] = await tx
        .update(tenants)
        .set({ iaAvisoMes: mes })
        .where(and(eq(tenants.id, tenantId), or(isNull(tenants.iaAvisoMes), ne(tenants.iaAvisoMes, mes))))
        .returning({ id: tenants.id });
      if (!marcou) return; // já avisado neste mês
      const link = urlDoApp(appUrl, '/painel/configuracoes');
      await avisarNutri(tx, tenantId, (para) => ({ tipo: 'cota_ia', para, link }));
    },
    db,
  );
}
