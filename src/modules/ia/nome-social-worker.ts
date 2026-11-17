import type { Db } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { nomeSocialNaTransacao } from './nome-social';

/**
 * Plano 18 (RN-282, D19): o nome social para a máscara da IA Nutri. O contexto da conversa é montado na sessão de
 * paciente sem login, que não lê `patient_cadastro` (política `patient_cadastro_paciente_com_conta`): o nome social é
 * lido aqui, num contexto `worker` próprio, ANTES e fora daquela transação. Abre o contexto worker sozinho (sem sessão,
 * sem ator, sem auditRead: só serve para a máscara e nunca sai) — por isso nenhum arquivo alcançável das raízes do Next
 * importa este (guardas.test.ts); só o contexto da IA Nutri (nome-social-fonte.test.ts). Falha na leitura → erro para o
 * job, que não segue sem a máscara.
 */
export async function nomeSocialParaMascara(db: Db, tenantId: string, patientId: string): Promise<string | null> {
  return withTenant({ tenantId, role: 'worker' }, (tx) => nomeSocialNaTransacao(tx, patientId), db);
}
