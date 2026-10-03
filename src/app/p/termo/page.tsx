import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePaciente, TERMO_PATH } from '@/lib/paciente-session';
import { TERMO_PACIENTE_PARAGRAFOS, TERMO_PACIENTE_TITULO } from '@/modules/pacientes/termo-paciente';
import { termoAceito } from '@/modules/portal/termo';
import { TermoForm } from './termo-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: TERMO_PACIENTE_TITULO };

/** US-011 "Nova versão do termo": o termo mudou (ou é o primeiro acesso a este consultório) → novo aceite. */
export default async function NovoTermo() {
  const { data, tenant } = await requirePaciente(TERMO_PATH, { permitirTermoPendente: true });
  if (await termoAceito(data.user.id, tenant.id)) redirect('/p/inicio');
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{TERMO_PACIENTE_TITULO}</h1>
      <p className="text-sm text-gray-700">{`Acompanhamento com ${tenant.nomeExibicao}`}</p>
      {TERMO_PACIENTE_PARAGRAFOS.map((t) => (
        <p key={t}>{t}</p>
      ))}
      <TermoForm />
    </main>
  );
}
