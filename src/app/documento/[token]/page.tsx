import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { CompartilharPdf } from '@/components/portal/compartilhar-pdf';
import { nomeDoPdf } from '@/components/portal/compartilhar-pdf-estado';
import { Aviso } from '@/components/ui/aviso';
import { getEnv } from '@/env';
import { clientIp, clientIpDoLimite } from '@/lib/ip';
import { rotuloDaVersao } from '@/modules/documentos/constantes';
import { estadoDoLink, MSG_LINK, NOME_COOKIE_LINK } from '@/modules/documentos/link-documento';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { CodigoForm } from './codigo-form';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer (o next.config também manda o cabeçalho em /documento/*)
export const metadata: Metadata = { title: 'Abrir documento', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** RN-158: a página do link. O GET não gasta nada; sem sessão, pede o código; com sessão, mostra o documento. */
export default async function DocumentoPeloLink({ params }: PageProps<'/documento/[token]'>) {
  const { token } = await params;
  const env = getEnv();
  const h = await headers();
  const deps = { ip: clientIp(h, env.TRUSTED_PROXIES), ipDoLimite: clientIpDoLimite(h, env.TRUSTED_PROXIES), appUrl: env.APP_URL, verificarTurnstile: async () => 'invalido' as const };
  const estado = await estadoDoLink(token, (await cookies()).get(NOME_COOKIE_LINK)?.value, deps);
  const dataDoDocumento = estado.tipo === 'aberto' ? formatarData(hojeNoFuso('America/Sao_Paulo', estado.data)) : '';
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-4 bg-fundo p-6 font-sans text-texto">
      <h1 className="font-titulo text-2xl font-semibold">Abrir documento</h1>
      {(estado.tipo === 'invalido' || estado.tipo === 'indisponivel') && <Aviso tipo="aviso">{MSG_LINK.invalido}</Aviso>}
      {estado.tipo === 'expirado' && <Aviso tipo="aviso">{MSG_LINK.expirado}</Aviso>}
      {estado.tipo === 'pedir_codigo' && <CodigoForm token={token} siteKey={env.TURNSTILE_SITE_KEY} />}
      {estado.tipo === 'aberto' && (
        <section aria-labelledby="documento" className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
          <h2 id="documento" className="font-semibold">{`${estado.titulo} · ${dataDoDocumento}${estado.versao > 1 ? ` · ${rotuloDaVersao(estado.versao)}` : ''}`}</h2>
          <a href={`/api/documento/${token}/pdf`} className="inline-flex min-h-11 items-center text-link underline">
            Abrir PDF
          </a>
          {/* Plano 22 (US-380, RN-396): o estado aberto só existe com o documento assinado em vigor; a mesma rota do "Abrir PDF" */}
          <CompartilharPdf url={`/api/documento/${token}/pdf`} tipo={estado.tipoDoc} data={dataDoDocumento} nomeDoArquivo={nomeDoPdf(estado.tipoDoc, dataDoDocumento)} />
          {estado.recebidoEm ? (
            <p role="status">{`Recebimento confirmado em ${formatarData(hojeNoFuso('America/Sao_Paulo', estado.recebidoEm))}.`}</p>
          ) : (
            <CodigoForm token={token} siteKey={null} confirmarRecebimento />
          )}
        </section>
      )}
    </main>
  );
}
