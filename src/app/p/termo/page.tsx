import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePaciente, TERMO_PATH, voltaDoTermo } from '@/lib/paciente-session';
import { TERMO_PACIENTE_MUDOU, TERMO_PACIENTE_TITULO } from '@/modules/pacientes/termo-paciente';
import { TERMO_PACIENTE_PARAGRAFOS } from '@/modules/pacientes/termo-paciente-textos';
import { situacaoDoTermo } from '@/modules/portal/termo';
import { CabecalhoSair } from '@/components/portal/cabecalho-sair';
import { TermoForm } from './termo-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: TERMO_PACIENTE_TITULO };

/** US-011 "Nova versão do termo": o termo mudou (ou é o primeiro acesso a este consultório) → novo aceite. */
export default async function NovoTermo({ searchParams }: PageProps<'/p/termo'>) {
  const { data, tenant } = await requirePaciente(TERMO_PATH, { permitirTermoPendente: true });
  const { volta: pedida } = await searchParams;
  // S-1: o destino que levou ao termo (link da exportação, push) — só página do portal, sem o `?v=`
  const volta = voltaDoTermo(typeof pedida === 'string' ? pedida : null);
  // P08-06: quem já aceitou uma versão anterior volta ao termo sem aviso de por quê; o aviso diz que o termo mudou
  const { aceito, anterior: mudou } = await situacaoDoTermo(data.user.id, tenant.id);
  if (aceito) redirect(volta);
  return (
    <>
      <CabecalhoSair />
      <main className="mx-auto max-w-md space-y-4 p-6">
        <h1 className="font-portal-titulo text-2xl font-semibold">{TERMO_PACIENTE_TITULO}</h1>
        <p className="text-sm text-suave">{`Acompanhamento com ${tenant.nomeExibicao}`}</p>
        {mudou && (
          <p role="status" className="rounded-2xl border border-borda bg-cartao p-3 font-medium">
            {TERMO_PACIENTE_MUDOU}
          </p>
        )}
        {TERMO_PACIENTE_PARAGRAFOS.map((t) => (
          <p key={t}>{t}</p>
        ))}
        <TermoForm volta={volta} />
      </main>
    </>
  );
}
