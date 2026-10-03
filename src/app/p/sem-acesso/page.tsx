import type { Metadata } from 'next';
import { SEM_ACESSO_PATH } from '@/lib/paciente-session';
import { requireUser } from '@/lib/session';
import { EsquecerPlanoGuardado } from '../esquecer-plano';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Meu acompanhamento' };

/** RN-08: nenhum vínculo ativo (arquivado, bloqueado ou anonimizado em todos os consultórios). */
export default async function SemAcesso() {
  await requireUser(['paciente'], SEM_ACESSO_PATH);
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <EsquecerPlanoGuardado />
      <h1 className="text-2xl font-semibold">Meu acompanhamento</h1>
      <p role="status">Seu acesso ao portal não está ativo. Fale com sua nutricionista.</p>
    </main>
  );
}
