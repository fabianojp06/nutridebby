import Link from 'next/link';
import { getEnv } from '@/env';
import { requireUser } from '@/lib/session';
import { urlDoApp } from '@/lib/url-do-app';
import { NovaContaForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NovaContaPage() {
  await requireUser(['admin'], '/admin/contas/nova');
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <Link href="/admin" className="text-sm underline">Voltar</Link>
      <h1 className="text-2xl font-semibold">Nova conta de nutricionista</h1>
      <p className="text-sm">A nutricionista recebe por e-mail um convite válido por 72 horas para definir a senha e aceitar o contrato de tratamento de dados.</p>
      <NovaContaForm linkPublicoBase={urlDoApp(getEnv().APP_URL, '/n/')} />
    </main>
  );
}
