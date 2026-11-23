import { notFound } from 'next/navigation';
import { requireNutri, type NutriAccess } from '@/lib/tenant-session';

/**
 * D20 (Plano 10A) + Plano 22 (RN-398, R22-11): a entrada das telas e das Server Actions que só existem com os documentos
 * liberados no consultório — a sessão da nutricionista (`requireNutri`, que redireciona o papel errado) e, sem
 * `documentos_liberados`, `notFound()` (como a aba Documentos e `/p/documentos`). Era o `acesso()` de
 * `src/app/painel/pacientes/[id]/documentos/actions.ts`, sem mudar o comportamento. Toda página **e** toda action de
 * `src/app/painel/prescricao/**` chama esta função: o `notFound()` de um layout não protege as Server Actions.
 */
export async function acessoComDocumentos(path: string): Promise<NutriAccess> {
  const a = await requireNutri(path);
  if (!a.tenant.documentosLiberados) notFound();
  return a;
}
