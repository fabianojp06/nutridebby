import type { Metadata } from 'next';
import { desistirDoPedidoPublico } from '@/modules/agenda/agendamento-publico';
import { MSG_PUBLICO } from '@/modules/agenda/constantes';

export const dynamic = 'force-dynamic';
// O token do pedido está na URL: nunca como Referer (o next.config também manda no-referrer e no-store, AG-D71)
export const metadata: Metadata = { title: MSG_PUBLICO.pedido.titulo, referrer: 'no-referrer', robots: { index: false, follow: false } };

/**
 * Plano 23 (AG-D42, AG-D48, AG-D49): o link "Desistir do pedido" do e-mail "Recebemos seu pedido de consulta" (pessoa
 * nova, sem login). O GET só mostra — leitores de link e pré-visualizações abrem a URL, e nada é gravado; o botão é um
 * formulário POST (funciona sem JavaScript) para a rota, que grava e volta aqui (`?ok=1`).
 */
export default async function PedidoDaPessoaNova({ params, searchParams }: PageProps<'/n/[slug]/pedido/[token]'>) {
  const { slug, token } = await params;
  const sp = await searchParams;
  const e = await desistirDoPedidoPublico(slug, token, { confirmar: false, ip: null });
  const M = MSG_PUBLICO.pedido;
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{M.titulo}</h1>
      {sp.erro === 'limite' && <p role="alert">{MSG_PUBLICO.muitasTentativas}</p>}
      {e.estado === 'aguardando' && (
        // o slug e o token só chegam aqui se a função achou o pedido (formato conferido): seguros na URL da ação
        <form method="post" action={`/api/n/${encodeURIComponent(slug)}/pedido/${encodeURIComponent(token)}`} className="space-y-3">
          <p>{M.pergunta(e.quando)}</p>
          <button type="submit" className="min-h-11 rounded bg-emerald-700 px-4 py-2 text-white">
            {M.desistir}
          </button>
        </form>
      )}
      {e.estado === 'cancelado' && <p role="status">{M.cancelado}</p>}
      {e.estado === 'invalido' && <p role="alert">{M.invalido}</p>}
    </main>
  );
}
