import type { Metadata } from 'next';
import { formatoDoLinkDeSaida } from '@/modules/agenda/aniversario-link';
import { estadoDoLinkDeSaida } from '@/modules/agenda/aniversarios';
import { MSG_ANIVERSARIO, MSG_PUBLICO } from '@/modules/agenda/constantes';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca como Referer (o next.config também manda no-referrer e no-store, AG-D71)
export const metadata: Metadata = { title: MSG_ANIVERSARIO.saida.titulo, referrer: 'no-referrer', robots: { index: false, follow: false } };

/**
 * Plano 23 (RN-434, US-414 "Pelo link do e-mail"): o link "Não quero mais receber mensagens de aniversário" do e-mail, sem
 * login. O GET só mostra — leitores de link e pré-visualizações abrem a URL, e nada é gravado; "Confirmar" é um formulário
 * POST (funciona sem JavaScript) para a rota de um clique, que grava e volta aqui com `?ok=1`. "Pronto." só aparece quando
 * a retirada de fato está gravada (a URL com `?ok=1` digitada mostra a pergunta de novo).
 */
export default async function SaidaDoAniversario({ params, searchParams }: PageProps<'/aniversario/sair/[token]'>) {
  const { token } = await params;
  const sp = await searchParams;
  const e = await estadoDoLinkDeSaida(token);
  const M = MSG_ANIVERSARIO.saida;
  const pronto = e.estado === 'ok' && sp.ok === '1' && !e.vigente;
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-4 bg-fundo p-6 font-sans text-texto">
      <h1 className="font-titulo text-2xl font-semibold">{M.titulo}</h1>
      {sp.erro === 'limite' && <p role="alert">{MSG_PUBLICO.muitasTentativas}</p>}
      {e.estado === 'invalido' && <p role="alert">{M.invalido}</p>}
      {pronto && <p role="status">{M.pronto}</p>}
      {e.estado === 'ok' && !pronto && formatoDoLinkDeSaida(token) && (
        // o token só chega aqui com o formato e a assinatura conferidos: seguro na URL da ação
        <form method="post" action={`/api/aniversario/sair/${encodeURIComponent(token)}`} className="space-y-3">
          <input type="hidden" name="origem" value="pagina" />
          <p>{M.pergunta(e.nutri)}</p>
          <button type="submit" className="min-h-11 rounded-xl bg-botao px-4 py-2 font-semibold text-botao-texto">
            {M.confirmar}
          </button>
        </form>
      )}
    </main>
  );
}
