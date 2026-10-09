import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { iaTarefas, tenants } from '@/db/schema';
import { estornar } from './cota';

/**
 * US-101 (desativar), US-103 ("Não usar IA"), US-018 (exclusão atendida) e exclusão do exame (D20, com `examId`): tarefas
 * na fila e sugestões prontas ficam "cancelada", com o conteúdo esvaziado e a reserva da fila estornada. A linha fica
 * (§5.11). As que estão "processando" ficam para o worker, que confere de novo no portão do envio (com travas) e antes de
 * gravar. Chamar dentro de withTenant do mesmo `tenantId`, depois de travar o paciente (quando houver): esta função trava
 * o tenant (FOR NO KEY UPDATE) e segue a ordem da cota (cota.ts): paciente → tenant → tarefas → ia_uso → plataforma.
 * As tarefas são travadas de uma vez, por id, antes de qualquer estorno — a mesma ordem da varredura
 * (expirarTarefasDoTenant), para as duas não se cruzarem entre uma tarefa e a linha do mês da plataforma.
 * Plano 14A (D14): o job `ia-retirada` com o paciente reautorizado cancela só as tarefas criadas antes da retirada
 * (`criadasAntesDe`).
 */
export async function cancelarTarefas(tx: Tx, o: { tenantId: string; patientId?: string; examId?: string; agora: Date; por?: string | null; criadasAntesDe?: Date }): Promise<number> {
  // a trava do tenant fica aqui (code review do PR #23): quem chama não pode esquecê-la antes do contador da plataforma
  await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, o.tenantId)).for('no key update');
  const alvo = await tx
    .select({ id: iaTarefas.id, status: iaTarefas.status })
    .from(iaTarefas)
    .where(
      and(
        inArray(iaTarefas.status, ['na_fila', 'pronta']),
        o.patientId ? eq(iaTarefas.patientId, o.patientId) : undefined,
        o.examId ? eq(iaTarefas.examId, o.examId) : undefined,
        o.criadasAntesDe ? lt(iaTarefas.criadoEm, o.criadasAntesDe) : undefined,
      ),
    )
    .orderBy(asc(iaTarefas.id))
    .for('update');
  for (const t of alvo) {
    await tx
      .update(iaTarefas)
      .set({ status: 'cancelada', parametros: null, resultado: null, encerradoEm: o.agora, encerradoPor: o.por ?? null, updatedAt: o.agora })
      .where(eq(iaTarefas.id, t.id));
    if (t.status === 'na_fila') await estornar(tx, t.id, o.agora);
  }
  return alvo.length;
}
