'use client';

const URL_ERRO = '/api/erro-cliente';

/**
 * O sendBeacon com o corpo em `text/plain` (tipo CORS-safelisted): com `application/json` o Chrome lança SecurityError, e
 * o erro nunca chegava. A rota lê o corpo como JSON qualquer que seja o tipo. Se o beacon lançar ou recusar (fila cheia),
 * vai pelo fetch.
 */
function enviarPorBeacon(corpo: string): boolean {
  try {
    return navigator.sendBeacon?.(URL_ERRO, new Blob([corpo], { type: 'text/plain' })) === true;
  } catch {
    return false;
  }
}

/** D1: avisa o servidor de um erro no navegador — só o digest, o nome da classe e o caminho (nunca a mensagem). */
export function reportarErro(error: Error & { digest?: string }): void {
  try {
    const corpo = JSON.stringify({ digest: error.digest, nome: /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(error.name) ? error.name : 'Error', rota: location.pathname });
    if (!enviarPorBeacon(corpo)) {
      void fetch(URL_ERRO, { method: 'POST', body: corpo, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch {
    // relatar erro nunca pode gerar outro erro
  }
}
