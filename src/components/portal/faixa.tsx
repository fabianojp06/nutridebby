import type { ReactNode } from 'react';
import type { SecaoPortal } from '@/app/p/navegacao';
import { SeloOffline } from '@/app/p/selo-offline';
import type { MarcaTenant } from '@/modules/plataforma/marca';
import { NavSecoes } from './nav-secoes';
import { MSG_G } from './textos';

/**
 * Plano 16 (§4.2, D10, RN-207): a faixa do topo de cada seção, na cor da faixa (corDaFaixa da cor do consultório, posta
 * pelo layout em --nd-faixa), texto sempre branco, nenhum texto em verde claro. Linha 1: logo e "Acompanhamento com
 * {consultório}" (US-005; diz o consultório a quem tem mais de um vínculo, RN-210). Depois o h1 da seção, o que a página
 * põe dentro (a mini-jornada em Hoje) e as seções. data-sobre-marca: foco branco (globals.css). Servidor, sem JavaScript.
 */
export function Faixa({ marca, titulo, subtitulo, secoes, atual, children }: { marca: MarcaTenant; titulo: string; subtitulo?: string; secoes: readonly SecaoPortal[]; atual: string; children?: ReactNode }) {
  return (
    <>
      <header data-sobre-marca="" data-guia="faixa" className="bg-faixa px-4 pb-3 pt-3 text-white">
        <p className="flex items-center gap-2 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, sem otimização do Next */}
          {marca.logoUrl && <img src={marca.logoUrl} alt={MSG_G.logo(marca.nome)} className="h-8 w-auto rounded bg-white p-1" />}
          <span>{MSG_G.acompanhamento(marca.nome)}</span>
        </p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="font-portal-titulo text-2xl font-extrabold">{titulo}</h1>
          {subtitulo && <p className="text-sm">{subtitulo}</p>}
        </div>
        {children}
        <NavSecoes secoes={secoes} atual={atual} />
      </header>
      <SeloOffline />
    </>
  );
}
