import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { SUSPENDED_PATH } from '@/lib/session-rules';
import { normalizeEmail } from '@/lib/text';
import { inspecionarConvitePaciente, MSG_CONVITE_PACIENTE } from '@/modules/pacientes/convite-paciente';
import { TERMO_PACIENTE_TITULO } from '@/modules/pacientes/termo-paciente';
import { TERMO_PACIENTE_PARAGRAFOS } from '@/modules/pacientes/termo-paciente-textos';
import { aceitarConvitePacienteAction, vincularContaAction } from './actions';
import { AceiteForm } from './form';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer (o next.config também manda o cabeçalho em /convite/*)
export const metadata: Metadata = { title: 'Convite', referrer: 'no-referrer' };

function Aviso({ texto }: { texto: string }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Convite</h1>
      <p role="alert">{texto}</p>
      <a href="/entrar" className="underline">Ir para o login</a>
    </main>
  );
}

function Termo() {
  return (
    <section aria-labelledby="termo-titulo" className="space-y-2 rounded border p-3 text-sm">
      <h2 id="termo-titulo" className="font-semibold">{TERMO_PACIENTE_TITULO}</h2>
      {TERMO_PACIENTE_PARAGRAFOS.map((p) => <p key={p}>{p}</p>)}
    </section>
  );
}

export default async function ConvitePacientePage({ params }: PageProps<'/convite/paciente/[token]'>) {
  const { token } = await params;
  const e = await inspecionarConvitePaciente(getDb(), token);
  if (e.estado === 'expirado') return <Aviso texto={MSG_CONVITE_PACIENTE.expirado} />;
  if (e.estado === 'invalido') return <Aviso texto={MSG_CONVITE_PACIENTE.invalido} />;
  if (e.tenantSuspenso) redirect(SUSPENDED_PATH);
  if (e.conta === 'equipe') return <Aviso texto={MSG_CONVITE_PACIENTE.contaDeEquipe} />;

  if (e.conta === 'paciente') {
    const sessao = await getAuth().api.getSession({ headers: await headers() });
    if (!sessao) {
      const volta = encodeURIComponent(`/convite/paciente/${token}`);
      return (
        <main className="mx-auto max-w-lg space-y-4 p-6">
          <h1 className="text-2xl font-semibold">{`Convite de ${e.nutri}`}</h1>
          <p>{`Entre com sua conta existente para ver os dados da nutricionista ${e.nutri}.`}</p>
          <a href={`/entrar?volta=${volta}`} className="inline-block rounded bg-emerald-700 px-4 py-2 text-white">Entrar</a>
        </main>
      );
    }
    if (normalizeEmail(sessao.user.email) !== normalizeEmail(e.email)) return <Aviso texto={MSG_CONVITE_PACIENTE.outraConta} />;
    return (
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{`Convite de ${e.nutri}`}</h1>
        <p>Leia o termo e confirme para ver seu acompanhamento com esta nutricionista.</p>
        <Termo />
        <AceiteForm acao={vincularContaAction.bind(null, token)} pedeSenha={false} temTelefone={e.temTelefone} whatsappMarcado={e.whatsappMarcado} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Bem-vindo(a) ao NutriDebby</h1>
      <p>{`${e.nutri} convidou você. Crie a senha de ${e.email} e leia o termo para continuar.`}</p>
      <Termo />
      <AceiteForm acao={aceitarConvitePacienteAction.bind(null, token)} pedeSenha temTelefone={e.temTelefone} whatsappMarcado={e.whatsappMarcado} />
    </main>
  );
}
