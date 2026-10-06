import { logger } from '@/lib/logger';

type Sinal = 'SIGTERM' | 'SIGINT';

/**
 * Code review do PR #22, item 4: o node como PID 1 do container ignora SIGTERM/SIGINT sem ouvinte. Os ouvintes entram
 * ANTES de iniciar — a espera pelo schema (até 5 min) já recebe o sinal pelo AbortSignal e desiste na hora; sem isso,
 * o Swarm esperaria o grace period e mataria o processo. Sinal durante a inicialização: espera ela desistir (ou terminar),
 * fecha o que abriu e sai com 0. Com o worker no ar: `parar` (o do startWorker, idempotente) e sai com 0. Uma falha da
 * inicialização sem sinal sobe (o processo sai com erro e o Swarm o reinicia).
 */
export async function rodarComSinais(deps: {
  iniciar: (sinal: AbortSignal) => Promise<() => Promise<void>>;
  /** Sinal recebido antes de o worker estar no ar: fecha banco e Sentry. */
  fechar: () => Promise<void>;
  ouvir?: (sinal: Sinal, fn: () => void) => void;
  sair?: (codigo: number) => void;
}): Promise<void> {
  const ouvir = deps.ouvir ?? ((s: Sinal, fn: () => void) => void process.on(s, fn));
  const sair = deps.sair ?? ((codigo: number) => process.exit(codigo));
  const ctrl = new AbortController();
  let encerrando = false;
  const aoSinal = (s: Sinal) => {
    if (encerrando) return;
    encerrando = true;
    logger.info({ signal: s }, 'encerrando worker');
    ctrl.abort();
    void (async () => {
      try {
        const parar = await inicio.catch(() => undefined); // o sinal só chega depois de `inicio` existir
        await (parar ? parar() : deps.fechar());
      } catch {
        // encerrando de qualquer jeito: o Swarm sobe outro
      } finally {
        sair(0);
      }
    })();
  };
  ouvir('SIGTERM', () => aoSinal('SIGTERM'));
  ouvir('SIGINT', () => aoSinal('SIGINT'));
  const inicio = deps.iniciar(ctrl.signal);
  try {
    await inicio;
  } catch (e) {
    if (!ctrl.signal.aborted) throw e; // com sinal, quem encerra é aoSinal
  }
}
