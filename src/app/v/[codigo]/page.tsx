import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { getEnv } from '@/env';
import { clientIpDoLimite } from '@/lib/ip';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { formatarCodigo } from '@/modules/documentos/codigo';
import { consultarVerificacao, MSG_VERIFICACAO, textoSha256, type VerificacaoPublica } from '@/modules/documentos/verificacao';
import { formatarData } from '@/modules/pacientes/datas';

export const dynamic = 'force-dynamic';
// O código está na URL: nunca mandá-lo como Referer (o next.config também manda o cabeçalho em /v/*)
export const metadata: Metadata = { title: 'Verificar documento', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const brasilia = (d: Date) => {
  const p = partesNoFuso(d, 'America/Sao_Paulo');
  return { data: formatarData(p.data), completo: `${formatarData(p.data)} às ${p.hora} (horário de Brasília)` };
};

function titulo(v: VerificacaoPublica): string {
  if (v.situacao === 'valido') return MSG_VERIFICACAO.valido;
  if (v.situacao === 'cancelado') return MSG_VERIFICACAO.cancelado(brasilia(v.situacaoEm).data);
  if (v.situacao === 'substituido') return MSG_VERIFICACAO.substituido(brasilia(v.situacaoEm).data);
  return MSG_VERIFICACAO.eliminado(brasilia(v.assinadoEm).data);
}

/** US-147 / D8: situação, tipo, data, quem emitiu (CRN), quem assinou e o SHA-256 — nada do paciente. Sem script. */
export default async function Verificacao({ params }: PageProps<'/v/[codigo]'>) {
  const { codigo } = await params;
  const r = await consultarVerificacao(codigo, { ipDoLimite: clientIpDoLimite(await headers(), getEnv().TRUSTED_PROXIES) });
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-4 bg-fundo p-6 font-sans text-texto">
      <h1 className="font-titulo text-2xl font-semibold">Verificar documento</h1>
      {r.tipo === 'limite' && <Aviso tipo="aviso" papel="alert">{MSG_VERIFICACAO.limite}</Aviso>}
      {r.tipo === 'nao_encontrado' && <Aviso tipo="aviso" papel="alert">{MSG_VERIFICACAO.naoEncontrado}</Aviso>}
      {r.tipo === 'ok' && (
        <section aria-labelledby="situacao" className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
          <h2 id="situacao" className="text-xl font-semibold">{titulo(r.v)}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Tipo:</dt>
            <dd>{r.v.tipo}</dd>
            <dt>Emitido por:</dt>
            <dd>{`${r.v.emissorNome} — ${r.v.emissorCrn}`}</dd>
            {r.v.assinanteNome && (
              <>
                <dt>Assinado por:</dt>
                <dd>{r.v.assinanteNome}</dd>
              </>
            )}
            <dt>Assinado em:</dt>
            <dd>{brasilia(r.v.assinadoEm).completo}</dd>
            <dt>Assinatura:</dt>
            <dd>{r.v.assinatura}</dd>
            <dt>Código:</dt>
            <dd>{formatarCodigo(r.v.codigo)}</dd>
          </dl>
          <p className="break-all font-mono text-sm">{`Impressão digital do arquivo (SHA-256): ${textoSha256(r.v.sha256)}`}</p>
          {/* o Plano 10B (T5) acrescenta aqui o link do validador do ITI para gov.br e ICP-Brasil (nunca na digitalizada, RN-157) */}
        </section>
      )}
      <Link href="/v" className="inline-flex min-h-11 items-center text-link underline">
        Verificar outro código
      </Link>
    </main>
  );
}
