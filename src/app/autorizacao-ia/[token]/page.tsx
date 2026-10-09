import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { TextoLegalView } from '@/components/texto-legal';
import { Aviso } from '@/components/ui/aviso';
import { getEnv } from '@/env';
import { clientIp, clientIpDoLimite } from '@/lib/ip';
import { estadoDoLinkIa } from '@/modules/ia/autorizacao-link';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { DecisaoForm } from './decisao-form';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer (o next.config também manda o cabeçalho em /autorizacao-ia/*)
export const metadata: Metadata = { title: 'Autorização para uso de inteligência artificial', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const TITULO = 'Autorização para uso de inteligência artificial';
const data = (d: Date) => formatarData(hojeNoFuso('America/Sao_Paulo', d));

/** US-107 / US-109: a página do link, sem login. O GET não grava nada; nenhum dado de saúde (só o consultório e o texto). */
export default async function AutorizacaoPeloLink({ params }: PageProps<'/autorizacao-ia/[token]'>) {
  const { token } = await params;
  const env = getEnv();
  const h = await headers();
  const estado = await estadoDoLinkIa(token, {
    ia: configIA(env), appUrl: env.APP_URL, ip: clientIp(h, env.TRUSTED_PROXIES), ipDoLimite: clientIpDoLimite(h, env.TRUSTED_PROXIES), userAgent: null,
    verificarTurnstile: async () => 'invalido' as const,
  });
  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-4 bg-fundo p-6 font-sans text-texto">
      {estado.tipo === 'decidir' ? (
        <>
          <p className="text-suave">{estado.consultorio}</p>
          {/* F4 (§18.5, parecer 4.1 "Acréscimos por canal"): abaixo do título — o link pode chegar a outra pessoa (e-mail compartilhado ou digitado errado) */}
          <TextoLegalView
            texto={estado.texto}
            id="autorizacao"
            nivel="h1"
            classeTitulo="font-titulo text-2xl font-semibold"
            aposTitulo={<p className="font-semibold">{MSG_AUTORIZACAO.autorizacaoPessoal}</p>}
          />
          <DecisaoForm token={token} siteKey={env.TURNSTILE_SITE_KEY} modo="decidir" />
        </>
      ) : (
        <>
          <h1 className="font-titulo text-2xl font-semibold">{TITULO}</h1>
          {estado.tipo === 'invalido' && <Aviso tipo="aviso">{MSG_AUTORIZACAO.linkInvalido}</Aviso>}
          {estado.tipo === 'expirado' && <Aviso tipo="aviso">{MSG_AUTORIZACAO.linkExpirado}</Aviso>}
          {estado.tipo === 'nao_vigente' && <Aviso tipo="aviso">{MSG_AUTORIZACAO.naoVigente}</Aviso>}
          {(estado.tipo === 'ja_autorizou' || estado.tipo === 'retirar') && (
            <section aria-labelledby="situacao" className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
              <h2 id="situacao" className="font-semibold">{estado.consultorio}</h2>
              <p>{MSG_AUTORIZACAO.jaAutorizou(data(estado.em))}</p>
              <DecisaoForm token={token} siteKey={env.TURNSTILE_SITE_KEY} modo="retirar" />
            </section>
          )}
        </>
      )}
    </main>
  );
}
