'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { precisaDaSigla } from '@/app/p/quando-local';
// R4: o texto de MSG_G (jornada-regras é só do servidor: levaria o pg ao navegador)
import { MSG_G } from './textos';

type Texto = { semFuso: string; comFuso: string };
const semAssinatura = () => () => {};
const fusoDoAparelho = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';

/** O gráfico pequeno (decorativo, aria-hidden): os pesos em linha, traço branco a 85% (§4.7). Sem pontos, nada. */
function Tracinho({ pontos }: { pontos: number[] }) {
  const [min, max] = [Math.min(...pontos), Math.max(...pontos)];
  const y = (v: number) => (max === min ? 14 : 4 + ((max - v) / (max - min)) * 20);
  const d = pontos.map((v, i) => `${(i / (pontos.length - 1)) * 72 + 4},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg aria-hidden="true" viewBox="0 0 80 28" className="h-7 w-20 shrink-0">
      <polyline points={d} fill="none" stroke="rgb(255 255 255 / 0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Plano 16 (RN-202): a mini-jornada na faixa de Hoje — link para Jornada com a frase inteira como nome acessível, sem cor
 * de "bom" ou "ruim" (RN-206). Texto branco sobre o cartão translúcido (≥ 4,5:1 por corDaFaixa). Com o aparelho noutro
 * fuso, a hora leva a sigla (RN-06, como QuandoLocal).
 */
export function MiniJornada({ linha1, linha2, complemento, pontos, fuso }: { linha1: string; linha2: Texto; complemento: string | null; pontos: number[]; fuso: string }) {
  const aparelho = useSyncExternalStore(semAssinatura, fusoDoAparelho, () => '');
  const v = (t: Texto) => (precisaDaSigla(aparelho, fuso) ? t.comFuso : t.semFuso);
  // WCAG 2.5.3 (Rótulo no nome, nível A): sem aria-label — quem usa comando de voz diz o que vê ("−4,2 kg desde março").
  return (
    <Link href="/p/jornada" className="mt-3 flex min-h-11 items-center gap-3 rounded-2xl bg-faixa-cartao p-3 text-white">
      {pontos.length >= 2 && <Tracinho pontos={pontos} />}
      <span className="min-w-0 flex-1">
        <span className="block font-portal-titulo text-lg font-extrabold">
          {!linha1.startsWith(MSG_G.titulos.jornada) && <span className="sr-only">{`${MSG_G.titulos.jornada}: `}</span>}
          {linha1}
          {complemento && <span className="sr-only">{` (${complemento})`}</span>}
        </span>
        <span className="block text-sm">{v(linha2)}</span>
      </span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
