import { beforeEach, describe, expect, it } from 'vitest';
import { DISPENSA_MS, dispensado, dispensar, esquecerCartoesDoAparelho } from './cartoes-dispensados';

// localStorage do navegador, simulado (o ambiente dos testes é o Node)
const mapa = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return mapa.size;
    },
    key: (i: number) => [...mapa.keys()][i] ?? null,
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
  },
});

describe('cartões do aparelho dispensados (RN-201)', () => {
  beforeEach(() => mapa.clear());
  it('"Agora não" esconde por 30 dias, por conta (outra conta no aparelho vê o cartão)', () => {
    const t0 = Date.UTC(2026, 9, 8);
    dispensar('conta-a', 'notificacoes', t0);
    expect(dispensado('conta-a', 'notificacoes', t0 + DISPENSA_MS - 1)).toBe(true);
    expect(dispensado('conta-a', 'notificacoes', t0 + DISPENSA_MS)).toBe(false);
    expect(dispensado('conta-b', 'notificacoes', t0)).toBe(false);
    expect(dispensado('conta-a', 'instalar', t0)).toBe(false);
  });
  it('o "Sair" e o /entrar apagam as dispensas (e nada mais do aparelho)', () => {
    dispensar('conta-a', 'instalar');
    mapa.set('nd-compras:p1', '[]');
    esquecerCartoesDoAparelho();
    expect([...mapa.keys()]).toEqual(['nd-compras:p1']);
  });
  it('sem armazenamento (navegação privada que recusa), nada quebra: o cartão aparece', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('bloqueado'); } });
    expect(dispensado('conta-a', 'instalar')).toBe(false);
    expect(() => dispensar('conta-a', 'instalar')).not.toThrow();
    expect(() => esquecerCartoesDoAparelho()).not.toThrow();
  });
});
