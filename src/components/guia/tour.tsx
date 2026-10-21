'use client';

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Guia } from '@/modules/ajuda/conteudo';

const CARTAO_LARGURA = 384;
const CARTAO_ALTURA = 240;

function posicao(c: DOMRect): CSSProperties | undefined {
  if (window.innerWidth < 640) return undefined; // folha no rodapé (classes max-sm)
  const left = Math.min(Math.max(12, c.left), window.innerWidth - 12 - CARTAO_LARGURA);
  const top = c.bottom + 16 + CARTAO_ALTURA < window.innerHeight ? c.bottom + 16 : Math.max(12, c.top - 16 - CARTAO_ALTURA);
  return { top, left };
}

/**
 * D26: <dialog> modal nativo (foco preso, Esc, fundo inerte). O "holofote" marca o alvo (data-guia); passo sem alvo,
 * ou com o alvo fora da tela (ex.: sem consulta hoje), aparece centralizado. A cada passo o foco vai ao título (o leitor
 * de tela anuncia). Esc = "Pular o tour" (grava "dispensado", D27). O alvo não é clicável durante o tour.
 */
export function Tour({
  guia,
  aberto,
  aoFechar,
  aoMarcar,
  focoAoFechar = '[data-guia="ajuda"]',
  folhaEvitaAlvo = false,
  classeTitulo = 'font-titulo text-xl font-semibold',
}: {
  guia: Guia;
  aberto: boolean;
  aoFechar: () => void;
  aoMarcar: (estado: 'concluido' | 'dispensado') => void;
  /** Para onde vai o foco quando não há a quem devolvê-lo (padrão: o botão "Ajuda" do cabeçalho do painel). */
  focoAoFechar?: string;
  /** Plano 16: abaixo de 640 px, a folha sobe para o topo quando cobriria o alvo (a barra de ações do portal fica embaixo). O painel não usa (G-D3). */
  folhaEvitaAlvo?: boolean;
  /** P08-13: a fonte do título (como em TextoLegalView) — o portal passa a dele e não baixa a Bricolage do painel. */
  classeTitulo?: string;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const [i, setI] = useState(0);
  const [caixa, setCaixa] = useState<DOMRect | null>(null);
  const passo = guia.passos[Math.min(i, guia.passos.length - 1)];
  const ultimo = i >= guia.passos.length - 1;
  // `caixa` só existe no cliente (medida no useLayoutEffect): o window daqui nunca roda no servidor
  const folhaNoTopo = folhaEvitaAlvo && !!caixa && caixa.bottom > window.innerHeight - CARTAO_ALTURA - 24;

  // antes do efeito do passo (mesma fase, ordem de declaração): o showModal move o foco, e o foco do título vem depois
  useLayoutEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  const medir = useCallback(() => {
    const alvo = passo.alvo ? document.querySelector<HTMLElement>(`[data-guia="${passo.alvo}"]`) : null;
    setCaixa(alvo && alvo.getClientRects().length > 0 ? alvo.getBoundingClientRect() : null);
  }, [passo]);

  useLayoutEffect(() => {
    if (!aberto) return;
    const alvo = passo.alvo ? document.querySelector<HTMLElement>(`[data-guia="${passo.alvo}"]`) : null;
    const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    alvo?.scrollIntoView({ block: 'center', behavior: reduz ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- medir o alvo no DOM depois do commit e antes da pintura é o uso do useLayoutEffect
    medir();
    titulo.current?.focus();
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [aberto, passo, medir]);

  const fechar = (estado: 'concluido' | 'dispensado') => {
    aoMarcar(estado); // o GuiaDoPainel (ou o GuiaDoPortal) atualiza o progresso local e grava na conta
    setI(0);
    const d = dialogo.current;
    d?.close(); // antes de desmontar: o navegador devolve o foco a quem o tinha antes de abrir
    // aberto pelo "Ver como funciona" (o aviso sai do DOM) ou pelo ?tour= do menu da conta (o link fica no <details>
    // fechado): não há a quem devolver. O foco cairia no <body> (risco 5 do plano) ou ficaria preso no botão do diálogo
    // fechado (o Chrome só corrige o foco de elemento escondido depois) — vai para `focoAoFechar` (no painel, o botão
    // "Ajuda" do cabeçalho; no portal, a seção Eu, onde mora o "Como usar o app")
    const ativo = document.activeElement;
    const perdido =
      !ativo || ativo === document.body || !!d?.contains(ativo) || (typeof ativo.checkVisibility === 'function' && !ativo.checkVisibility());
    if (perdido) document.querySelector<HTMLElement>(focoAoFechar)?.focus();
    aoFechar();
  };

  return (
    <dialog
      ref={dialogo}
      aria-labelledby="tour-titulo"
      aria-describedby="tour-texto"
      onCancel={(e) => {
        e.preventDefault();
        fechar('dispensado');
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
    >
      {caixa ? (
        <div
          aria-hidden="true"
          data-holofote
          className="pointer-events-none fixed rounded-2xl"
          style={{ top: caixa.top - 6, left: caixa.left - 6, width: caixa.width + 12, height: caixa.height + 12, boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.55)', outline: '3px solid var(--nd-foco)' }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0" style={{ background: 'rgb(0 0 0 / 0.55)' }} />
      )}
      <div
        style={caixa ? posicao(caixa) : undefined}
        className={`fixed w-[min(24rem,calc(100vw-1.5rem))] rounded-3xl border border-borda bg-cartao p-5 text-texto shadow-xl max-sm:inset-x-3 ${folhaNoTopo ? 'max-sm:top-3' : 'max-sm:bottom-3'} ${caixa ? '' : 'sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2'}`}
      >
        <p className="text-sm text-suave">{`${i + 1} de ${guia.passos.length}`}</p>
        <h2 id="tour-titulo" ref={titulo} tabIndex={-1} className={classeTitulo}>{passo.titulo}</h2>
        <p id="tour-texto" className="mt-2">{passo.texto}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="inline-flex min-h-11 items-center rounded-full border border-campo px-4">Voltar</button>
          )}
          {ultimo ? (
            <button type="button" onClick={() => fechar('concluido')} className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 font-semibold text-white">Concluir</button>
          ) : (
            <button type="button" onClick={() => setI(i + 1)} className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 font-semibold text-white">Próximo</button>
          )}
          <button type="button" onClick={() => fechar('dispensado')} className="ml-auto inline-flex min-h-11 items-center px-2 text-link underline">Pular o tour</button>
        </div>
      </div>
    </dialog>
  );
}
