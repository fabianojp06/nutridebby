'use client';

/** D1: avisa o servidor de um erro no navegador — só o digest, o nome da classe e o caminho (nunca a mensagem). */
export function reportarErro(error: Error & { digest?: string }): void {
  try {
    const corpo = JSON.stringify({ digest: error.digest, nome: /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(error.name) ? error.name : 'Error', rota: location.pathname });
    if (!navigator.sendBeacon?.('/api/erro-cliente', new Blob([corpo], { type: 'application/json' }))) {
      void fetch('/api/erro-cliente', { method: 'POST', body: corpo, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch {
    // relatar erro nunca pode gerar outro erro
  }
}
