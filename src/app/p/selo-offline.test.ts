import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENTO_REDE_VOLTOU } from '../sw-regras';
import { REPETIR_PING_MS, vigiarRede } from './selo-offline';

// SUS-112: a cópia servida pelo NetworkFirst (rede lenta) chega com navigator.onLine verdadeiro e nunca recebe `online`.
// O selo repete o ping enquanto está fora e, quando ele volta, avisa (EVENTO_REDE_VOLTOU), e a cópia recarrega.
describe('SUS-112: vigiarRede (o ping do selo offline)', () => {
  afterEach(() => vi.useRealTimers());
  const montar = (o: { ping: boolean[]; online?: boolean }) => {
    const rede = { online: o.online ?? true, respostas: [...o.ping] };
    const mudou: boolean[] = [];
    const aoVoltar = vi.fn();
    const ping = vi.fn(async () => rede.respostas.shift() ?? true);
    const v = vigiarRede({ ping, online: () => rede.online, aoMudar: (f) => mudou.push(f), aoVoltar, relogio: globalThis });
    return { v, rede, mudou, aoVoltar, ping };
  };

  it('ping falhando com navigator.onLine verdadeiro: repete a cada 15 s e, quando volta, avisa uma vez', async () => {
    vi.useFakeTimers();
    const m = montar({ ping: [false, false, true] });
    await m.v.conferir();
    expect(m.mudou).toEqual([true]);
    expect(m.aoVoltar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REPETIR_PING_MS);
    expect(m.mudou).toEqual([true, true]);
    await vi.advanceTimersByTimeAsync(REPETIR_PING_MS);
    expect(m.mudou).toEqual([true, true, false]);
    expect(m.aoVoltar).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0); // dentro: o ping para de repetir
    expect(m.ping).toHaveBeenCalledTimes(3);
  });

  it('página que abriu com rede: nada a avisar (só de fora para dentro)', async () => {
    vi.useFakeTimers();
    const m = montar({ ping: [true, true] });
    await m.v.conferir();
    await m.v.conferir();
    expect(m.mudou).toEqual([false, false]);
    expect(m.aoVoltar).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('navigator.onLine falso: fora sem ping nem repetição (espera o `online`); o `online` com ping bom avisa', async () => {
    vi.useFakeTimers();
    const m = montar({ ping: [], online: false });
    await m.v.conferir();
    expect(m.ping).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    m.rede.online = true;
    await m.v.conferir();
    expect(m.mudou).toEqual([true, false]);
    expect(m.aoVoltar).toHaveBeenCalledTimes(1);
  });

  it('parar: sem repetição e sem aviso de uma conferência que ainda estava no ar', async () => {
    vi.useFakeTimers();
    const m = montar({ ping: [false] });
    await m.v.conferir();
    m.v.parar();
    expect(vi.getTimerCount()).toBe(0);
    const viva = m.v.conferir();
    m.v.parar();
    await viva;
    expect(m.mudou).toEqual([true]);
  });

  it('o selo dispara EVENTO_REDE_VOLTOU na window (o mesmo que recarregarCopiaAoVoltar ouve)', () => {
    const f = readFileSync('src/app/p/selo-offline.tsx', 'utf8');
    expect(f).toMatch(/aoVoltar: \(\) => window\.dispatchEvent\(new Event\(EVENTO_REDE_VOLTOU\)\)/);
    expect(EVENTO_REDE_VOLTOU).toBe('nd:rede-voltou');
  });
});
