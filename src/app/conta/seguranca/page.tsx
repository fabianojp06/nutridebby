import { requireUser } from '@/lib/session';
import { SECURITY_PATH } from '@/lib/session-rules';
import { Enable2fa } from './enable-2fa';

export const dynamic = 'force-dynamic';

export default async function SegurancaPage() {
  const { user } = await requireUser(['admin', 'nutri'], SECURITY_PATH);
  return (
    <main className="mx-auto max-w-lg p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Segurança da conta</h1>
      {user.twoFactorEnabled ? (
        <p>A verificação em duas etapas está ativa.</p>
      ) : (
        <>
          {user.appRole === 'admin' && (
            <p role="alert" className="rounded bg-amber-100 p-3 text-amber-900">
              Para usar a administração, ative a verificação em duas etapas.
            </p>
          )}
          <Enable2fa />
        </>
      )}
    </main>
  );
}
