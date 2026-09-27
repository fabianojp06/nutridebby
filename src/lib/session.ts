import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from './auth';
import { evaluateSession, homeFor, SECURITY_PATH, type AppRole } from './session-rules';

export async function requireUser(allowed: readonly AppRole[], path: string) {
  const h = await headers();
  const auth = getAuth();
  const data = await auth.api.getSession({ headers: h });
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now: new Date(),
    path,
  });
  switch (decision) {
    case 'ok':
      return data!;
    case 'login':
      redirect(`/entrar?volta=${encodeURIComponent(path)}`);
    case 'expired':
      await auth.api.signOut({ headers: h });
      redirect('/entrar?expirada=1');
    case 'setup-2fa':
      redirect(SECURITY_PATH);
    case 'forbidden':
      redirect(homeFor(data!.user.appRole as AppRole));
  }
}
