import { eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { patientCadastro } from '@/db/schema';

/**
 * Plano 18 (RN-282, D19): de `patient_cadastro`, a IA lê SÓ o nome social, só para a máscara (`outrosNomes` do
 * `AlvoDaMascara`, `comNomeSocial`) e sempre por esta projeção (guarda de fonte em nome-social-fonte.test.ts). Nunca
 * sai ao provedor nem volta à tela (sem auditRead). Para quem já está numa transação da equipe ou do worker: o resumo e o
 * rascunho (o pedido no app e o portão no worker). A IA Nutri lê por `nomeSocialParaMascara` (nome-social-worker.ts).
 *
 * Fora da equipe e do worker, recusa com erro: na sessão de paciente sem login a política
 * `patient_cadastro_paciente_com_conta` dá 0 linhas, e devolver `null` em silêncio deixaria o nome social sem máscara.
 * O erro não leva dado nenhum (nem o id do paciente).
 */
export async function nomeSocialNaTransacao(tx: Tx, patientId: string): Promise<string | null> {
  const [s] = (await tx.execute<{ papel: string | null }>(sql`select app_current_role() as papel`)).rows;
  if (s?.papel !== 'nutri' && s?.papel !== 'worker') throw new Error('nome social para a máscara: só na transação da equipe ou do worker');
  const [c] = await tx.select({ nomeSocial: patientCadastro.nomeSocial }).from(patientCadastro).where(eq(patientCadastro.patientId, patientId));
  return c?.nomeSocial ?? null;
}
