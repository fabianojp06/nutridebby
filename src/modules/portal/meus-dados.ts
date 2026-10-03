import { and, eq, gt, inArray, or } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { dataExports, patients, privacyRequests } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { formatarData, formatarDataNoFuso, hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import {
  estadoDaExportacao,
  PENDENTE_MAX_MS,
  solicitarExportacao,
  type EstadoExportacao,
} from '@/modules/pacientes/exportacao';
import { PRAZO_RESPOSTA_DIAS } from '@/modules/pacientes/lgpd';
import { pacienteDaSessao } from './sessao';

export const MSG_MEUS_DADOS = {
  pedido: 'Pedimos seus dados. O link chega por e-mail e vale por 24 horas.',
  jaPedido: 'Você já pediu seus dados nas últimas 24 horas. O link chega por e-mail.',
  exclusaoRegistrada: 'Pedido de exclusão registrado. Enviamos a confirmação para o seu e-mail.',
  exclusaoJaPedida: (data: string) => `Seu pedido de exclusão já foi registrado em ${data}.`,
  pronta: (quando: string) => `O arquivo está pronto. O link vale até ${quando}.`,
  preparando: 'Ainda estamos preparando seus dados. Volte em alguns minutos.',
  expirada: 'Este link expirou. Peça os dados de novo em Perfil.',
  falhou: 'Não foi possível gerar seus dados. Peça de novo em Perfil.',
} as const;

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** US-046 "Exportar meus dados" / D16: o ZIP da US-018 no escopo do titular, no máximo 1 a cada 24 h. */
export async function pedirMeusDados(
  ctx: TenantContext,
  deps: { db?: Db; agora?: Date; boss?: PgBoss } = {},
): Promise<'pedido' | 'ja_pedido'> {
  const patientId = pacienteDaSessao(ctx, 'pedirMeusDados');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const [recente] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: dataExports.id })
        .from(dataExports)
        .where(
          and(
            eq(dataExports.patientId, patientId),
            eq(dataExports.escopo, 'titular'),
            gt(dataExports.createdAt, new Date(agora.getTime() - UM_DIA_MS)),
            // "falhou" não conta; pendente há mais de 30 min é job perdido (solicitarExportacao o marca "falhou"
            // e cria outro) — sem isto o titular ficaria 24 h preso a um pedido que nunca chega
            or(
              inArray(dataExports.status, ['pronta', 'expirada']),
              and(
                eq(dataExports.status, 'pendente'),
                gt(dataExports.createdAt, new Date(agora.getTime() - PENDENTE_MAX_MS)),
              ),
            ),
          ),
        )
        .limit(1),
    db,
  );
  if (recente) return 'ja_pedido';
  await solicitarExportacao(ctx, patientId, { db, now: agora, boss: deps.boss, escopo: 'titular' });
  return 'pedido';
}

/**
 * A página do link do e-mail: só pedidos do escopo titular do próprio paciente (o da equipe pode ter o
 * rascunho — D16). Entregar o link é leitura auditada (estadoDaExportacao, R14 c).
 */
export async function estadoDosMeusDados(
  ctx: TenantContext,
  exportId: string,
  o: { db?: Db; agora?: Date } = {},
): Promise<EstadoExportacao> {
  const patientId = pacienteDaSessao(ctx, 'estadoDosMeusDados');
  return estadoDaExportacao(ctx, patientId, exportId, o.db ?? getDb(), o.agora ?? new Date(), { escopo: 'titular' });
}

/**
 * US-046 "Pedir exclusão" / D17: um pedido aberto por vez (índice único parcial; a linha do paciente travada
 * serializa dois cliques), prazo de 15 dias no fuso do tenant, e-mail ao titular; a nutricionista vê no quadro
 * "Pedidos do titular" e atende pela aba Privacidade (US-018).
 */
export async function pedirExclusao(
  ctx: TenantContext,
  tenant: { fuso: string; nomeExibicao: string },
  deps: { db?: Db; agora?: Date } = {},
): Promise<{ registrado: true } | { jaPedidoEm: string }> {
  const patientId = pacienteDaSessao(ctx, 'pedirExclusao');
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx): Promise<{ registrado: true } | { jaPedidoEm: string }> => {
      const [p] = await tx
        .select({ email: patients.email })
        .from(patients)
        .where(eq(patients.id, patientId))
        .for('update');
      if (!p) throw new Error('paciente da sessão não encontrado');
      const [aberto] = await tx
        .select({ createdAt: privacyRequests.createdAt })
        .from(privacyRequests)
        .where(
          and(
            eq(privacyRequests.patientId, patientId),
            eq(privacyRequests.tipo, 'exclusao'),
            eq(privacyRequests.status, 'aberto'),
          ),
        );
      if (aberto) return { jaPedidoEm: formatarDataNoFuso(aberto.createdAt, tenant.fuso) };
      const prazo = somarDias(hojeNoFuso(tenant.fuso, agora), PRAZO_RESPOSTA_DIAS);
      await tx.insert(privacyRequests).values({
        tenantId: ctx.tenantId,
        patientId,
        tipo: 'exclusao',
        status: 'aberto',
        prazo,
        createdAt: agora,
      });
      await enqueueEmail(
        { tipo: 'pedido_exclusao_registrado', para: p.email, nutri: tenant.nomeExibicao, prazo: formatarData(prazo) },
        { tenantId: ctx.tenantId, tx },
      );
      return { registrado: true };
    },
    deps.db ?? getDb(),
  );
}
