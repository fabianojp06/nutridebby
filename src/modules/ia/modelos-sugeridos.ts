import { randomUUID } from 'node:crypto';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { iaGeracoesModelos, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { getBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { idValido } from '@/modules/pacientes/base';
import { avisarTetoGlobal } from './alertas';
import { AREAS_MODELOS_IA, MSG_IA, MSG_MODELOS_IA, TETO_PACOTE_MODELOS_USD, usdParaMicro, type AreaModelosIA, type MotivoFalha, type StatusGeracao } from './constantes';
import { CotaIaError, reservar } from './cota';
import { PROMPT_VERSAO_MODELOS } from './instrucoes/modelos';
import { estadoIaDoTenant, type EstadoIaTenant } from './modo';
import { PedidoIaError, type DepsPedido } from './tarefas';

const mensagemDoEstado = (e: EstadoIaTenant) => (e === 'aditivo_desatualizado' ? MSG_IA.aditivoDesatualizado : MSG_IA.indisponivel);

/**
 * Plano 14B (US-123, RN-124, D19): o pedido de um pacote de modelos por área. Sem paciente: RN-100 só na parte da
 * plataforma e do consultório (sem a retenção, A-D22 (c)). Ordem de travas: tenant (FOR NO KEY UPDATE, a mesma da
 * reserva) → geração. Um pacote em andamento por consultório (índice único parcial). Reserva fixa de US$ 1,00. A geração
 * e o job nascem na mesma transação (o job só existe se a geração existir); o payload da fila leva só ids.
 */
export async function pedirModelos(ctx: TenantContext, tenant: TenantRow, area: unknown, deps: DepsPedido): Promise<string> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (typeof area !== 'string' || !(AREAS_MODELOS_IA as readonly string[]).includes(area)) throw new PedidoIaError(MSG_MODELOS_IA.areaInvalida);
  const estado = estadoIaDoTenant(tenant, deps.ia.modo); // atalho barato; a decisão vale sob a trava, abaixo
  if (estado !== 'ativa') throw new PedidoIaError(mensagemDoEstado(estado));
  if (!ctx.actorUserId) throw new PedidoIaError(MSG_IA.indisponivel);
  const pedidoPor = ctx.actorUserId;
  const boss = deps.boss ?? (await getBoss());
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        // D16 (Plano 11): decide com a linha travada do tenant de `ctx` (desativar, bloqueio, suspensão ou aditivo trocado
        // entre a leitura e a trava não deixam geração nem reserva). A reserva trava a mesma linha de novo (sem efeito).
        const [tn] = await tx
          .select({ status: tenants.status, iaLiberada: tenants.iaLiberada, iaAtivadaEm: tenants.iaAtivadaEm, iaAditivoVersao: tenants.iaAditivoVersao })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .for('no key update');
        const travado = tn ? estadoIaDoTenant(tn, deps.ia.modo) : 'suspensa';
        if (travado !== 'ativa') throw new PedidoIaError(mensagemDoEstado(travado));
        // RN-103 / D19: um pacote por vez (o índice único parcial segura a corrida; esta leitura dá o texto sem 23505)
        const [andamento] = await tx.select({ id: iaGeracoesModelos.id }).from(iaGeracoesModelos).where(inArray(iaGeracoesModelos.status, ['na_fila', 'processando']));
        if (andamento) throw new PedidoIaError(MSG_MODELOS_IA.umPorVez);
        const id = randomUUID();
        const microUsd = usdParaMicro(TETO_PACOTE_MODELOS_USD);
        await reservar(tx, { tenantId: ctx.tenantId, tarefaId: id, tipo: 'modelos_area', modelo: deps.ia.modeloAssistente, promptVersao: PROMPT_VERSAO_MODELOS, microUsd, agora, tetoGlobalMicroUsd: deps.ia.tetoGlobalMicroUsd });
        await tx.insert(iaGeracoesModelos).values({
          id, tenantId: ctx.tenantId, area, status: 'na_fila', pedidoPor, modelo: deps.ia.modeloAssistente, promptVersao: PROMPT_VERSAO_MODELOS,
          reservaMicroUsd: microUsd, criadoEm: agora, updatedAt: agora,
        });
        const job = await boss.send('ia-assistente', { tenantId: ctx.tenantId, geracaoId: id }, { db: fromDrizzle(tx, sql) });
        if (!job) throw new Error('A fila recusou o pedido de IA');
        return id;
      },
      db,
    );
  } catch (e) {
    if (uniqueViolation(e) === 'ia_geracoes_modelos_em_andamento_idx') throw new PedidoIaError(MSG_MODELOS_IA.umPorVez);
    if (e instanceof CotaIaError) {
      if (e.motivo === 'teto_plataforma') {
        const avisar = deps.avisarTeto ?? ((a: Date) => avisarTetoGlobal(db, a, getEnv().APP_URL));
        await avisar(agora).catch((err: unknown) => logger.error({ err: err instanceof Error ? err.name : 'erro' }, 'falha ao avisar os admins do teto da IA'));
      }
      throw new PedidoIaError(e.motivo === 'cota' ? MSG_IA.cotaAcabou : MSG_IA.indisponivel);
    }
    throw e;
  }
}

