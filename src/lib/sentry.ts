import * as Sentry from '@sentry/node';
import type { NodeOptions } from '@sentry/node';
import { criarLimite } from './limite-memoria';
import { logger, nomeDoErro } from './logger';
import { filtrarBreadcrumb, filtrarEvento, type Breadcrumb, type EventoSentry } from './sentry-filtro';

type Papel = 'app' | 'worker';

/**
 * Se o Sentry está ligado, pelo próprio SDK (carrier global `__SENTRY__`). Nunca uma variável deste módulo: o Next
 * compila o instrumentation (onde o Sentry liga) e cada Route Handler em grafos separados, cada um com a sua cópia
 * deste arquivo — no build, a cópia da rota /api/erro-cliente via `false` para sempre e o minificador apagava o envio.
 * `isEnabled` (e não `isInitialized`): depois do `close`, o cliente continua lá, mas desligado.
 */
const ligado = (): boolean => Sentry.isEnabled();

/**
 * D1: teto do repasse dos erros do navegador ao Sentry. A rota é sem login (um curl sem Origin passa) e o limite por
 * IP não segura quem tem muitos IPs: sem teto global, a cota mensal do plano gratuito acabaria em horas e os erros
 * reais de app e worker deixariam de chegar. O mesmo erro (nome|rota|digest) vai uma vez por janela e não gasta o teto.
 * Estado em memória (D10, 1 réplica); só a rota chama, então a cópia do módulo dela é a que conta.
 */
const JANELA_NAVEGADOR_MS = 3_600_000;
const TETO_NAVEGADOR = 30;
const tetoNavegador = criarLimite({ janelaMs: JANELA_NAVEGADOR_MS, max: TETO_NAVEGADOR });
const enviadosDoNavegador = new Map<string, number>(); // assinatura → quando foi ao Sentry (no máximo TETO_NAVEGADOR vivas)

function repassarDoNavegador(assinatura: string, agora: number): boolean {
  const visto = enviadosDoNavegador.get(assinatura);
  if (visto !== undefined && agora - visto < JANELA_NAVEGADOR_MS) return false;
  if (!tetoNavegador.permitir('global', agora)) return false;
  for (const [k, t] of enviadosDoNavegador) if (agora - t >= JANELA_NAVEGADOR_MS) enviadosDoNavegador.delete(k);
  enviadosDoNavegador.set(assinatura, agora);
  return true;
}

/** Nenhuma categoria de dado coletada pelo SDK (v11: o que ficar de fora vale `true`). */
const SEM_COLETA = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
} as const satisfies NonNullable<NodeOptions['dataCollection']>;

/**
 * D1 / RNF-11: as únicas opções com que o Sentry sobe (guarda em sentry-guarda.test.ts). Sem PII, sem variáveis locais
 * na pilha, sem Replay (o SDK de Node nem tem). Todo evento passa pelo filtro.
 * Sem PII: o @sentry/node v11 tirou o `sendDefaultPii` e o trocou por `dataCollection`, cujo padrão é coletar TUDO
 * (usuário e IP, cookies, cabeçalhos, corpos HTTP, query string, dados de query do banco, argumentos de fila, variáveis
 * locais e linhas do código-fonte). Aqui cada categoria vai desligada, por extenso: o filtro continua sendo a barreira,
 * e isto é a segunda camada.
 * Sem tracing: no @sentry/node v8+ a taxa de amostragem igual a zero NÃO desliga o tracing (liga a instrumentação
 * OpenTelemetry e só deixa de enviar); desligado é não declarar a taxa nem o amostrador (docs.sentry.io, "Disabling
 * Tracing"). E tracePropagationTargets vazio: no servidor o padrão propaga sentry-trace/baggage para toda requisição
 * de saída (Resend, Evolution, FCM/APNs, oEmbed) — nenhum cabeçalho do Sentry sai para terceiros.
 * Worker sem a integração OnUnhandledRejection: no modo padrão ('warn') ela registra um handler que só avisa no console,
 * e um handler qualquer basta para o Node não derrubar o processo — o worker seguiria vivo num estado possivelmente
 * quebrado, sem o reinício do Swarm. Sem ela, vale o padrão do Node 24: a rejeição vira exceção não capturada, a
 * OnUncaughtException manda o evento `fatal` e sai com 1. (O modo 'strict' também sai, mas ignora o AbortError, que
 * ficaria engolido sem aviso.) O app fica com o padrão: o Next registra os próprios handlers.
 */
