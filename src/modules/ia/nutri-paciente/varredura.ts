import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { iaNutriMensagens, iaUso, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { estornar, marcarIncerto } from '../cota';
import { PERGUNTA_PRESA_MS } from './constantes';
import { PROMPT_VERSAO_CONVERSA } from './instrucoes';
import { registrarSaida } from './saida';

/**
 * RN-180 / DP-10: num tenant — pergunta na_fila/processando há mais de 3 min → falhou (interrompida) com o texto fixo de
 * falha; a reserva estornada (não saiu) ou incerta (saiu, com a saída registrada — saida.ts). E a conciliação: pergunta já falhou ou cancelada (a função, a
 * revogação, o job) com ia_uso ainda `reservado` → estorno/incerto.
 * ORDEM DE TRAVAS (DP-10): a mensagem `ia` é filha de `patients` (o INSERT pede KEY SHARE no paciente), e perguntar,
 * revogar e o passo 1 do job travam o paciente ANTES das mensagens. Por isso a varredura lista as presas SEM trava e, para
 * cada uma, trava o paciente (`FOR NO KEY UPDATE SKIP LOCKED`: ocupado → fica para a próxima volta) e só então a mensagem
 * (`FOR UPDATE SKIP LOCKED`), conferindo de novo a situação e a idade. Nunca espera: sem ciclo com quem trava paciente →
 * mensagem. A conciliação dos `pendentes` não grava filha de `patients` — só `ia_uso` e a plataforma —, por isso trava só a
 * mensagem, com `SKIP LOCKED`. Só ids e contagens no log.
 */
export async function expirarPerguntasDoTenant(db: Db, tenantId: string, agora: Date): Promise<number> {
  const limite = new Date(agora.getTime() - PERGUNTA_PRESA_MS);
  return withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const candidatas = await tx
        .select({ id: iaNutriMensagens.id, patientId: iaNutriMensagens.patientId })
        .from(iaNutriMensagens)
        .where(and(inArray(iaNutriMensagens.status, ['na_fila', 'processando']), lt(iaNutriMensagens.createdAt, limite)));
      let presas = 0;
      for (const cand of candidatas) {
        const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, cand.patientId)).for('no key update', { skipLocked: true });
        if (!p) continue; // paciente ocupado (perguntar, revogar, job): próxima volta
        const [m] = await tx
          .select()
          .from(iaNutriMensagens)
          .where(and(eq(iaNutriMensagens.id, cand.id), inArray(iaNutriMensagens.status, ['na_fila', 'processando']), lt(iaNutriMensagens.createdAt, limite)))
          .for('update', { skipLocked: true });
        if (!m) continue;
        await tx.update(iaNutriMensagens).set({ status: 'falhou', motivoTecnico: 'interrompida', updatedAt: agora }).where(eq(iaNutriMensagens.id, m.id));
        // a sessão e a guarda copiadas no banco (o Date do JS só tem milissegundos; a pergunta seguinte herda a sessão)
        await tx.insert(iaNutriMensagens).values({
          tenantId, patientId: m.patientId, autor: 'ia', textoFixo: 'falha', motivoTecnico: 'interrompida', respondeA: m.id,
          modelo: m.modelo, promptVersao: m.promptVersao ?? PROMPT_VERSAO_CONVERSA,
          sessaoInicio: sql<Date>`(select q.sessao_inicio from ia_nutri_mensagens q where q.id = ${m.id})`,
          expiraEm: sql<Date>`(select q.expira_em from ia_nutri_mensagens q where q.id = ${m.id})`,
        });
        if (m.enviadoEm) {
          await registrarSaida(tx, { mensagemId: m.id, patientId: m.patientId, agora }); // passou do portão: pode ter saído
          await marcarIncerto(tx, m.id, agora);
        } else await estornar(tx, m.id, agora);
        presas += 1;
      }
      const pendentes = await tx
        .select({ id: iaNutriMensagens.id, patientId: iaNutriMensagens.patientId, enviadoEm: iaNutriMensagens.enviadoEm })
        .from(iaNutriMensagens)
        .innerJoin(iaUso, and(eq(iaUso.tarefaId, iaNutriMensagens.id), eq(iaUso.situacao, 'reservado')))
        .where(inArray(iaNutriMensagens.status, ['falhou', 'cancelada']))
        .for('update', { of: iaNutriMensagens, skipLocked: true });
      for (const m of pendentes) {
        if (m.enviadoEm) {
          // encerrada por fora (app_ia_nutri_perguntar, revogação) depois do portão: a saída registrada (só a mensagem e o
          // audit_log, que não é filho de `patients`: nada de trava no paciente aqui, DP-10)
          await registrarSaida(tx, { mensagemId: m.id, patientId: m.patientId, agora });
          await marcarIncerto(tx, m.id, agora);
        } else await estornar(tx, m.id, agora);
      }
      return presas + pendentes.length;
    },
    db,
  );
}

/**
 * `expirar-ia-paciente`, de minuto em minuto: todos os tenants (uma pergunta pode ter ficado na fila depois de a
 * nutricionista desativar a IA Nutri; poucos consultórios), uma transação por tenant. Um tenant com erro não para os
 * outros (molde de expirarTarefasIA).
 */
export async function expirarPerguntasIaNutri(db: Db, agora: Date): Promise<number> {
  const ids = (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
  let n = 0;
  for (const tenantId of ids) {
    try {
      n += await expirarPerguntasDoTenant(db, tenantId, agora);
    } catch (err) {
      logger.error({ tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha na varredura da IA Nutri');
    }
  }
  if (n) logger.info({ conciliadas: n }, 'varredura da IA Nutri');
  return n;
}
