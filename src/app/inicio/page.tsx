import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { homeFor, type AppRole } from '@/lib/session-rules';

export const dynamic = 'force-dynamic';

/**
 * Destino do login, do 2FA e do "Continuar" da Segurança: leva cada papel à própria home. Plano 26 (RE-D67): a recepção vai
 * ao painel (sem ela na lista, cairia no aviso de outro papel e não entraria).
 */
export default async function Inicio() {
  const { user } = await requireUser(['admin', 'nutri', 'paciente', 'recepcao'], '/inicio');
  redirect(homeFor(user.appRole as AppRole));
}
