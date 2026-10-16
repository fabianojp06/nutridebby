import { logger } from '@/lib/logger';

type Sinal = 'SIGTERM' | 'SIGINT';

/**
 * P15-05: o worker sai com 128 + número do sinal (como o shell), não com 0. O serviço usa `restart: on-failure` no Swarm:
 * com 0, um sinal que não veio do Swarm (o worker parou assim em 14/10 e 15/10, ~10 h e ~23 h fora do ar) deixava o
 * serviço parado. Quando é o próprio Swarm que para a tarefa (deploy, escala a 0), ela já está com `desired=shutdown` e
 * não volta, qualquer que seja o código.
 */
export const CODIGO_DE_SAIDA: Record<Sinal, number> = { SIGTERM: 143, SIGINT: 130 };

/**
 * Code review do PR #22, item 4: o node como PID 1 do container ignora SIGTERM/SIGINT sem ouvinte. Os ouvintes entram
 * ANTES de iniciar — a espera pelo schema (até 5 min) já recebe o sinal pelo AbortSignal e desiste na hora; sem isso,
 * o Swarm esperaria o grace period e mataria o processo. Sinal durante a inicialização: espera ela desistir (ou terminar),
 * fecha o que abriu e sai com 128 + sinal (`CODIGO_DE_SAIDA`). Com o worker no ar: `parar` (o do startWorker, idempotente)
 * e sai do mesmo jeito. Uma falha da inicialização sem sinal sobe (o processo sai com erro e o Swarm o reinicia).
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
    const codigo = CODIGO_DE_SAIDA[s];
    logger.info({ signal: s, codigo }, 'encerrando worker');
    ctrl.abort();
    void (async () => {
      try {
        const parar = await inicio.catch(() => undefined); // o sinal só chega depois de `inicio` existir
        await (parar ? parar() : deps.fechar());
      } catch {
        // encerrando de qualquer jeito: o Swarm sobe outro
      } finally {
        sair(codigo);
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
