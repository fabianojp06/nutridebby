import { and, count, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { iaNutriMensagens, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { avisarRiscoNaoAberto } from '../alertas';
import { RETENCAO_DIAS } from './constantes';

const RISCO_ALERTA_ADMIN_MS = 72 * 3_600_000;

export type ResultadoRetencao = { apagadas: number; esvaziadas: number; riscosNaoAbertos: number };

/**
 * RN-181 (D8 = 180 dias), D22 e D32, num tenant, no contexto worker: (1) a pergunta com risco de quem revogou, não aberta,
 * depois do teto de 30 dias → só o aviso mínimo (texto nulo, risco fica) até o prazo da D8; (2) as vencidas sem dúvida
 * aberta → apagadas (e o aviso mínimo vencido, mesmo "aberto": D22 "e depois nada"); com dúvida aberta → texto nulo, a
 * linha fica até ser resolvida; (3) a contagem do risco não aberto há mais de 72 h (só o número, para o e-mail aos admins).
 * "Vencida" = `expira_em` antes de `agora` E do relógio do banco: o gatilho ia_nutri_mensagens_sem_apagar confere
 * `expira_em <= now()`, e um relógio do worker adiantado não pode derrubar a volta do tenant (42501).
 * ORDEM DE TRAVAS (DP-10): as linhas que mudam são filhas de `patients`, e perguntar, revogar, o job e a exclusão travam o
 * paciente ANTES das mensagens. A volta lista os pacientes com vencidas sem trava, trava-os com `FOR NO KEY UPDATE SKIP
 * LOCKED` (ocupado → fica para o dia seguinte) e só então muda as mensagens deles. Só contagens no log.
 */
export async function expurgarIaNutriDoTenant(db: Db, tenantId: string, agora: Date): Promise<ResultadoRetencao> {
  return withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const vencida = sql`${iaNutriMensagens.expiraEm} < least(${agora}::timestamptz, now())`;
      const comVencidas = (await tx.selectDistinct({ id: iaNutriMensagens.patientId }).from(iaNutriMensagens).where(vencida)).map((p) => p.id);
      const livres = comVencidas.length
        ? (await tx.select({ id: patients.id }).from(patients).where(inArray(patients.id, comVencidas)).for('no key update', { skipLocked: true })).map((p) => p.id)
        : [];
      let apagadas = 0;
      let esvaziadas = 0;
      if (livres.length) {
        const dos = inArray(iaNutriMensagens.patientId, livres);
        // D22: o teto de 30 dias passou sem a nutricionista abrir → aviso mínimo até criação + 180 dias (a guarda da D8)
        const minimo = await tx
          .update(iaNutriMensagens)
          .set({ texto: null, expiraEm: sql`${iaNutriMensagens.createdAt} + ${RETENCAO_DIAS} * interval '1 day'`, updatedAt: agora })
          .where(and(dos, vencida, isNotNull(iaNutriMensagens.revogadaEm), isNotNull(iaNutriMensagens.risco), isNotNull(iaNutriMensagens.texto), isNull(iaNutriMensagens.abertaPelaNutriEm)))
          .returning({ id: iaNutriMensagens.id });
        const aberta = sql`(${iaNutriMensagens.encaminhadaEm} is not null and ${iaNutriMensagens.resolvidaEm} is null)`;
        // D22 "e depois nada": o aviso mínimo vencido (revogada, risco, sem texto) sai mesmo "aberto" — não pede ação
        const avisoMinimo = sql`(${iaNutriMensagens.revogadaEm} is not null and ${iaNutriMensagens.risco} is not null and ${iaNutriMensagens.texto} is null)`;
        const fora = await tx
          .delete(iaNutriMensagens)
          .where(and(dos, vencida, sql`(not ${aberta} or ${avisoMinimo})`))
          .returning({ id: iaNutriMensagens.id });
        const vazias = await tx
          .update(iaNutriMensagens)
          .set({ texto: null, updatedAt: agora })
          .where(and(dos, vencida, aberta, isNotNull(iaNutriMensagens.texto)))
          .returning({ id: iaNutriMensagens.id });
        apagadas = fora.length;
        esvaziadas = vazias.length + minimo.length;
      }
      const [{ n }] = await tx
        .select({ n: count() })
        .from(iaNutriMensagens)
        .where(
          and(
            isNotNull(iaNutriMensagens.risco),
            isNotNull(iaNutriMensagens.encaminhadaEm),
            isNull(iaNutriMensagens.abertaPelaNutriEm),
            isNull(iaNutriMensagens.resolvidaEm),
            lt(iaNutriMensagens.createdAt, new Date(agora.getTime() - RISCO_ALERTA_ADMIN_MS)),
          ),
        );
      return { apagadas, esvaziadas, riscosNaoAbertos: n };
    },
    db,
  );
}

/**
 * `ia-nutri-retencao`, todo dia às 04:15 (DP-10): todos os tenants, uma transação por tenant; um tenant com erro não para
 * os outros (só o código no log), e a volta termina com erro para o pg-boss tentar de novo (idempotente). Risco não aberto
 * há mais de 72 h em algum consultório → um e-mail sem dados aos admins, no máximo um por dia (D22, RN-182).
 */
export async function expurgarIaNutri(db: Db, agora: Date, appUrl: string): Promise<ResultadoRetencao> {
  const total: ResultadoRetencao = { apagadas: 0, esvaziadas: 0, riscosNaoAbertos: 0 };
  let falhas = 0;
  for (const { id: tenantId } of await listarTenantsParaVarredura(db)) {
    try {
      const r = await expurgarIaNutriDoTenant(db, tenantId, agora);
      total.apagadas += r.apagadas;
      total.esvaziadas += r.esvaziadas;
      total.riscosNaoAbertos += r.riscosNaoAbertos;
    } catch (err) {
      falhas += 1;
      logger.error({ tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha na retenção da IA Nutri');
    }
  }
  if (total.riscosNaoAbertos) {
    await avisarRiscoNaoAberto(db, agora, appUrl, total.riscosNaoAbertos).catch((err: unknown) =>
      logger.error({ err: err instanceof Error ? err.name : 'erro' }, 'falha no aviso de risco não aberto da IA Nutri'),
    );
  }
  logger.info({ ...total, falhas }, 'retenção da IA Nutri');
  if (falhas) throw new Error(`falha na retenção da IA Nutri em ${falhas} consultório(s)`);
  return total;
}
