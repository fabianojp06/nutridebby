import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { iaAutorizacoes, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { autorizacaoDoPaciente } from './autorizacao';
import { cancelarTarefas } from './cancelar';
import type { DestinoIA } from './constantes';

export type DadosRetiradaIa = { tenantId: string; patientId: string; retiradaId: string };

/**
 * RN-108 (Plano 14A, D14): a retirada pelo paciente (app ou link). A sessão de paciente não alcança ia_tarefas nem ia_uso
 * (staff_only): a transação da retirada enfileira este job, que roda no contexto worker na ordem paciente → tenant
 * (cancelarTarefas trava o tenant): trava o paciente, confere de novo a situação e cancela a fila (estorno) e as sugestões
 * prontas (esvaziadas). Se o paciente autorizou de novo depois da retirada, só as tarefas criadas ANTES dela. Até o job
 * rodar, nada sai (portão do envio) e nada é aplicado (aplicarSugestao); a varredura expirar-ia é a rede de segurança.
 */
export async function processarRetiradaIa(d: DadosRetiradaIa, deps: { db: Db; destino: DestinoIA | null; agora?: () => Date }): Promise<number> {
  const agora = (deps.agora ?? (() => new Date()))();
  const n = await withTenant(
    { tenantId: d.tenantId, role: 'worker' },
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, d.patientId)).for('update');
      if (!p) return 0;
      const [r] = await tx
        .select({ em: iaAutorizacoes.registradoEm })
        .from(iaAutorizacoes)
        .where(and(eq(iaAutorizacoes.id, d.retiradaId), eq(iaAutorizacoes.patientId, p.id), eq(iaAutorizacoes.evento, 'retirou')));
      if (!r) return 0;
      const s = await autorizacaoDoPaciente(tx, p.id, deps.destino);
      return cancelarTarefas(tx, { tenantId: d.tenantId, patientId: p.id, agora, por: null, criadasAntesDe: s.tipo === 'vigente' ? r.em : undefined });
    },
    deps.db,
  );
  logger.info({ tenantId: d.tenantId, canceladas: n }, 'retirada da autorização de IA: fila e sugestões canceladas');
  return n;
}
