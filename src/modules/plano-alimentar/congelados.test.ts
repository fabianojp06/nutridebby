import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerCongelados } from './congelados';

const MACROS = { kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 };

describe('RN-237: lerCongelados (único leitor de meal_items.nutrientes)', () => {
  it('formato antigo (antes do Plano 19): fonte sai de origem, sem micros', () => {
    expect(lerCongelados({ nome: 'Arroz, tipo 1, cozido', origem: 'TACO', ...MACROS })).toEqual({
      nome: 'Arroz, tipo 1, cozido',
      fonte: 'taco',
      fonteVersao: null,
      fonteOrigem: null,
      ...MACROS,
      micros: null,
    });
    expect(lerCongelados({ nome: 'Pão da casa', origem: 'Meu alimento', kcal: 250, proteinaG: 8, carboidratoG: 50, lipidioG: 2, fibraG: 0 })).toMatchObject({
      fonte: 'propria',
      fonteOrigem: null,
      micros: null,
    });
  });

  it('formato antigo com valor sem registro na TACO (null) continua null', () => {
    expect(lerCongelados({ nome: 'Sal', origem: 'TACO', kcal: null, proteinaG: null, carboidratoG: null, lipidioG: null, fibraG: null })).toMatchObject({
      kcal: null,
      proteinaG: null,
      micros: null,
    });
  });

  it('formato novo: fonte, versão, fonte de origem e micros', () => {
    const n = {
      nome: 'Feijão cozido (meu)',
      origem: 'Meu alimento',
      fonte: 'propria',
      fonteVersao: null,
      fonteOrigem: 'usda',
      ...MACROS,
      micros: { ferro_mg: 1.3, calcio_mg: null, sodio_mg: 2 },
    };
    expect(lerCongelados(n)).toEqual({ nome: n.nome, fonte: 'propria', fonteVersao: null, fonteOrigem: 'usda', ...MACROS, micros: { ferro_mg: 1.3, calcio_mg: null, sodio_mg: 2 } });
    expect(lerCongelados({ nome: 'Arroz', origem: 'TACO', fonte: 'taco', fonteVersao: '4ª ed., 2011', fonteOrigem: null, ...MACROS, micros: {} })).toMatchObject({
      fonte: 'taco',
      fonteVersao: '4ª ed., 2011',
      micros: {},
    });
  });

  it('a fonte gravada vale mais que a origem (USDA tem origem "TACO" para os leitores antigos)', () => {
    expect(lerCongelados({ nome: 'Apple, raw', origem: 'TACO', fonte: 'usda', fonteVersao: 'FDC 2025', fonteOrigem: null, ...MACROS, micros: null }).fonte).toBe('usda');
  });

  it('tolerante: chave fora do catálogo e valor que não é número saem dos micros; fonte/fonteOrigem inválidas caem no formato antigo/nulo', () => {
    const r = lerCongelados({ nome: 'X', origem: 'TACO', fonte: 'xyz', fonteOrigem: 'abc', ...MACROS, micros: { ferro_mg: 'muito', cafeina_mg: 3, zinco_mg: 0.5 } });
    expect(r.fonte).toBe('taco');
    expect(r.fonteOrigem).toBeNull();
    expect(r.micros).toEqual({ zinco_mg: 0.5 });
  });

  it('recusa o que não é objeto (o chamador trata o item sem congelado antes)', () => {
    expect(() => lerCongelados(null)).toThrow();
    expect(() => lerCongelados('x')).toThrow();
  });
});

/**
 * Guarda da Tarefa 10d (RN-237, R-235): `lerCongelados` é o único leitor de `meal_items.nutrientes`. Teste de fonte, sem
 * os comentários: o formato gravado (`NutrientesCongelados`) só aparece em quem o define, grava e lê; quem lê a coluna
 * direto está na lista e importa `lerCongelados`. O PDF do plano e o contexto da IA Nutri leem o plano publicado por
 * `lerPlanoNaTransacao` (`carregar.ts`), que já passa por `lerCongelados`: não leem a coluna.
 */
describe('guarda dos congelados (RN-237): lerCongelados é o único leitor de meal_items.nutrientes', () => {
  const RAIZ = path.resolve('src');
  const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const fontes = new Map(
    readdirSync(RAIZ, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
      .map((d) => {
        const f = path.join(d.parentPath, d.name);
        return [path.relative(path.resolve('.'), f), semComentarios(readFileSync(f, 'utf8'))] as const;
      }),
  );
  /** Quem grava: o schema (tipo da coluna), a publicação (UPDATE … FROM foods) e o próprio leitor. */
  const GRAVAM = ['src/db/schema/plano-alimentar.ts', 'src/modules/plano-alimentar/publicacao.ts', 'src/modules/plano-alimentar/congelados.ts'];
  /** Leem `meal_items.nutrientes` direto, sempre por `lerCongelados`. */
  const LEITORES = ['src/modules/plano-alimentar/carregar.ts', 'src/modules/portal/lista-compras.ts', 'src/modules/pacientes/exportacao-job.ts', 'src/modules/ia/resumo-dados.ts'];

  it('a busca enxerga o código (sanidade)', () => {
    expect(fontes.size).toBeGreaterThan(100);
    for (const f of [...GRAVAM, ...LEITORES]) expect(fontes.has(f), f).toBe(true);
  });

  it('NutrientesCongelados só aparece no schema, na publicação e em congelados.ts', () => {
    const usam = [...fontes].filter(([, c]) => /\bNutrientesCongelados\b/.test(c)).map(([f]) => f);
    expect(usam.filter((f) => !GRAVAM.includes(f))).toEqual([]);
  });

  it('quem lê `.nutrientes` de meal_items é um leitor conhecido, e todo leitor importa lerCongelados', () => {
    const leem = [...fontes].filter(([, c]) => /\b(mealItems|meal_items)\b/.test(c) && /\.nutrientes\b/.test(c)).map(([f]) => f);
    expect(leem.filter((f) => !LEITORES.includes(f) && !GRAVAM.includes(f))).toEqual([]);
    const importa = /import\s*\{[^}]*\blerCongelados\b[^}]*\}\s*from\s*'(?:@\/modules\/plano-alimentar|\.)\/congelados'/;
    for (const f of LEITORES) expect(fontes.get(f), f).toMatch(importa);
  });
});
