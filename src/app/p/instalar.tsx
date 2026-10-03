'use client';
import { useSyncExternalStore } from 'react';
import { estadoDeInstalacao, type EstadoInstalacao } from './instalacao';
import { assinarInstalacao, estadoDoPrompt, promptUsado } from './instalacao-prompt';

/** Aberto como app instalado (o iOS antigo só diz pelo `navigator.standalone`). */
export const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const SEM_PROMPT: ReturnType<typeof estadoDoPrompt> = { prompt: null, instalado: false };
const nenhumaMudanca = () => () => undefined;

export function Instalar() {
  // o evento é guardado por instalacao-prompt.ts (carregado pelo layout do portal), mesmo se chegou antes desta tela
  const { prompt, instalado } = useSyncExternalStore(assinarInstalacao, estadoDoPrompt, () => SEM_PROMPT);
  // no servidor (e na hidratação) não há navegador para olhar: nada; no cliente, o estado sai do navegador
  const noCliente = useSyncExternalStore(nenhumaMudanca, () => true, () => false);
  const estado: EstadoInstalacao = !noCliente
    ? 'nada'
    : instalado
      ? 'instalado'
      : estadoDeInstalacao({ ua: navigator.userAgent, standalone: standalone(), temPrompt: prompt !== null, toques: navigator.maxTouchPoints, plataforma: navigator.platform });
  if (estado === 'android' && prompt) {
    return (
      <button
        onClick={async () => {
          await prompt.prompt();
          promptUsado();
        }}
        className="min-h-11 rounded bg-emerald-700 px-4 text-white"
      >
        Instalar app
      </button>
    );
  }
  if (estado === 'ios') {
    return (
      <section aria-labelledby="instalar-iphone" className="space-y-2 rounded border p-4">
        <h2 id="instalar-iphone" className="font-semibold">Instalar app</h2>
        <p>
          Para instalar no iPhone: toque em Compartilhar{' '}
          <svg aria-hidden="true" viewBox="0 0 24 24" className="inline size-5 align-text-bottom" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" />
          </svg>{' '}
          → Adicionar à Tela de Início.
        </p>
        <p>Depois de instalar, abra o app pela tela de início para ativar as notificações.</p>
      </section>
    );
  }
  return null;
}
