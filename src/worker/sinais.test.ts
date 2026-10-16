import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { CODIGO_DE_SAIDA, rodarComSinais } from './sinais';

afterEach(() => vi.restoreAllMocks());

/** Promessa controlada pelo teste. */
function adiada<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

function cenario() {
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  const ouvintes = new Map<string, () => void>();
  const ordem: string[] = [];
  const saida = adiada<number>();
  const inicio = adiada<() => Promise<void>>();
  let sinalRecebido: AbortSignal | undefined;
  const deps = {
    ouvir: vi.fn((s: 'SIGTERM' | 'SIGINT', fn: () => void) => { ordem.push(`ouvir ${s}`); ouvintes.set(s, fn); }),
    iniciar: vi.fn((sinal: AbortSignal) => { ordem.push('iniciar'); sinalRecebido = sinal; return inicio.promessa; }),
    fechar: vi.fn(async () => { ordem.push('fechar'); }),
    sair: vi.fn((codigo: number) => { ordem.push(`sair ${codigo}`); saida.resolver(codigo); }),
  };
  return { deps, ouvintes, ordem, saida, inicio, sinal: () => sinalRecebido! };
}

describe('rodarComSinais (code review do PR #22, item 4: node como PID 1 ignora SIGTERM sem ouvinte)', () => {
  it('registra SIGTERM e SIGINT ANTES de iniciar (a espera pelo schema já pode receber o sinal)', async () => {
    const c = cenario();
    void rodarComSinais(c.deps);
    expect(c.ordem).toEqual(['ouvir SIGTERM', 'ouvir SIGINT', 'iniciar']);
  });

  it('SIGTERM durante a espera: cancela a inicialização pelo sinal, fecha banco/Sentry e sai com 143 (sem o grace period do Swarm)', async () => {
    const c = cenario();
    const rodando = rodarComSinais(c.deps);
    c.ouvintes.get('SIGTERM')!();
    expect(c.sinal().aborted).toBe(true);
    expect(c.deps.sair).not.toHaveBeenCalled(); // espera a inicialização desistir antes de sair
    c.inicio.rejeitar(new Error('espera cancelada'));
    expect(await c.saida.promessa).toBe(143);
    expect(c.ordem.slice(-2)).toEqual(['fechar', 'sair 143']);
    await rodando;
  });

  it('SIGTERM com o worker no ar: para o pg-boss (o `parar` de startWorker) e sai com 143; um segundo sinal não para de novo nem muda o código', async () => {
    const c = cenario();
    const parar = vi.fn(async () => undefined);
    const rodando = rodarComSinais(c.deps);
    c.inicio.resolver(parar);
    await rodando;
    c.ouvintes.get('SIGTERM')!();
    c.ouvintes.get('SIGINT')!();
    expect(await c.saida.promessa).toBe(143);
    expect(c.deps.sair).toHaveBeenCalledTimes(1);
    expect(parar).toHaveBeenCalledTimes(1);
    expect(c.deps.fechar).not.toHaveBeenCalled();
  });

  it('P15-05: nunca sai com 0 por sinal — com `restart: on-failure`, saída 0 deixava o worker parado (14/10 e 15/10)', async () => {
    expect(CODIGO_DE_SAIDA).toEqual({ SIGTERM: 143, SIGINT: 130 });
    const c = cenario();
    const rodando = rodarComSinais(c.deps);
    c.inicio.resolver(vi.fn(async () => undefined));
    await rodando;
    c.ouvintes.get('SIGINT')!();
    expect(await c.saida.promessa).toBe(130);
  });

  it('falha na inicialização sem sinal: o erro sobe (o processo sai com erro e o Swarm o reinicia)', async () => {
    const c = cenario();
    const rodando = rodarComSinais(c.deps);
    const falha = new Error('schema atrasado');
    c.inicio.rejeitar(falha);
    await expect(rodando).rejects.toBe(falha);
    expect(c.deps.sair).not.toHaveBeenCalled();
  });
});
