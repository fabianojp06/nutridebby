import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registrar = vi.fn();
vi.mock('./lib/sentry', () => ({ registrarErroDaRequisicao: (...a: unknown[]) => registrar(...a) }));
const { onRequestError } = await import('./instrumentation');

const ID_DO_PROXY = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
const contexto = (routeType: 'render' | 'route' | 'action') =>
  ({ routerKind: 'App Router', routePath: '/painel/pacientes/[id]', routeType, renderSource: 'server-rendering', revalidateReason: undefined, renderType: 'dynamic' }) as never;
const pedido = (path: string) => ({ path, method: 'GET', headers: { 'x-request-id': ID_DO_PROXY } });

beforeEach(() => {
  registrar.mockReset();
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
});
afterEach(() => vi.unstubAllEnvs());

describe('onRequestError (P08-01, D2)', () => {
  it('página/ação (passa pelo proxy): usa o x-request-id que o proxy gravou', async () => {
    const err = new Error('x');
    await onRequestError(err, pedido('/painel/pacientes/1'), contexto('render'));
    expect(registrar).toHaveBeenCalledWith(err, { requestId: ID_DO_PROXY, rota: '/painel/pacientes/[id]', tipoRota: 'render' });
  });
  it('/api/* e /serwist/* (fora do proxy): o cabeçalho viria do cliente — id sempre novo', async () => {
    for (const p of ['/api/p/diario', '/serwist/sw.js']) {
      registrar.mockReset();
      await onRequestError(new Error('x'), pedido(p), contexto('route'));
      const { requestId } = registrar.mock.calls[0]![1] as { requestId: string };
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(requestId).not.toBe(ID_DO_PROXY);
    }
  });
  it('fora do runtime Node não faz nada', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await onRequestError(new Error('x'), pedido('/painel'), contexto('render'));
    expect(registrar).not.toHaveBeenCalled();
  });
});
