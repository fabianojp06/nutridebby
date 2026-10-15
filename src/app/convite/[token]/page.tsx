import type { Metadata } from 'next';
import { getDb } from '@/db/client';
import { CONVITE_EXPIRADO, CONVITE_INVALIDO, inspecionarConvite } from '@/modules/plataforma/convites';
import { DPA_PARAGRAFOS, DPA_ROTULO, DPA_TITULO, DPA_VERSAO } from '@/modules/plataforma/dpa';
import { ConviteForm } from './form';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer para outro site
export const metadata: Metadata = { title: 'Primeiro acesso', referrer: 'no-referrer' };

export default async function ConvitePage({ params }: PageProps<'/convite/[token]'>) {
  const { token } = await params;
  const estado = await inspecionarConvite(getDb(), token);
  if (estado.estado !== 'valido') {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Primeiro acesso</h1>
        <p role="alert">{estado.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO}</p>
        <a href="/entrar" className="underline">Ir para o login</a>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Bem-vinda ao NutriDebby</h1>
      <p>{`Defina a senha de ${estado.email} e aceite o contrato para entrar.`}</p>
      <section aria-labelledby="dpa-titulo" className="space-y-2 rounded border p-3 text-sm">
        <h2 id="dpa-titulo" className="font-semibold">{DPA_TITULO}</h2>
        {DPA_PARAGRAFOS.map((p) => <p key={p}>{p}</p>)}
      </section>
      <ConviteForm token={token} rotuloDpa={DPA_ROTULO} versao={DPA_VERSAO} />
    </main>
  );
}
