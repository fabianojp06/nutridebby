import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it } from 'vitest';
import { capturarErro, encerrarSentry, iniciarSentry, opcoesDoSentry, registrarErroDaRequisicao } from './sentry';
import { filtrarBreadcrumb, filtrarEvento } from './sentry-filtro';

const DSN = 'https://chave@o0.ingest.sentry.io/0';

/** Transporte falso: guarda os envelopes em texto (nada sai da máquina). */
function transporteFalso(enviados: string[]) {
  return () => ({
    send: async (envelope: unknown) => {
      enviados.push(JSON.stringify(envelope, (_k, v) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : v)));
      return {};
    },
    flush: async () => true,
  });
}

afterEach(async () => {
  await encerrarSentry();
});

describe('Sentry (P08-01, D1)', () => {
  it('opções: filtro em tudo, sem PII, sem tracing, sem variáveis locais', () => {
    const o = opcoesDoSentry({ dsn: DSN, ambiente: 'producao', papel: 'app' });
    expect(o.beforeSend?.({ message: 'Ana Souza', user: { email: 'ana@ex.com', id: 'u1' } } as never, {} as never)).toEqual(filtrarEvento({ message: 'Ana Souza', user: { email: 'ana@ex.com', id: 'u1' } }));
    expect(o.beforeBreadcrumb?.({ category: 'console', message: 'Ana Souza' } as never, {} as never)).toBeNull();
    expect(filtrarBreadcrumb({ category: 'console' })).toBeNull();
    expect(o.beforeSendTransaction?.({} as never, {} as never)).toBeNull();
    expect(o.traceLifecycle).toBe('static'); // v11: com 'stream' (o padrão) o beforeSendTransaction é ignorado
    expect(o).toMatchObject({ dsn: DSN, environment: 'producao', includeLocalVariables: false, tracePropagationTargets: [] });
    // v11: `sendDefaultPii` não existe mais; no lugar, `dataCollection` com padrão "coleta tudo" — cada categoria desligada
    expect('sendDefaultPii' in o).toBe(false);
    expect(o.dataCollection).toEqual({
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
    });
    // v8+: tracesSampleRate 0 NÃO desliga o tracing (só não envia); desligado = a chave ausente (docs.sentry.io, "Disabling Tracing")
    expect('tracesSampleRate' in o).toBe(false);
    expect('tracesSampler' in o).toBe(false);
    expect(o.initialScope).toMatchObject({ tags: { papel: 'app' } });
  });

  it('sem DSN não liga (e capturarErro não faz nada)', () => {
    expect(iniciarSentry({ dsn: undefined, ambiente: 'producao', papel: 'worker' })).toBe(false);
    expect(() => capturarErro(new Error('x'), { fila: 'email' })).not.toThrow();
  });

  it('envelope real do SDK: o erro com texto de saúde sai limpo; tags permitidas ficam', async () => {
    const enviados: string[] = [];
    expect(iniciarSentry({ dsn: DSN, ambiente: 'teste', papel: 'worker', transport: transporteFalso(enviados) as never })).toBe(true);
    // o cliente de verdade leu o `dataCollection` (nome certo na versão instalada): nada coletado, nem linha de código
    expect(Sentry.getClient()?.getDataCollectionOptions()).toMatchObject({ userInfo: false, cookies: false, httpBodies: [], databaseQueryData: false, stackFrameVariables: false, frameContextLines: 0 });
    Sentry.addBreadcrumb({ category: 'console', message: 'Ana Souza' });
    capturarErro(new Error('Glicemia 180 de Ana Souza (ana@ex.com)'), { fila: 'exportacao-paciente', motivo: 'ENOENT' });
    await Sentry.flush(2000);
    const tudo = enviados.join('\n');
    expect(tudo).toContain('exportacao-paciente');
    expect(tudo).toContain('[removido]');
    for (const t of ['Glicemia', 'Ana Souza', 'ana@ex.com']) expect(tudo).not.toContain(t);
  });

  it('erro de requisição: request_id e rota (padrão) como tags; mensagem removida', async () => {
    const enviados: string[] = [];
    iniciarSentry({ dsn: DSN, ambiente: 'teste', papel: 'app', transport: transporteFalso(enviados) as never });
    registrarErroDaRequisicao(Object.assign(new Error('anamnese: diabetes tipo 2'), { digest: '123456' }), {
      requestId: '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b',
      rota: '/painel/pacientes/[id]',
      tipoRota: 'render',
    });
    await Sentry.flush(2000);
    const tudo = enviados.join('\n');
    expect(tudo).toContain('0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b');
    expect(tudo).toContain('/painel/pacientes/[id]');
    expect(tudo).not.toContain('diabetes');
  });
});
