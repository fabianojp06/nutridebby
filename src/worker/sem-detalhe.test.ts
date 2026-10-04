import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { getBoss, stopBoss } from '@/jobs/boss';
import { capturarErro } from '@/lib/sentry';
import { erroSemDetalhe, semDetalhe, workSemDetalhe } from './sem-detalhe';

vi.mock('@/lib/sentry', () => ({ capturarErro: vi.fn() }));

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

const CAMINHO = '/data/3f1c0e2a-0000-4000-8000-000000000001/diario/foto.heic';
/** Um erro de disco como o do Node: a mensagem e a propriedade `path` levam o caminho (com o id do tenant). */
const erroDeDisco = () => Object.assign(new Error(`ENOENT: no such file or directory, open '${CAMINHO}'`), { code: 'ENOENT', errno: -2, syscall: 'open', path: CAMINHO });
/** O que o pg-boss guarda no output do job (serialize-error: message, stack e as propriedades próprias). */
const serializado = (e: unknown) => JSON.stringify(e, Object.getOwnPropertyNames(e));

describe('erro relançado ao pg-boss sem detalhe (RNF-11, regra 3 — achado 5 do /code-review)', () => {
  it('só a fila e o código (ou o nome da classe); nada da mensagem, do caminho, da pilha nem das propriedades', () => {
    const e = erroSemDetalhe('diario-foto', erroDeDisco());
    expect(e.message).toBe('falha no job diario-foto (ENOENT)');
    expect(serializado(e)).not.toContain('/data/');
    expect(serializado(e)).not.toContain('3f1c0e2a');
    class FalhaDoSmtpError extends Error {
      override name = 'FalhaDoSmtpError';
    }
    expect(erroSemDetalhe('email', new FalhaDoSmtpError('550 caixa ana@exemplo.com não existe')).message).toBe('falha no job email (FalhaDoSmtpError)');
    expect(erroSemDetalhe('email', 'texto solto com ana@exemplo.com').message).toBe('falha no job email (erro)');
    const nomeEstranho = Object.assign(new Error('x'), { name: 'ana@exemplo.com' });
    expect(erroSemDetalhe('email', nomeEstranho).message).toBe('falha no job email (erro)');
  });

  it('semDetalhe: o resultado passa igual; o erro sai limpo', async () => {
    expect(await semDetalhe('x', async (a: number, b: number) => a + b)(1, 2)).toBe(3);
    await expect(semDetalhe('x', async () => Promise.reject(erroDeDisco()))()).rejects.toThrow(/^falha no job x \(ENOENT\)$/);
  });

  it('P08-01: o erro original vai para capturarErro com a fila e o motivo (o filtro do Sentry tira a mensagem)', async () => {
    vi.mocked(capturarErro).mockClear();
    const original = erroDeDisco();
    await expect(semDetalhe('email', async () => Promise.reject(original))()).rejects.toThrow(/^falha no job email \(ENOENT\)$/);
    expect(capturarErro).toHaveBeenCalledTimes(1);
    expect(capturarErro).toHaveBeenCalledWith(expect.any(Error), { fila: 'email', motivo: 'ENOENT' });
    expect(vi.mocked(capturarErro).mock.calls[0]![0]).toBe(original);
    expect(await semDetalhe('email', async () => 1)()).toBe(1);
    expect(capturarErro).toHaveBeenCalledTimes(1); // sucesso não captura nada
  });

  it('pelo pg-boss de verdade: o output do job que falhou não leva o caminho', async () => {
    const boss = await getBoss();
    const fila = `teste-sem-detalhe-${randomUUID()}`;
    await boss.createQueue(fila, { retryLimit: 0 });
    try {
      await workSemDetalhe(boss)(fila, { pollingIntervalSeconds: 0.5 }, async () => {
        throw erroDeDisco();
      });
      const id = (await boss.send(fila, {}))!;
      let job = await boss.getJobById(fila, id);
      for (let i = 0; i < 60 && job?.state !== 'failed'; i++) {
        await new Promise((r) => setTimeout(r, 250));
        job = await boss.getJobById(fila, id);
      }
      expect(job?.state).toBe('failed');
      const output = JSON.stringify(job?.output);
      expect(output).toContain('falha no job');
      expect(output).toContain('ENOENT');
      expect(output).not.toContain('/data/');
      expect(output).not.toContain('3f1c0e2a');
    } finally {
      await boss.offWork(fila);
      await boss.deleteQueue(fila);
    }
  });

  it('guarda: o worker registra todo job por workSemDetalhe — nenhum `boss.work(` direto em src/worker/index.ts', () => {
    const fonte = readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(fonte).toContain('workSemDetalhe(boss)');
    expect(fonte).not.toMatch(/\bboss\s*\.\s*work\s*[<(]/);
    expect(fonte.match(/\bawait work\s*[<(]/g)?.length).toBeGreaterThanOrEqual(17);
  });
});
