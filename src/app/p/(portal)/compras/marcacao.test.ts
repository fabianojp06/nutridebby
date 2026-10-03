import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alternarComprado, assinarCompras, chaveCompras, lerBruto, lerComprados } from './marcacao';

/** O teste roda em Node: window vira um EventTarget e o localStorage é trocado por caso. */
function armazenamento(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}
const bloqueado = (): Storage =>
  new Proxy({} as Storage, {
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('marcação "comprado" (RN-13, D15)', () => {
  it('com localStorage: grava por plano e avisa a tela', () => {
    const ls = armazenamento();
    vi.stubGlobal('localStorage', ls);
    const avisos = vi.fn();
    const sair = assinarCompras(avisos);
    const chave = chaveCompras('plano-a');
    alternarComprado(chave, 'Arroz');
    expect(ls.getItem(chave)).toBe('["Arroz"]');
    expect(lerComprados(lerBruto(chave))).toEqual(['Arroz']);
    expect(lerComprados(lerBruto(chaveCompras('plano-b')))).toEqual([]);
    alternarComprado(chave, 'Arroz');
    expect(lerComprados(lerBruto(chave))).toEqual([]);
    expect(avisos).toHaveBeenCalledTimes(2);
    sair();
  });

  it('sem armazenamento (dados de site bloqueados): a marcação vale enquanto a tela está aberta', () => {
    vi.stubGlobal('localStorage', bloqueado());
    const avisos = vi.fn();
    const sair = assinarCompras(avisos);
    const chave = chaveCompras('plano-bloqueado');
    expect(lerBruto(chave)).toBe('[]');
    alternarComprado(chave, 'Chuchu');
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(lerComprados(lerBruto(chave))).toEqual(['Chuchu']);
    alternarComprado(chave, 'Banana');
    expect(lerComprados(lerBruto(chave))).toEqual(['Chuchu', 'Banana']);
    alternarComprado(chave, 'Chuchu');
    expect(lerComprados(lerBruto(chave))).toEqual(['Banana']);
    sair();
  });

  it('leitura funciona mas a gravação é recusada (cota cheia): a memória responde até a gravação voltar', () => {
    const ls = armazenamento();
    const chave = chaveCompras('plano-cota');
    ls.setItem(chave, '["Ovo"]');
    const recusa = vi.spyOn(ls, 'setItem').mockImplementation(() => {
      throw new DOMException('cheio', 'QuotaExceededError');
    });
    vi.stubGlobal('localStorage', ls);
    alternarComprado(chave, 'Leite');
    expect(lerComprados(lerBruto(chave))).toEqual(['Ovo', 'Leite']);
    recusa.mockRestore();
    alternarComprado(chave, 'Ovo');
    expect(ls.getItem(chave)).toBe('["Leite"]');
    expect(lerComprados(lerBruto(chave))).toEqual(['Leite']);
  });

  it('valor estranho no aparelho vira lista vazia', () => {
    expect([lerComprados('x'), lerComprados('{"a":1}'), lerComprados('["a",2]')]).toEqual([[], [], ['a']]);
  });
});
