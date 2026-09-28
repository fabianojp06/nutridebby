import { getEnv } from '@/env';
import { EsqueciSenhaForm } from './form';

export const dynamic = 'force-dynamic';

export default function EsqueciSenhaPage() {
  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Recuperar senha</h1>
      <EsqueciSenhaForm siteKey={getEnv().TURNSTILE_SITE_KEY} />
    </main>
  );
}
