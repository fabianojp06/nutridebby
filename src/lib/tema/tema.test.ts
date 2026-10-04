import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COR_PADRAO } from '@/modules/plataforma/marca-constantes';
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
  it('o foco global fica na camada base: um focus-visible:outline-* local (ex.: o BotaoSair) vence', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toMatch(/@layer base \{\s*(\/\*[^*]*\*\/\s*)?:focus-visible \{/);
  });
  it('nenhuma tela apaga o contorno do foco (com o foco na camada base, outline-none/hidden/0 venceria)', () => {
    const fontes = (readdirSync('src', { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(fontes.length).toBeGreaterThan(100);
    const apagam = fontes.filter((f) => /\boutline-(none|hidden|0)\b/.test(readFileSync(join('src', f), 'utf8')));
    expect(apagam).toEqual([]);
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

describe('foco sobre a cor do consultório (cabeçalho do painel, cartão de destaque; WCAG 2.4.7/1.4.11)', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const i = css.indexOf('[data-sobre-marca] {');
  const regra = i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  const foco = /--nd-foco: (#[0-9a-f]{6});/.exec(regra)?.[1];
  const rnd = mulberry32(2026);
  const cores = Array.from({ length: 3000 }, () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`).filter((c) => contraste(c, '#ffffff') >= 4.5);

  it('sem a troca, o foco some sobre a cor do consultório (por isso o atributo)', () => {
    // claro: --nd-foco é a própria cor (1:1); escuro: corNoEscuro(cor) contra a cor original fica abaixo de 3:1
    expect(contraste(corNoEscuro(COR_PADRAO), COR_PADRAO)).toBeLessThan(3);
  });
  it('[data-sobre-marca] troca o --nd-foco por uma cor literal, depois dos blocos de tema (vence no mesmo elemento)', () => {
    expect(foco).toBeDefined();
    expect(i).toBeGreaterThan(css.indexOf('@media (prefers-color-scheme: dark) {'));
    expect(i).toBeGreaterThan(css.indexOf("[data-tema='escuro'] {"));
  });
  it('esse foco tem ≥ 3:1 contra toda cor aceita pelo perfil e contra a caixa escura de dentro do destaque, nos dois modos', () => {
    // o destaque (bg-destaque) e o cabeçalho usam sempre a cor original, no claro e no escuro
    expect(cores.length).toBeGreaterThan(500);
    for (const c of [...cores, COR_PADRAO]) {
      expect(contraste(foco ?? c, c), c).toBeGreaterThanOrEqual(3);
      expect(contraste(foco ?? c, misturar(c, '#000000', 0.15)), c).toBeGreaterThanOrEqual(3);
    }
  });
  it('o cabeçalho do painel (fundo da cor do consultório) põe o atributo', () => {
    expect(readFileSync('src/app/painel/cabecalho.tsx', 'utf8')).toMatch(/<header data-sobre-marca /);
  });
});
