import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { homeFor, type AppRole } from '@/lib/session-rules';

export const dynamic = 'force-dynamic';

export default async function Inicio() {
  const { user } = await requireUser(['admin', 'nutri', 'paciente'], '/inicio');
  redirect(homeFor(user.appRole as AppRole));
}
