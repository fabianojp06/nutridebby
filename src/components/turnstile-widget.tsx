'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type Turnstile = { render(el: HTMLElement, opcoes: Record<string, unknown>): string; remove(id: string): void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** Widget do Cloudflare Turnstile (INT-06). O token só vale depois de validado no servidor. */
export function TurnstileWidget(props: { siteKey: string; onToken: (token: string | null) => void; onIndisponivel: () => void }) {
  const alvo = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    callbacks.current = props; // callbacks sempre atuais sem recriar o widget
  });

  useEffect(() => {
    if (!pronto || !alvo.current || !window.turnstile) return;
    const id = window.turnstile.render(alvo.current, {
      sitekey: props.siteKey,
      language: 'pt-br',
      callback: (t: string) => callbacks.current.onToken(t),
      'expired-callback': () => callbacks.current.onToken(null),
      'error-callback': () => {
        callbacks.current.onToken(null);
        callbacks.current.onIndisponivel();
      },
    });
    return () => window.turnstile?.remove(id);
  }, [pronto, props.siteKey]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setPronto(true)}
        onError={() => callbacks.current.onIndisponivel()}
      />
      <div ref={alvo} />
    </>
  );
}
