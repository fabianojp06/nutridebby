import type { Instrumentation } from 'next';

/** P08-01: o Sentry do servidor (só no runtime Node). Sem SENTRY_DSN, nada liga. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getEnv } = await import('./env');
  const { iniciarSentry } = await import('./lib/sentry');
  const env = getEnv();
  iniciarSentry({ dsn: env.SENTRY_DSN, ambiente: env.SENTRY_ENVIRONMENT ?? 'producao', papel: 'app' });
}

/** Todo erro de página, ação ou Route Handler: log com o request_id e o Sentry (filtrado). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ registrarErroDaRequisicao }, { novoRequestId, requestIdDe }] = await Promise.all([import('./lib/sentry'), import('./lib/request-id')]);
  // D2: páginas e ações passam pelo proxy, que sobrescreve o x-request-id do cliente — esse id vale. /api/* e /serwist/*
  // ficam fora do matcher: lá o cabeçalho viria do cliente (forjável), então o id nasce aqui, sempre novo.
  const foraDoProxy = /^\/(api|serwist)\//.test(request.path);
  const requestId = (foraDoProxy ? null : requestIdDe(request.headers['x-request-id'])) ?? novoRequestId();
  registrarErroDaRequisicao(err, { requestId, rota: context.routePath, tipoRota: context.routeType });
};
