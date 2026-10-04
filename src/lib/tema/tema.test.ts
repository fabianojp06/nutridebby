import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contraste, misturar } from './contraste';
import { corNoEscuro } from './marca-tema';
import { PARES, TOKENS, type Token } from './tokens';

describe('tokens do visual V2 (D24, RNF-10)', () => {
  it.each(PARES.flatMap((p) => [0, 1].map((m) => [p.texto, p.fundo, m === 0 ? 'claro' : 'escuro', p.minimo, m] as const)))(
    '%s sobre %s no modo %s: contraste ≥ %d',
    (texto, fundo, _modo, minimo, m) => {
      expect(contraste(TOKENS[texto as Token][m], TOKENS[fundo as Token][m])).toBeGreaterThanOrEqual(minimo);
    },
  );
  it('o globals.css tem cada token com os mesmos valores nos três blocos (fonte única: tokens.ts), sem light-dark()', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    // RNF-09: Safari < 17.5 não tem light-dark() — a variável ficaria inválida e o foco/as cores sumiriam no iOS 16.4–17.4
    expect(css).not.toContain('light-dark(');
    const bloco = (inicio: string) => {
      const i = css.indexOf(inicio);
      expect(i, inicio).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf('}', i));
    };
    const claro = bloco(':root {');
    const escuro = bloco("[data-tema='escuro'] {");
    const sistemaEscuro = bloco("@media (prefers-color-scheme: dark) {");
    for (const [nome, [c, e]] of Object.entries(TOKENS)) {
      expect(claro, `${nome} claro`).toContain(`--nd-${nome}: ${c};`);
      expect(escuro, `${nome} escuro`).toContain(`--nd-${nome}: ${e};`);
      expect(sistemaEscuro, `${nome} aparelho escuro`).toContain(`--nd-${nome}: ${e};`);
    }
    expect(css).toMatch(/:focus-visible \{\s*outline: 3px solid var\(--nd-foco, #[0-9a-f]{6}\);/);
  });
});

/** PRNG com semente: o teste de propriedade é reproduzível. */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('cor do consultório nos dois modos (D19, §3.4 da pesquisa)', () => {
  const rnd = mulberry32(2026);
  const cores = Array.from({ length: 3000 }, () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`).filter((c) => contraste(c, '#ffffff') >= 4.5);
  it('há cores suficientes no teste', () => expect(cores.length).toBeGreaterThan(500));
  it('toda cor aceita pelo perfil (≥ 4,5 com branco) vira, no escuro, texto ≥ 4,5 sobre o cartão e o fundo', () => {
    for (const c of cores) {
      const e = corNoEscuro(c);
      expect(contraste(e, TOKENS.cartao[1]), `${c} → ${e}`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(e, TOKENS.fundo[1]), `${c} → ${e}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('texto branco sobre a caixa com a sobreposição escura (15% de preto) do cartão de destaque continua ≥ 4,5', () => {
    for (const c of cores) expect(contraste('#ffffff', misturar(c, '#000000', 0.15))).toBeGreaterThanOrEqual(4.5);
  });
  it('as cores conferidas na pesquisa', () => {
    expect(contraste(corNoEscuro('#047857'), TOKENS.cartao[1])).toBeGreaterThanOrEqual(4.5);
    expect(contraste(corNoEscuro('#1d6b5a'), TOKENS.cartao[1])).toBeGreaterThanOrEqual(4.5);
  });
});