export type SituacaoDasAreas = Record<AreaModelosIA, { geradoEm: Date | null; emAndamento: { id: string } | null; falhou: MotivoFalha | null }>;

/**
 * US-123 "Gerado em {data}" (a última pronta de cada área), o pacote em andamento e a falha do último pedido da área — só
 * situação, sem conteúdo (não há dado de saúde, nem auditoria).
 */
export async function situacaoDasAreas(ctx: TenantContext, db: Db = getDb()): Promise<SituacaoDasAreas> {
  const { ultimas, prontas } = await withTenant(
    ctx,
    async (tx) => ({
      ultimas: await tx
        .selectDistinctOn([iaGeracoesModelos.area], { id: iaGeracoesModelos.id, area: iaGeracoesModelos.area, status: iaGeracoesModelos.status, erro: iaGeracoesModelos.erro })
        .from(iaGeracoesModelos)
        .orderBy(iaGeracoesModelos.area, desc(iaGeracoesModelos.criadoEm)),
      prontas: await tx
        .selectDistinctOn([iaGeracoesModelos.area], { area: iaGeracoesModelos.area, concluidoEm: iaGeracoesModelos.concluidoEm })
        .from(iaGeracoesModelos)
        .where(eq(iaGeracoesModelos.status, 'pronta'))
        .orderBy(iaGeracoesModelos.area, desc(iaGeracoesModelos.concluidoEm)),
    }),
    db,
  );
  const s = Object.fromEntries(AREAS_MODELOS_IA.map((a) => [a, { geradoEm: null, emAndamento: null, falhou: null }])) as SituacaoDasAreas;
  for (const p of prontas) if (p.area in s) s[p.area as AreaModelosIA].geradoEm = p.concluidoEm;
  for (const l of ultimas) {
    if (!(l.area in s)) continue;
    const a = s[l.area as AreaModelosIA];
    if (l.status === 'na_fila' || l.status === 'processando') a.emAndamento = { id: l.id };
    else if (l.status === 'falhou') a.falhou = (l.erro as MotivoFalha | null) ?? null;
  }
  return s;
}

/** RNF-100: o painel consulta a situação do pacote (GET sem auditoria, só status). */
export async function estadoDaGeracao(ctx: TenantContext, id: string, db: Db = getDb()): Promise<{ status: StatusGeracao; erro: MotivoFalha | null } | null> {
  if (!idValido(id)) return null;
  const [g] = await withTenant(ctx, (tx) => tx.select({ status: iaGeracoesModelos.status, erro: iaGeracoesModelos.erro }).from(iaGeracoesModelos).where(eq(iaGeracoesModelos.id, id)), db);
  return g ? { status: g.status as StatusGeracao, erro: (g.erro as MotivoFalha | null) ?? null } : null;
}
