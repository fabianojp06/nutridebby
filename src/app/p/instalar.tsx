'use client';
import { useEffect, useState } from 'react';
import { estadoDeInstalacao, type EstadoInstalacao } from './instalacao';

type PromptDeInstalacao = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/** Aberto como app instalado (o iOS antigo só diz pelo `navigator.standalone`). */
export const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function Instalar() {
  const [prompt, setPrompt] = useState<PromptDeInstalacao | null>(null);
  const [estado, setEstado] = useState<EstadoInstalacao>('nada');
  useEffect(() => {
    const calcular = (temPrompt: boolean) =>
      setEstado(estadoDeInstalacao({ ua: navigator.userAgent, standalone: standalone(), temPrompt, toques: navigator.maxTouchPoints, plataforma: navigator.platform }));
    calcular(false);
    const aoPedir = (e: Event) => {
      e.preventDefault(); // guarda o evento: o prompt só abre no clique do botão
      setPrompt(e as PromptDeInstalacao);
      calcular(true);
    };
    const aoInstalar = () => {
      setPrompt(null);
      setEstado('instalado');
    };
    window.addEventListener('beforeinstallprompt', aoPedir);
    window.addEventListener('appinstalled', aoInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPedir);
      window.removeEventListener('appinstalled', aoInstalar);
    };
  }, []);
  if (estado === 'android' && prompt) {
    return (
      <button
        onClick={async () => {
          await prompt.prompt();
          setPrompt(null);
          setEstado('nada');
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