export function opcoesDoSentry(o: { dsn: string; ambiente: string; papel: Papel; release?: string }): NodeOptions {
  return {
    dsn: o.dsn,
    environment: o.ambiente,
    release: o.release,
    dataCollection: SEM_COLETA,
    includeLocalVariables: false,
    tracePropagationTargets: [],
    maxBreadcrumbs: 30,
    // os tipos do SDK são interfaces sem assinatura de índice: o filtro trabalha no formato mínimo (EventoSentry)
    beforeSend: (e) => filtrarEvento(e as unknown as EventoSentry) as unknown as typeof e,
    // v11: o padrão `traceLifecycle: 'stream'` ignora o beforeSendTransaction (e avisa no console a cada subida);
    // 'static' o mantém valendo — nenhuma transação sai, nem se alguém ligar a amostragem pelo ambiente
    traceLifecycle: 'static',
    beforeSendTransaction: () => null,
    beforeBreadcrumb: (b) => filtrarBreadcrumb(b as Breadcrumb) as typeof b | null,
    initialScope: { tags: { papel: o.papel } },
    ...(o.papel === 'worker' ? { integrations: (padrao) => padrao.filter((i) => i.name !== 'OnUnhandledRejection') } : {}),
  };
}

/** Liga o Sentry se houver DSN. Devolve se ligou. `transport` só nos testes. */
export function iniciarSentry(o: { dsn?: string; ambiente: string; papel: Papel; release?: string; transport?: NodeOptions['transport'] }): boolean {
  if (!o.dsn) return false;
  Sentry.init({ ...opcoesDoSentry({ dsn: o.dsn, ambiente: o.ambiente, papel: o.papel, release: o.release }), ...(o.transport ? { transport: o.transport } : {}) });
  logger.info({ papel: o.papel }, 'sentry ligado'); // nunca o DSN
  return true;
}

export function capturarErro(err: unknown, tags: Record<string, string>): void {
  if (!ligado()) return;
  Sentry.captureException(err, { tags });
}

/** `onRequestError` do Next (instrumentation.ts): uma linha de log com o id e o Sentry com as mesmas tags. */
export function registrarErroDaRequisicao(err: unknown, r: { requestId: string | null; rota: string; tipoRota: string }): void {
  const digest = typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest).slice(0, 40) : undefined;
  logger.error({ request_id: r.requestId, rota: r.rota, digest, erro: nomeDoErro(err) }, 'erro na requisição');
  const tags: Record<string, string> = { rota: r.rota, tipo_rota: r.tipoRota };
  if (r.requestId) tags.request_id = r.requestId;
  if (digest) tags.digest = digest;
  capturarErro(err, tags);
}

/**
 * Erro do navegador (rota /api/erro-cliente): só digest, nome e rota — nunca texto. O log sai sempre; o Sentry, dentro
 * do teto. `agora` só nos testes.
 */
export function capturarErroDoNavegador(e: { digest: string | null; nome: string; rota: string }, agora: number = Date.now()): void {
  logger.warn({ digest: e.digest, nome_erro: e.nome, rota: e.rota }, 'erro no navegador');
  if (!ligado()) return;
  const chave = [e.nome, e.rota, e.digest ?? '-'];
  if (!repassarDoNavegador(chave.join('|'), agora)) return;
  // a mensagem é fixa (o filtro só deixa passar as de MENSAGENS_FIXAS): sem fingerprint próprio, todo erro do navegador
  // cairia num issue só, e a integração Dedupe do SDK descartaria um erro diferente logo depois de outro
  Sentry.captureMessage('erro no navegador', {
    level: 'error',
    fingerprint: ['erro-no-navegador', ...chave],
    tags: { nome_erro: e.nome, rota: e.rota, ...(e.digest ? { digest: e.digest } : {}) },
  });
}

export async function encerrarSentry(): Promise<void> {
  if (!ligado()) return;
  await Sentry.close(2000);
}
