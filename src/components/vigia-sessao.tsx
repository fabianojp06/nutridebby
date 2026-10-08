'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { CANAL_SESSAO, lerEstado, lerMensagem, motivoLocal, proximoPasso, relogioDe, type MensagemSessao, type Relogio } from '@/lib/sessao-relogio';
import { MSG_AVISO_INATIVIDADE, ROTULO_CONTINUAR, type MotivoDoFim } from '@/lib/session-rules';

const ROTA = '/api/sessao/ativa';
/** O que conta como uso real na tela (P12-14): tecla, clique/toque, roda do mouse e rolagem — em qualquer aba. */
const EVENTOS_DE_USO = ['keydown', 'pointerdown', 'touchstart', 'wheel', 'scroll'] as const;

type Resposta = ReturnType<typeof lerEstado> | 'expirada' | null;

/** GET pergunta quanto falta (sem renovar); POST registra o uso. 401 = a sessão já acabou no servidor. */
async function pedir(metodo: 'GET' | 'POST'): Promise<Resposta> {
  try {
    const r = await fetch(ROTA, { method: metodo, credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) return 'expirada';
    if (!r.ok) return null;
    return lerEstado(await r.json());
  } catch {
    return null; // rede caiu: segue com o relógio que tem
  }
}

/** BroadcastChannel; sem ele, o evento `storage` (as abas do mesmo navegador). Nunca lança. */
function abrirCanal(aoReceber: (m: MensagemSessao) => void): { enviar: (m: MensagemSessao) => void; fechar: () => void } {
  if (typeof BroadcastChannel === 'function') {
    const bc = new BroadcastChannel(CANAL_SESSAO);
    bc.onmessage = (e: MessageEvent) => {
      const m = lerMensagem(e.data);
      if (m) aoReceber(m);
    };
    return { enviar: (m) => bc.postMessage(m), fechar: () => bc.close() };
  }
  const aoMudar = (e: StorageEvent) => {
    if (e.key !== CANAL_SESSAO || !e.newValue) return;
    try {
      const m = lerMensagem(JSON.parse(e.newValue));
      if (m) aoReceber(m);
    } catch {
      // valor que não é JSON: ignora
    }
  };
  window.addEventListener('storage', aoMudar);
  return {
    enviar: (m) => {
      try {
        localStorage.setItem(CANAL_SESSAO, JSON.stringify({ ...m, n: Math.random() })); // `n`: a mesma mensagem duas vezes também dispara
      } catch {
        // armazenamento bloqueado: cada aba segue com o próprio relógio
      }
    },
    fechar: () => window.removeEventListener('storage', aoMudar),
  };
}

/**
 * P12-14 (RNF-06; boa prática SBIS NGS1 — bloqueio de sessão por inatividade): o relógio da sessão nas telas da equipe
 * (layout do painel e do admin). Uso real na tela renova a sessão no servidor (no máximo 1 vez a cada 5 min, dividido
 * entre as abas); 2 min antes do fim por falta de uso, o aviso (`alertdialog`, foco preso, Esc não fecha) com "Continuar
 * conectada"; sem resposta, a saída normal (`POST /sair`, com `Clear-Site-Data`) e `/entrar?motivo=inatividade` — ou
 * `?motivo=limite` nas 8 h. O servidor é a autoridade: antes de avisar e antes de sair, a tela pergunta quanto falta.
 */
export function VigiaDeSessao() {
  const [aberto, setAberto] = useState(false);
  const dialogo = useRef<HTMLDialogElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const campoMotivo = useRef<HTMLInputElement>(null);
  /** O aviso deve estar aberto (o `close` forçado pelo navegador reabre; o uso na tela não renova com ele aberto). */
  const avisando = useRef(false);
  const continuar = useRef<() => void>(() => undefined);

  useEffect(() => {
    let relogio: Relogio | null = null;
    let ultimoPing = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let arrasto: ReturnType<typeof setTimeout> | undefined;
    let encerrando = false;
    let ativo = true;
    const canal = abrirCanal(receber);

    const mostrar = (sim: boolean) => {
      avisando.current = sim;
      setAberto(sim);
    };

    function encerrar(motivo: MotivoDoFim, avisarAbas = true) {
      if (encerrando) return;
      encerrando = true;
      clearTimeout(timer);
      clearTimeout(arrasto);
      if (avisarAbas) canal.enviar({ tipo: 'encerrar', motivo });
      // a mesma saída do botão "Sair" (Clear-Site-Data, cookies apagados), com o motivo para o login
      if (campoMotivo.current) campoMotivo.current.value = motivo;
      formulario.current?.submit();
    }

    /** `conferido`: o relógio acabou de vir do servidor (ou o servidor não respondeu) — pode encerrar sem perguntar de novo. */
    function decidir(conferido: boolean) {
      clearTimeout(timer);
      if (!relogio || encerrando || !ativo) return;
      const passo = proximoPasso(relogio, Date.now());
      if (passo.tipo === 'encerrar') {
        if (conferido) encerrar(passo.motivo);
        else void conferir();
        return;
      }
      mostrar(passo.tipo === 'avisar');
      timer = setTimeout(() => void conferir(), Math.max(0, passo.ate - Date.now()));
    }

    function aplicar(r: Resposta): boolean {
      if (r === 'expirada') {
        encerrar(motivoLocal(relogio, Date.now()));
        return false;
      }
      if (r) relogio = relogioDe(r, Date.now());
      return true;
    }

    /** Pergunta ao servidor quanto falta, sem renovar. */
    async function conferir() {
      const r = await pedir('GET');
      if (ativo && aplicar(r)) decidir(true);
    }

    /** Registra o uso no servidor e avisa as outras abas. */
    async function renovar() {
      clearTimeout(arrasto);
      arrasto = undefined;
      ultimoPing = Date.now();
      const r = await pedir('POST');
      if (!ativo || !aplicar(r)) return;
      if (r && relogio) canal.enviar({ tipo: 'renovada', prazo: relogio.prazo, limite: relogio.limite, ping: ultimoPing });
      decidir(true);
    }
    continuar.current = () => void renovar();

    /** Uso real: renova já, se passou a cadência; senão, uma vez no fim dela (o último uso nunca se perde). */
    function uso() {
      if (encerrando || avisando.current || !relogio) return;
      const espera = ultimoPing + relogio.cadenciaMs - Date.now();
      if (espera <= 0) void renovar();
      else arrasto ??= setTimeout(() => void renovar(), espera);
    }

    function receber(m: MensagemSessao) {
      if (m.tipo === 'encerrar') return encerrar(m.motivo, false);
      ultimoPing = Math.max(ultimoPing, m.ping);
      if (relogio) relogio = { ...relogio, prazo: m.prazo, limite: m.limite };
      decidir(true);
    }

    /** Voltar à aba (ou acordar o computador): os timers podem ter atrasado — pergunta de novo. */
    function aoVoltar() {
      if (document.visibilityState === 'visible') void conferir();
    }

    const opcoes = { capture: true, passive: true } as const;
    for (const ev of EVENTOS_DE_USO) window.addEventListener(ev, uso, opcoes);
    document.addEventListener('visibilitychange', aoVoltar);
    void conferir();
    return () => {
      ativo = false;
      clearTimeout(timer);
      clearTimeout(arrasto);
      canal.fechar();
      for (const ev of EVENTOS_DE_USO) window.removeEventListener(ev, uso, opcoes);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, []);

  useLayoutEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <>
      <dialog
        ref={dialogo}
        role="alertdialog"
        aria-labelledby="sessao-aviso"
        // Esc não fecha sem decidir (P12-14)
        onCancel={(e) => e.preventDefault()}
        // o navegador pode forçar o fechamento (Esc repetido): enquanto o aviso vale, ele volta
        onClose={() => {
          if (avisando.current) dialogo.current?.showModal();
        }}
        className="m-auto w-[min(26rem,calc(100vw-1.5rem))] rounded-3xl border border-borda bg-cartao p-6 text-texto shadow-xl backdrop:bg-[rgb(0_0_0/0.55)]"
      >
        <h2 id="sessao-aviso" className="text-lg font-semibold">
          {MSG_AVISO_INATIVIDADE}
        </h2>
        <div className="mt-5 flex justify-end">
          {/* foco do :focus-visible global (--nd-foco, ≥ 3:1 contra o cartão nos dois modos e no admin): um outline-current
              seria o branco do texto, desenhado do lado de fora, sobre o cartão branco (revisão final do Plano 12) */}
          <Botao type="button" autoFocus onClick={() => continuar.current()}>
            {ROTULO_CONTINUAR}
          </Botao>
        </div>
      </dialog>
      <form ref={formulario} method="post" action="/sair" hidden>
        <input ref={campoMotivo} type="hidden" name="motivo" defaultValue="inatividade" />
      </form>
    </>
  );
}
