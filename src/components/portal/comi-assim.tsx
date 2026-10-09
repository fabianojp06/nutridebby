'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { recusaDoPortal } from '@/app/p/recusa-api';
import { MSG_DIARIO, ROTULO_RESPOSTA } from '@/modules/portal/diario-constantes';
import { focoVaiAoDesfazer, mensagemDaFase, mostraBotao, MSG_COMI_ASSIM, PRAZO_DESFAZER_MS, saiuDaTela, sobra, type FaseComiAssim } from './comi-assim-estado';
import { useOnline } from './online';

/**
 * Plano 16 (US-192, RN-197, RN-198): "Comi assim" grava no diário (POST /api/p/diario, refeicaoId + resposta). O toque
 * mostra "Registrado no diário." com "Desfazer" por 10 s; o prazo pausa com foco ou ponteiro no aviso (WCAG 2.2.1); ao fim
 * do prazo, ao sair da tela (pagehide, ou a página escondida: tela inicial, outro app) ou ao desmontar, envia com keepalive — o paciente já disse que comeu. "Desfazer"
 * cancela antes de enviar: sem DELETE no banco (P06 D11). Sem rede, desabilitado (RN-208).
 */
/** `:focus-visible` (navegador sem suporte ao seletor: false — o toque não leva o foco). */
function focoVisivel(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function ComiAssim({ refeicaoId }: { refeicaoId: string }) {
  const router = useRouter();
  const online = useOnline();
  const [fase, setFase] = useState<FaseComiAssim>('pronto');
  const [erro, setErro] = useState<string | null>(null);
  const pendente = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prazo = useRef({ restante: PRAZO_DESFAZER_MS, desde: 0 });
  // Correção da revisão do plano: quem chegou pelo foco (teclado, leitor de tela) não pode perder o foco no <body> quando o
  // botão sai do DOM — o foco vai ao "Desfazer" (o que já pausa o prazo, WCAG 2.2.1) e, ao desfazer, volta ao "Comi assim".
  const botao = useRef<HTMLButtonElement>(null);
  const botaoDesfazer = useRef<HTMLButtonElement>(null);
  const focoPara = useRef<'desfazer' | 'botao' | null>(null);
  useEffect(() => {
    if (focoPara.current === 'desfazer' && fase === 'aguardando') botaoDesfazer.current?.focus();
    if (focoPara.current === 'botao' && mostraBotao(fase)) botao.current?.focus();
    focoPara.current = null;
  }, [fase]);

  const enviar = useCallback(
    async (keepalive: boolean) => {
      if (!pendente.current) return;
      pendente.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setFase('enviando');
      const corpo = new FormData();
      corpo.set('refeicaoId', refeicaoId);
      corpo.set('resposta', 'como_no_plano');
      try {
        const r = await fetch('/api/p/diario', { method: 'POST', body: corpo, keepalive });
        if (r.ok) {
          setFase('feito');
          router.refresh();
          return;
        }
        const dados = (await r.json().catch(() => ({}))) as { erros?: { geral?: string } };
        setErro(recusaDoPortal(r.status, dados, location.pathname)?.mensagem ?? dados.erros?.geral ?? MSG_DIARIO.ocupado);
      } catch {
        setErro(MSG_DIARIO.ocupado);
      }
      setFase('erro');
    },
    [refeicaoId, router],
  );

  const agendar = useCallback(
    (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      prazo.current = { restante: ms, desde: Date.now() };
      timer.current = setTimeout(() => void enviar(false), ms);
    },
    [enviar],
  );

  useEffect(() => {
    const aoSair = () => void enviar(true);
    const aoEsconder = () => {
      if (saiuDaTela(document.visibilityState)) void enviar(true);
    };
    window.addEventListener('pagehide', aoSair);
    document.addEventListener('visibilitychange', aoEsconder);
    return () => {
      window.removeEventListener('pagehide', aoSair);
      document.removeEventListener('visibilitychange', aoEsconder);
      void enviar(true); // saiu da tela pelo app (outra seção) dentro do prazo: envia
    };
  }, [enviar]);

  const tocar = (e: MouseEvent<HTMLButtonElement>) => {
    // teclado/leitor de tela (detail 0 ou :focus-visible): o foco segue para o "Desfazer"; toque e mouse não levam o foco (no
    // Chrome o botão já tem o foco no pointerdown — o activeElement não distingue o toque) e o prazo de 10 s corre
    const peloFoco = focoVaiAoDesfazer(e.detail, focoVisivel(e.currentTarget));
    pendente.current = true;
    setErro(null);
    if (PRAZO_DESFAZER_MS === 0) return void enviar(false);
    focoPara.current = peloFoco ? 'desfazer' : null;
    setFase('aguardando');
    agendar(PRAZO_DESFAZER_MS);
  };
  const desfazer = () => {
    pendente.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    focoPara.current = 'botao';
    setFase('desfeito');
  };
  const pausar = () => {
    if (!pendente.current || !timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    prazo.current.restante = sobra(prazo.current.restante, Date.now() - prazo.current.desde);
  };
  const retomar = () => {
    if (pendente.current && !timer.current) agendar(prazo.current.restante);
  };

  return (
    <div className="space-y-1">
      {mostraBotao(fase) && (
        <button
          ref={botao}
          type="button"
          onClick={tocar}
          disabled={!online}
          aria-describedby={online ? undefined : `sem-rede-${refeicaoId}`}
          className="min-h-11 rounded-full border-2 border-marca bg-cartao px-4 font-semibold text-texto disabled:opacity-60"
        >
          {ROTULO_RESPOSTA.como_no_plano}
        </button>
      )}
      {!online && mostraBotao(fase) && (
        <p id={`sem-rede-${refeicaoId}`} className="text-sm text-suave">{MSG_COMI_ASSIM.semConexao}</p>
      )}
      <div onFocus={pausar} onBlur={retomar} onPointerEnter={pausar} onPointerLeave={retomar} className="flex flex-wrap items-center gap-2">
        <p role="status" className="text-sm">
          {mensagemDaFase(fase)}
          {fase === 'aguardando' && <span className="sr-only">{` ${MSG_COMI_ASSIM.podeDesfazer}`}</span>}
        </p>
        {fase === 'aguardando' && (
          <button ref={botaoDesfazer} type="button" onClick={desfazer} className="min-h-11 px-2 font-semibold text-link underline">
            {MSG_COMI_ASSIM.desfazer}
          </button>
        )}
      </div>
      {fase === 'erro' && erro && <p role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}
