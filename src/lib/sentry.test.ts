import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('worker: sem a integração OnUnhandledRejection (que, no modo padrão, só avisa e deixa o processo vivo); app: padrão', () => {
    const integracoes = opcoesDoSentry({ dsn: DSN, ambiente: 'producao', papel: 'worker' }).integrations;
    expect(typeof integracoes).toBe('function');
    const padrao = [{ name: 'OnUncaughtException' }, { name: 'OnUnhandledRejection' }, { name: 'Http' }] as never;
    expect((integracoes as (i: never) => { name: string }[])(padrao).map((i) => i.name)).toEqual(['OnUncaughtException', 'Http']);
    // o app fica com o padrão: o Next registra os próprios handlers de rejeição
    expect(opcoesDoSentry({ dsn: DSN, ambiente: 'producao', papel: 'app' }).integrations).toBeUndefined();
  });

  // Sem o Sentry, o Node 24 derruba o processo numa rejeição sem .catch e o Swarm reinicia o worker. Com o Sentry,
  // continua assim: a rejeição vira exceção não capturada, o SDK manda o evento `fatal` e sai com 1. Inclusive o
  // AbortError, que a integração do SDK ignora (mesmo no modo 'strict') e que deixaria o worker vivo sem aviso nenhum.
  it.each(['Error', 'AbortError'])('worker com DSN: rejeição sem tratamento (%s) derruba o processo com o evento fatal', (nome) => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'nd-sentry-'));
    try {
      const script = path.join(pasta, 'rejeicao.mts');
      writeFileSync(
        script,
        `const s = await import(${JSON.stringify(pathToFileURL(path.resolve('src/lib/sentry.ts')).href)});
const enviados = [];
const transport = () => ({ send: async (e) => { enviados.push(JSON.stringify(e, (_k, v) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : v))); return {}; }, flush: async () => true });
s.iniciarSentry({ dsn: ${JSON.stringify(DSN)}, ambiente: 'teste', papel: 'worker', transport });
process.on('exit', (codigo) => process.stdout.write('RESULTADO ' + JSON.stringify({ codigo, fatal: enviados.some((t) => t.includes('"level":"fatal"')) }) + '\\n'));
const e = new Error('falha de teste'); e.name = ${JSON.stringify(nome)};
Promise.reject(e);
setTimeout(() => process.exit(0), 5000); // ainda vivo = defeito
`,
      );
      const r = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: process.cwd(), encoding: 'utf8', timeout: 20_000, env: { ...process.env, LOG_LEVEL: 'silent' } });
      const linha = r.stdout.split('\n').find((l) => l.startsWith('RESULTADO '));
      expect(linha, r.stderr).toBeDefined();
      expect(JSON.parse(linha!.slice('RESULTADO '.length))).toEqual({ codigo: 1, fatal: true });
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  // O Next compila o instrumentation (onde o Sentry liga) e cada Route Handler em grafos separados, cada um com a sua
  // cópia deste módulo: o estado "ligado" tem de vir do SDK (carrier global), não de uma variável do módulo.
  it('outra cópia do módulo (outro bundle do Next) vê o Sentry ligado: erro do navegador e erro de servidor saem', async () => {
    const enviados: string[] = [];
    iniciarSentry({ dsn: DSN, ambiente: 'teste', papel: 'app', transport: transporteFalso(enviados) as never });
    vi.resetModules();
    const outra = await import('./sentry');
    outra.capturarErroDoNavegador({ digest: '1234567', nome: 'TypeError', rota: '/painel/pacientes/:id' });
    outra.capturarErro(new Error('x'), { fila: 'email' });
    await Sentry.flush(2000);
    const tudo = enviados.join('\n');
    expect(tudo).toContain('erro no navegador');
    expect(tudo).toContain('TypeError');
    expect(tudo).toContain('email');
    await outra.encerrarSentry(); // e a outra cópia também desliga
    expect(Sentry.isEnabled()).toBe(false);
  });

  // D1: a rota é sem login (um curl sem Origin passa) e o limite por IP não segura muitos IPs. O teto é por dia, não por
  // hora: 30 por hora deixava um único IP (variando a rota) esgotar a cota mensal do plano gratuito em ~7 dias.
  it('erros do navegador: teto global de 30 por dia para o Sentry e repetidos (nome|rota|digest) uma vez só', async () => {
    const enviados: string[] = [];
    vi.resetModules();
    const s = await import('./sentry'); // estado novo do teto
    s.iniciarSentry({ dsn: DSN, ambiente: 'teste', papel: 'app', transport: transporteFalso(enviados) as never });
    const t0 = 1_000_000;
    const HORA = 3_600_000;
    // repetido: o mesmo erro em loop no navegador vai uma vez e não gasta o teto
    for (let i = 0; i < 5; i++) s.capturarErroDoNavegador({ digest: 'abc', nome: 'TypeError', rota: '/painel' }, t0 + i);
    // 35 erros diferentes (quem os manda não importa: a chave do teto é fixa) → só 29 cabem com o primeiro
    for (let i = 0; i < 35; i++) s.capturarErroDoNavegador({ digest: null, nome: 'Error', rota: `/p${i}` }, t0 + 10 + i);
    // uma hora depois, nem um erro novo nem o repetido passam: o teto e a deduplicação valem pelo dia
    s.capturarErroDoNavegador({ digest: null, nome: 'Error', rota: '/uma-hora-depois' }, t0 + HORA);
    s.capturarErroDoNavegador({ digest: 'abc', nome: 'TypeError', rota: '/painel' }, t0 + HORA);
    s.capturarErroDoNavegador({ digest: null, nome: 'Error', rota: '/quase-um-dia' }, t0 + 24 * HORA - 1);
    // depois de 24 h, o teto e a deduplicação voltam
    s.capturarErroDoNavegador({ digest: 'abc', nome: 'TypeError', rota: '/painel' }, t0 + 24 * HORA);
    await Sentry.flush(2000);
    const doNavegador = enviados.filter((e) => e.includes('erro no navegador'));
    expect(doNavegador).toHaveLength(31);
    expect(doNavegador.filter((e) => e.includes('"/painel"'))).toHaveLength(2);
    expect(doNavegador.some((e) => e.includes('"/p29"'))).toBe(false);
    expect(doNavegador.some((e) => e.includes('/uma-hora-depois') || e.includes('/quase-um-dia'))).toBe(false);
    // erros de servidor e do worker não entram no teto do navegador
    s.capturarErro(new Error('x'), { fila: 'email' });
    await Sentry.flush(2000);
    expect(enviados.length).toBe(32);
    await s.encerrarSentry();
  });

  // Achado 2 do /code-review do PR #12: a mesma queda (Evolution/Resend fora do ar) falha em todo job da fila, a cada
  // tentativa. Sem teto, a cota do mês do plano gratuito acabaria em horas.
  it('erros de job: a mesma fila|motivo uma vez por hora, teto global de 50 por dia; fora do teto do navegador', async () => {
    const enviados: string[] = [];
    vi.resetModules();
    const s = await import('./sentry'); // estado novo do teto
    s.iniciarSentry({ dsn: DSN, ambiente: 'teste', papel: 'worker', transport: transporteFalso(enviados) as never });
    const t0 = 5_000_000;
    const HORA = 3_600_000;
    // a mesma falha em 200 jobs (e tentativas) na mesma hora: um evento só
    for (let i = 0; i < 200; i++) s.capturarErroDoJob(new Error(`falha ${i}`), 'whatsapp-enviar', 'ECONNREFUSED', t0 + i);
    // outra fila ou outro motivo é outro evento
    s.capturarErroDoJob(new Error('a'), 'email', 'ECONNREFUSED', t0 + 300);
    s.capturarErroDoJob(new Error('b'), 'whatsapp-enviar', 'ETIMEDOUT', t0 + 301);
    // uma hora depois a mesma falha volta a ir
    s.capturarErroDoJob(new Error('c'), 'whatsapp-enviar', 'ECONNREFUSED', t0 + HORA);
    await Sentry.flush(2000);
    expect(enviados).toHaveLength(4);
    // 60 falhas diferentes no mesmo dia: só cabem 50 no total (46 depois das 4 acima)
    // (mensagens diferentes: a integração Dedupe do SDK descarta um evento idêntico ao anterior)
    for (let i = 0; i < 60; i++) s.capturarErroDoJob(new Error(`falha ${i}`), `fila-${i}`, 'erro', t0 + 2 * HORA + i);
    await Sentry.flush(2000);
    expect(enviados).toHaveLength(50);
    expect(enviados.some((e) => e.includes('fila-45'))).toBe(true);
    expect(enviados.some((e) => e.includes('fila-46'))).toBe(false);
    // o teto do worker não gasta o do navegador
    s.capturarErroDoNavegador({ digest: null, nome: 'TypeError', rota: '/painel' }, t0 + 3 * HORA);
    await Sentry.flush(2000);
    expect(enviados.filter((e) => e.includes('erro no navegador'))).toHaveLength(1);
    // depois de 24 h, o teto volta
    s.capturarErroDoJob(new Error('d'), 'fila-59', 'erro', t0 + 24 * HORA + 1);
    await Sentry.flush(2000);
    expect(enviados.some((e) => e.includes('fila-59'))).toBe(true);
    await s.encerrarSentry();
  });
});
