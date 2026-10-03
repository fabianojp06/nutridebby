import { describe, expect, it } from 'vitest';
import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from './corpo';

/** Corpo que manda um pedaço e depois não manda mais nada (cliente lento ou de propósito devagar). */
function corpoParado() {
  let cancelado = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(10));
    },
    cancel() {
      cancelado = true;
    },
  });
  return { req: new Request('http://localhost/x', { method: 'POST', body, duplex: 'half' } as RequestInit), cancelado: () => cancelado };
}

describe('lerCorpoLimitado', () => {
  it('lê o corpo inteiro dentro do limite e do prazo', async () => {
    const req = new Request('http://localhost/x', { method: 'POST', body: 'abc' });
    expect((await lerCorpoLimitado(req, 10, { prazoMs: 1_000 })).toString()).toBe('abc');
  });

  it('acima do limite → CorpoGrandeError', async () => {
    await expect(lerCorpoLimitado(new Request('http://localhost/x', { method: 'POST', body: 'x'.repeat(11) }), 10)).rejects.toBeInstanceOf(CorpoGrandeError);
  });

  it('corpo que não termina dentro do prazo → CorpoLentoError e o leitor é cancelado (a vaga não fica presa)', async () => {
    const c = corpoParado();
    const inicio = Date.now();
    await expect(lerCorpoLimitado(c.req, 1_000, { prazoMs: 50 })).rejects.toBeInstanceOf(CorpoLentoError);
    expect(Date.now() - inicio).toBeLessThan(1_000);
    expect(c.cancelado()).toBe(true);
  });
});
