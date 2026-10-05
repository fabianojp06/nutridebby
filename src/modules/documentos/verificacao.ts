import { eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { documentVerifications } from '@/db/schema';
import type { SituacaoVerificacao, TipoAssinatura } from './constantes';

/**
 * RN-156: ÚNICO arquivo que toca `document_verifications` (fora da RLS; guarda em verificacao.test.ts). Sem dado do
 * paciente nem de saúde. A linha nasce na assinatura e só a situação muda depois (privilégio por coluna, 0090).
 */
export type NovaVerificacao = {
  codigo: string; tenantId: string; documentoId: string; tipo: 'receita'; assinadoEm: Date; emissorNome: string; emissorCrn: string;
  assinanteNome: string | null; assinaturaTipo: TipoAssinatura; pdfSha256: string;
};

export async function registrarVerificacao(tx: Tx, v: NovaVerificacao): Promise<void> {
  await tx.insert(documentVerifications).values({ ...v, situacao: 'valido', situacaoEm: v.assinadoEm });
}

export async function mudarSituacao(tx: Tx, documentoId: string, situacao: SituacaoVerificacao, em: Date): Promise<void> {
  await tx.update(documentVerifications).set({ situacao, situacaoEm: em }).where(eq(documentVerifications.documentoId, documentoId));
}
