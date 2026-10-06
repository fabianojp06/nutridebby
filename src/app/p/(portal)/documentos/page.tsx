import { notFound } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { linhaDaAssinatura } from '@/modules/documentos/constantes';
import { documentosDoPaciente, MSG_PORTAL_DOC } from '@/modules/documentos/portal';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { confirmarRecebimentoAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * US-146 / D5 ★: "Documentos" — chega pelo cartão do Início e pelo link em Perfil; marca a aba "Perfil" (`tambem`). Fora
 * da cópia offline (o service worker só guarda /p/plano). D20: com o interruptor do admin desligado, 404.
 */
export default async function MeusDocumentos() {
  const { ctx, tenant } = await requirePaciente('/p/documentos');
  if (!tenant.documentosLiberados) notFound();
  const lista = await documentosDoPaciente(ctx);
  const data = (d: Date) => formatarDataNoFuso(d, tenant.fuso);
  return (
    <main className="space-y-6 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Documentos</h1>
      {lista.length === 0 && <p>{MSG_PORTAL_DOC.vazio}</p>}
      <ul className="space-y-4">
        {lista.map((d) => (
          <li key={d.id} className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
            <h2 className="font-semibold">{`${d.titulo} · ${data(d.data)}`}</h2>
            <p className="text-sm text-suave">{linhaDaAssinatura(d.assinaturaTipo)}</p>
            {d.status === 'substituido' && <p>{MSG_PORTAL_DOC.substituido}</p>}
            {d.status === 'cancelado' && (
              <p role="note" className="font-semibold">
                {MSG_PORTAL_DOC.cancelado}
              </p>
            )}
            {/* texto da spec ("Abrir PDF"); o complemento só para leitor de tela distingue os links da lista */}
            <a href={`/api/p/documentos/${d.id}/pdf`} className="inline-flex min-h-11 items-center underline">
              Abrir PDF<span className="sr-only">{` da ${d.titulo.toLowerCase()} de ${data(d.data)}`}</span>
            </a>
            {d.status === 'assinado' &&
              (d.recebidoEm ? (
                <p role="status">{`Recebimento confirmado em ${data(d.recebidoEm)}.`}</p>
              ) : (
                <form action={confirmarRecebimentoAction.bind(null, d.id)}>
                  <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-current px-5 font-semibold">
                    {MSG_PORTAL_DOC.confirmar}
                  </button>
                </form>
              ))}
          </li>
        ))}
      </ul>
    </main>
  );
}
