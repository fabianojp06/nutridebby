import type { Metadata } from 'next';
import { getDb } from '@/db/client';
import { CONVITE_EXPIRADO, CONVITE_INVALIDO, inspecionarConvite } from '@/modules/plataforma/convites';
import { DPA_PARAGRAFOS, DPA_ROTULO, DPA_TITULO, DPA_VERSAO } from '@/modules/plataforma/dpa';
import { MSG_EQUIPE } from '@/modules/plataforma/equipe-textos';
import { SIGILO_EQUIPE_TEXTO, SIGILO_EQUIPE_VERSAO } from '@/modules/plataforma/textos-versionados';
import { TextoLegalView } from '@/components/texto-legal';
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
  if (estado.tipo === 'recepcao') {
    // Plano 26 (RN-500, US-489): o convite da recepção — o termo de confidencialidade da equipe inteiro na página (como o
    // DPA da nutricionista), a caixa obrigatória, e a cópia pública em /termos/sigilo-equipe
    return (
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{MSG_EQUIPE.convite.titulo}</h1>
        <p>{MSG_EQUIPE.convite.texto(estado.consultorio ?? '')}</p>
        <section className="rounded border p-3 text-sm">
          <TextoLegalView texto={SIGILO_EQUIPE_TEXTO} id="sigilo-titulo" classeTitulo="font-semibold" />
        </section>
        <ConviteForm token={token} rotulo={MSG_EQUIPE.convite.rotuloTermo} versao={SIGILO_EQUIPE_VERSAO} aceite="sigilo" />
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
      <ConviteForm token={token} rotulo={DPA_ROTULO} versao={DPA_VERSAO} />
    </main>
  );
}
