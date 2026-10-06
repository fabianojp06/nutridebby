import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { EsperaCanceladaError, esperarVersaoDoSchema, SchemaAtrasadoError, versaoEsperada } from './versao-schema';

const ESPERADA = { when: 1000, tag: '0096_teste' };
/** Relógio falso: `dormir` só anda o relógio (nenhum teste espera de verdade). */
function relogio() {
  let t = 0;
  return { agora: () => t, dormir: vi.fn(async (ms: number) => { t += ms; }) };
}
const erroPg = (code: string) => Object.assign(new Error('mensagem do banco que nunca vai para o log'), { code });
afterEach(() => vi.restoreAllMocks());

describe('o worker espera a versão do schema antes de registrar os consumidores (P09-02 a)', () => {
  it('versaoEsperada: a última entrada do journal do drizzle que veio com o código', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { when: number; tag: string }[] };
    const ultima = journal.entries.at(-1)!;
    expect(versaoEsperada()).toEqual({ when: ultima.when, tag: ultima.tag });
  });

  it('schema em dia (ou mais novo: worker antigo depois de um rollback) → segue na hora', async () => {
    for (const aplicada of [1000, 2000]) {
      const r = relogio();
      await esperarVersaoDoSchema({ esperada: ESPERADA, aplicada: async () => aplicada, ...r });
      expect(r.dormir).not.toHaveBeenCalled();
    }
  });

  it('migration ainda rodando no app: confere de novo a cada intervalo e segue quando ela termina', async () => {
    const r = relogio();
    const respostas = [null, 900, 1000];
    await esperarVersaoDoSchema({ esperada: ESPERADA, aplicada: async () => respostas.shift() ?? null, ...r, intervaloMs: 3000 });
    expect(r.dormir.mock.calls).toEqual([[3000], [3000]]);
  });

  it('Review Focus 2: a função da 0094 ainda não existe (o deploy deste plano) ou o banco caiu → espera, não derruba', async () => {
    const r = relogio();
    const erros = [erroPg('42883'), erroPg('57P01')];
    await esperarVersaoDoSchema({
      esperada: ESPERADA,
      aplicada: async () => { const e = erros.shift(); if (e) throw e; return 1000; },
      ...r,
    });
    expect(r.dormir).toHaveBeenCalledTimes(2);
  });

  it('passou do prazo → SchemaAtrasadoError; o log leva só a migration esperada, o nome do erro e o SQLSTATE', async () => {
    const r = relogio();
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await expect(
      esperarVersaoDoSchema({ esperada: ESPERADA, aplicada: async () => { throw erroPg('42883'); }, ...r, prazoMs: 10_000, intervaloMs: 3000 }),
    ).rejects.toBeInstanceOf(SchemaAtrasadoError);
    expect(r.dormir).toHaveBeenCalledTimes(4); // 0, 3, 6 e 9 s; aos 12 s passou dos 10
    expect(erro).toHaveBeenCalledWith({ migration: '0096_teste', aplicada: null, erro: 'Error', sqlstate: '42883' }, expect.any(String));
    expect(JSON.stringify(erro.mock.calls)).not.toContain('mensagem do banco');
  });

  it('code review do PR #22, item 6: o log do prazo vencido leva a última versão aplicada lida (mesmo que a última leitura tenha falhado)', async () => {
    const r = relogio();
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const respostas: (number | Error)[] = [900, 950, erroPg('57P01')];
    await expect(
      esperarVersaoDoSchema({
        esperada: ESPERADA,
        aplicada: async () => { const x = respostas.shift() ?? erroPg('57P01'); if (x instanceof Error) throw x; return x; },
        ...r, prazoMs: 10_000, intervaloMs: 3000,
      }),
    ).rejects.toBeInstanceOf(SchemaAtrasadoError);
    expect(erro).toHaveBeenCalledWith({ migration: '0096_teste', aplicada: 950, erro: 'Error', sqlstate: '57P01' }, expect.any(String));
  });

  it('o SQLSTATE embrulhado pelo Drizzle (cause) também vai para o log', async () => {
    const r = relogio();
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const embrulhado = Object.assign(new Error('Failed query: select app_versao_do_schema()'), { name: 'DrizzleQueryError', cause: erroPg('42883') });
    await expect(esperarVersaoDoSchema({ esperada: ESPERADA, aplicada: async () => { throw embrulhado; }, ...r, prazoMs: 1, intervaloMs: 3000 })).rejects.toBeInstanceOf(SchemaAtrasadoError);
    expect(erro).toHaveBeenCalledWith({ migration: '0096_teste', aplicada: null, erro: 'DrizzleQueryError', sqlstate: '42883' }, expect.any(String));
  });

  it('code review do PR #22, item 4: o sinal de encerramento corta a espera na hora (sem esperar o intervalo nem o prazo)', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const ctrl = new AbortController();
    const aplicada = vi.fn(async () => 900);
    const inicio = Date.now();
    const espera = esperarVersaoDoSchema({ esperada: ESPERADA, aplicada, intervaloMs: 60_000, sinal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    await expect(espera).rejects.toBeInstanceOf(EsperaCanceladaError);
    expect(Date.now() - inicio).toBeLessThan(5_000);
    expect(aplicada).toHaveBeenCalledTimes(1);
    // sinal que chegou antes: nem lê o banco
    const lida = vi.fn(async () => 1000);
    await expect(esperarVersaoDoSchema({ esperada: ESPERADA, aplicada: lida, sinal: AbortSignal.abort() })).rejects.toBeInstanceOf(EsperaCanceladaError);
    expect(lida).not.toHaveBeenCalled();
  });

  it('startWorker espera o schema ANTES de subir o pg-boss (nenhum consumidor nem agendamento antes), cancelável pelo sinal', () => {
    const src = readFileSync('src/worker/index.ts', 'utf8');
    const espera = src.indexOf('await esperarVersaoDoSchema(');
    expect(espera).toBeGreaterThan(-1);
    expect(espera).toBeLessThan(src.indexOf('new PgBoss('));
    expect(src.slice(espera, src.indexOf(');', espera))).toContain('sinal');
  });

  it('item 4: o processo do worker registra SIGTERM/SIGINT antes de iniciar (rodarComSinais), não depois de startWorker', () => {
    const src = readFileSync('src/worker/index.ts', 'utf8');
    const principal = src.slice(src.indexOf('if (import.meta.url'));
    expect(principal).toContain('rodarComSinais(');
    expect(principal).not.toContain('process.on(');
  });
});
