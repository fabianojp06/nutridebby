import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { Selo } from '@/components/ui/selo';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { abrirDuvida } from '@/modules/ia/nutri-paciente/duvidas';
import { TEXTOS_FIXOS } from '@/modules/ia/nutri-paciente/textos';
import { formatarDataHora } from '@/modules/pacientes/datas';
import { marcarVistaAction } from '../actions';
import { horasDesde, ROTULO_DO_SELO } from '../apresentacao';

export const dynamic = 'force-dynamic';

/**
 * US-175: a dúvida aberta — a pergunta, a resposta que o paciente viu (o texto montado ou o texto fixo) e o selo. Abrir é
 * auditado ("Visualizou — IA Nutri (conversa com o paciente)") e grava `aberta_pela_nutri_em` (abrirDuvida). Com sinal de
 * risco (também o aviso mínimo), o protocolo (D11, DP-18) logo abaixo da pergunta. D22: a de quem desativou a IA Nutri é
 * mostrada uma vez e já foi apagada — sem "Marcar como vista", com o aviso para anotar. Nenhum campo de texto livre (D24 = b).
 */
export default async function Duvida({ params }: PageProps<'/painel/duvidas/[id]'>) {
  const { ctx, tenant } = await requireNutri('/painel/duvidas');
  const { id } = await params;
  const d = await abrirDuvida(ctx, id);
  if (!d) notFound();
  const resposta = d.resposta ? (d.resposta.texto ?? (d.resposta.textoFixo ? TEXTOS_FIXOS[d.resposta.textoFixo] : null)) : null;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <p>
        <Link href="/painel/duvidas" className="inline-flex min-h-11 items-center text-link underline">{`Voltar para ${MSG_IA_NUTRI.fila}`}</Link>
      </p>
      <h1 className="font-titulo text-2xl font-semibold">{d.paciente}</h1>
      <p className="flex flex-wrap items-center gap-2 text-suave">
        <span>{`Recebida ${MSG_IA_NUTRI.haHoras(horasDesde(d.criadaEm))} · ${formatarDataHora(d.criadaEm, tenant.fuso)}`}</span>
        {d.selo && <Selo>{ROTULO_DO_SELO[d.selo]}</Selo>}
      </p>
      {d.selo === 'risco_revogado' && <Aviso tipo="aviso" papel="nenhum">{MSG_IA_NUTRI.riscoApagadoAoAbrir}</Aviso>}
      <section aria-labelledby="pergunta" className="space-y-2 rounded-3xl border border-borda bg-cartao p-5">
        <h2 id="pergunta" className="text-lg font-semibold">Pergunta do paciente</h2>
        <p className="wrap-break-word whitespace-pre-line">{d.texto ?? MSG_IA_NUTRI.apagada}</p>
        {d.selo && (
          <div className="space-y-1 rounded-2xl border border-borda p-3">
            {MSG_IA_NUTRI.protocoloRisco.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        )}
      </section>
      {resposta && (
        <section aria-labelledby="resposta" className="space-y-2 rounded-3xl border border-borda bg-cartao p-5">
          <h2 id="resposta" className="text-lg font-semibold">O que o paciente viu</h2>
          <p className="wrap-break-word whitespace-pre-line">{resposta}</p>
          {d.resposta?.categoria && <Selo>{d.resposta.categoria}</Selo>}
        </section>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {d.selo !== 'risco_revogado' && !d.resolvida && (
          <form action={marcarVistaAction.bind(null, d.id)}>
            <Botao>{MSG_IA_NUTRI.marcarVista}</Botao>
          </form>
        )}
        {d.selo !== 'risco_revogado' && (
          <Link href={`/painel/pacientes/${d.patientId}/ia-nutri`} className="inline-flex min-h-11 items-center text-link underline">Ver a conversa na ficha</Link>
        )}
      </div>
    </main>
  );
}
