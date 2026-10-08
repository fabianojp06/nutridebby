import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COR_PADRAO } from '@/modules/plataforma/marca-constantes';
import { contraste, luminancia, misturar } from './contraste';
import { corDaFaixa, corNoEscuro, OPACIDADE_CARTAO_FAIXA, VERDE_CLARO_PORTAL } from './marca-tema';
import { PARES, PARES_PORTAL, TOKENS, TOKENS_PORTAL, type Token } from './tokens';

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
  it('na impressão (manual, D26) todo contêiner volta aos tokens claros, depois dos blocos escuros', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const i = css.indexOf('@media print {');
    expect(i).toBeGreaterThan(css.indexOf('@media (prefers-color-scheme: dark) {'));
    expect(i).toBeGreaterThan(css.indexOf("[data-tema='escuro'] {"));
    const impressao = css.slice(i, css.indexOf('}', i));
    expect(impressao).toContain('[data-tema] {');
    expect(impressao).toContain('color-scheme: light;');
    for (const [nome, [c]] of Object.entries(TOKENS)) expect(impressao, `${nome} na impressão`).toContain(`--nd-${nome}: ${c};`);
    expect(readFileSync('src/app/painel/cabecalho.tsx', 'utf8')).toMatch(/<header className="[^"]*\bprint:hidden\b/);
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
  it('botão na cor do consultório (bg-destaque text-white) não usa outline-current: o contorno fica fora, sobre o cartão branco', () => {
    // revisão final do Plano 12: o "Continuar conectada" do aviso de sessão tinha foco branco sobre o diálogo branco
    // (modo claro, e sempre no admin). O foco global (--nd-foco) tem ≥ 3:1 contra o cartão nos dois modos.
    const fontes = (readdirSync('src', { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    const classes = fontes.flatMap((f) =>
      [...readFileSync(join('src', f), 'utf8').matchAll(/(?:className=|['"`])([^'"`]*\bbg-destaque\b[^'"`]*)/g)].map((m) => `${f}: ${m[1]}`),
    );
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((c) => /\boutline-current\b/.test(c))).toEqual([]);
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
  it('o cabeçalho do painel (T14) é neutro: sem fundo da cor do consultório, o foco na cor da marca aparece nele sem o atributo', () => {
    const cabecalho = readFileSync('src/app/painel/cabecalho.tsx', 'utf8');
    expect(cabecalho).toMatch(/<header className="[^"]*\bbg-cartao\b/);
    expect(cabecalho).not.toMatch(/backgroundColor|data-sobre-marca/);
    // o item ativo do menu (bg-destaque) desenha o contorno do lado de fora (outline-offset), sobre o cartão
    for (const c of [...cores, COR_PADRAO]) {
      expect(contraste(c, TOKENS.cartao[0]), c).toBeGreaterThanOrEqual(3);
      expect(contraste(corNoEscuro(c), TOKENS.cartao[1]), c).toBeGreaterThanOrEqual(3);
    }
  });
  it('o fundo além do conteúdo (efeito elástico) no painel escuro é o token fundo, nos dois blocos', () => {
    expect(css).toContain(`:root:has([data-tema='escuro']) { background: ${TOKENS.fundo[1]}; }`);
    expect(css).toContain(`:root:has([data-tema='sistema']) { background: ${TOKENS.fundo[1]}; }`);
  });
});

describe('portal do paciente: tokens novos e a cor da faixa (Plano 16, §4.7, RNF-192)', () => {
  const todos: Record<string, readonly [string, string]> = { ...TOKENS, ...TOKENS_PORTAL };
  it.each(PARES_PORTAL.flatMap((p) => [0, 1].map((m) => [p.texto, p.fundo, m === 0 ? 'claro' : 'escuro', p.minimo, m] as const)))(
    '%s sobre %s no modo %s: contraste ≥ %d',
    (texto, fundo, _modo, minimo, m) => {
      expect(contraste(todos[texto][m], todos[fundo][m])).toBeGreaterThanOrEqual(minimo);
    },
  );

  it('o marco âmbar sozinho some contra o fundo claro (1,55:1): por isso leva contorno de 2 px no token do texto (WCAG 1.4.11)', () => {
    expect(contraste(TOKENS_PORTAL['p-marco'][0], TOKENS.fundo[0])).toBeLessThan(3);
    expect(contraste(TOKENS_PORTAL['p-marco-texto'][0], TOKENS.fundo[0])).toBeGreaterThanOrEqual(3);
    expect(contraste(TOKENS.texto[1], TOKENS.fundo[1])).toBeGreaterThanOrEqual(3);
  });

  it('o globals.css declara os tokens do portal só em [data-app=paciente] (o painel não muda, C-193), claro e com o aparelho escuro', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const bloco = (inicio: string) => {
      const i = css.indexOf(inicio);
      expect(i, inicio).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf('}', i));
    };
    const claro = bloco("[data-app='paciente'] {");
    const escuro = bloco("[data-app='paciente'][data-tema='sistema'] {");
    for (const [nome, [c, e]] of Object.entries(TOKENS_PORTAL)) {
      expect(claro, `${nome} claro`).toContain(`--nd-${nome}: ${c};`);
      expect(escuro, `${nome} escuro`).toContain(`--nd-${nome}: ${e};`);
    }
    // o bloco escuro fica dentro do @media do aparelho escuro (o portal segue o aparelho, P08 D18): o @media que o abre vem
    // depois do bloco claro e nada fecha entre ele e o bloco
    const iEscuro = css.indexOf("[data-app='paciente'][data-tema='sistema'] {");
    const iMedia = css.lastIndexOf('@media (prefers-color-scheme: dark) {', iEscuro);
    expect(iMedia).toBeGreaterThan(css.indexOf("[data-app='paciente'] {"));
    expect(css.slice(iMedia, iEscuro)).not.toContain('}');
    expect(css).toContain(`--color-faixa-cartao: rgb(226 239 233 / ${OPACIDADE_CARTAO_FAIXA});`);
    expect(VERDE_CLARO_PORTAL).toBe(TOKENS_PORTAL['p-clara'][0]);
  });

  it('corDaFaixa: a cor padrão não muda; a cor no limite (#767676, 4,54:1) escurece até o branco passar também no cartão translúcido', () => {
    expect(corDaFaixa(COR_PADRAO)).toBe(COR_PADRAO);
    // o problema que a spec mediu: branco sobre o cartão (verde claro a 16%) da cor no limite = 3,52:1
    expect(contraste('#ffffff', misturar('#767676', VERDE_CLARO_PORTAL, OPACIDADE_CARTAO_FAIXA))).toBeLessThan(4.5);
    const c = corDaFaixa('#767676');
    expect(c).not.toBe('#767676');
    expect(contraste('#ffffff', misturar(c, VERDE_CLARO_PORTAL, OPACIDADE_CARTAO_FAIXA))).toBeGreaterThanOrEqual(4.5);
  });

  const rnd = mulberry32(2026);
  const aceitas = Array.from({ length: 3000 }, () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`).filter((c) => contraste(c, '#ffffff') >= 4.5);
  it('propriedade: para toda cor aceita pelo perfil (≥ 4,5 com o branco), o branco passa na faixa e no cartão, a pílula (cor da faixa sobre branco) passa, e a cor só escurece', () => {
    expect(aceitas.length).toBeGreaterThan(500);
    for (const c of [...aceitas, COR_PADRAO]) {
      const f = corDaFaixa(c);
      expect(contraste('#ffffff', f), `${c} → ${f}`).toBeGreaterThanOrEqual(4.5);
      expect(contraste('#ffffff', misturar(f, VERDE_CLARO_PORTAL, OPACIDADE_CARTAO_FAIXA)), `${c} → ${f} (cartão)`).toBeGreaterThanOrEqual(4.5);
      // no aparelho escuro o cartão usa o mesmo verde claro a 16% (a cor da faixa não muda com o modo): mesma conta
      expect(luminancia(f)).toBeLessThanOrEqual(luminancia(c) + 1e-9);
    }
  });
});
