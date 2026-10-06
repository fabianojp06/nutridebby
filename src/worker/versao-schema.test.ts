import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { esperarVersaoDoSchema, SchemaAtrasadoError, versaoEsperada } from './versao-schema';

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
    expect(erro).toHaveBeenCalledWith({ migration: '0096_teste', erro: 'Error', sqlstate: '42883' }, expect.any(String));
    expect(JSON.stringify(erro.mock.calls)).not.toContain('mensagem do banco');
  });

  it('startWorker espera o schema ANTES de subir o pg-boss (nenhum consumidor nem agendamento antes)', () => {
    const src = readFileSync('src/worker/index.ts', 'utf8');
    const espera = src.indexOf('await esperarVersaoDoSchema(');
    expect(espera).toBeGreaterThan(-1);
    expect(espera).toBeLessThan(src.indexOf('new PgBoss('));
  });
});
