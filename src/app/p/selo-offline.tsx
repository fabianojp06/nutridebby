'use client';
import { useEffect, useState } from 'react';
import { EVENTO_REDE_VOLTOU } from '../sw-regras';

/** Sem resposta do ping em 5 s ("lie-fi": a rede existe mas não responde — o NetworkFirst já serviu a cópia aos 4 s) = offline. */
const PRAZO_PING_MS = 5000;
/** SUS-112: com `navigator.onLine` verdadeiro e o ping falhando, o ping se repete neste intervalo até voltar. */
export const REPETIR_PING_MS = 15_000;

type Relogio = { setTimeout: (f: () => void, ms: number) => unknown; clearTimeout: (t: never) => void };

/**
 * A rede do portal pelo ping: `conferir` (na montagem e a cada `online`/`offline`) liga `aoMudar(fora)`. Fora com
 * `navigator.onLine` verdadeiro (rede lenta, a cópia do NetworkFirst), o ping se repete a cada `REPETIR_PING_MS`; de fora
 * para dentro, `aoVoltar` (SUS-112: o selo dispara EVENTO_REDE_VOLTOU, que recarrega a cópia). Um resultado velho (outra
 * conferência começou depois) é descartado. Sem DOM: tudo injetável nos testes.
 */
export function vigiarRede(o: { ping: () => Promise<boolean>; online: () => boolean; aoMudar: (fora: boolean) => void; aoVoltar: () => void; relogio?: Relogio }) {
  const relogio = o.relogio ?? (globalThis as unknown as Relogio);
  let fora = false;
  let vez = 0;
  let parado = false;
  let timer: unknown;
  const limpar = () => {
    if (timer !== undefined) relogio.clearTimeout(timer as never);
    timer = undefined;
  };
  const conferir = async () => {
    limpar();
    const minha = ++vez;
    const agoraFora = !o.online() || !(await o.ping().catch(() => false));
    if (parado || minha !== vez) return;
    const voltou = fora && !agoraFora;
    fora = agoraFora;
    o.aoMudar(fora);
    if (voltou) o.aoVoltar();
    if (fora && o.online()) timer = relogio.setTimeout(() => void conferir(), REPETIR_PING_MS);
  };
  return {
    conferir,
    parar: () => {
      parado = true;
      limpar();
    },
  };
}

/**
 * US-040 "Offline": "Offline — exibindo última versão" quando a página veio do cache do service worker. A região viva
 * (role="status") fica sempre montada e só o texto muda: inserida já com o texto, o leitor de tela costuma não anunciar.
 */
export function SeloOffline() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const rede = vigiarRede({
      ping: async () => (await fetch('/api/p/ping', { cache: 'no-store', signal: AbortSignal.timeout(PRAZO_PING_MS) })).ok,
      online: () => navigator.onLine,
      aoMudar: setOffline,
      aoVoltar: () => window.dispatchEvent(new Event(EVENTO_REDE_VOLTOU)),
    });
    const conferir = () => void rede.conferir();
    conferir();
    window.addEventListener('online', conferir);
    window.addEventListener('offline', conferir);
    return () => {
      rede.parar();
      window.removeEventListener('online', conferir);
      window.removeEventListener('offline', conferir);
    };
  }, []);
  return (
    <p role="status" className={offline ? 'bg-aviso-fundo px-6 py-2 text-aviso' : 'sr-only'}>
      {offline ? 'Offline — exibindo última versão' : ''}
    </p>
  );
}
