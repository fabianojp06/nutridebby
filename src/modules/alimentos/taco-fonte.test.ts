import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerAba } from '../../../scripts/seeds/planilhas';
import { GRUPOS_TACO } from './grupos';
import { converterTaco, paraCsvTaco, sqlSeedTaco, TACO_FONTE } from './taco';

describe('seed da TACO fiel à planilha oficial (INT-04, D3)', () => {
  const xls = readFileSync(TACO_FONTE.arquivo);
  const registros = converterTaco(lerAba(xls, TACO_FONTE.aba));

  it('a planilha é a esperada (sha256) e tem 597 alimentos nos 15 grupos, numerados de 1 a 597', () => {
    expect(createHash('sha256').update(xls).digest('hex')).toBe(TACO_FONTE.sha256);
    expect(registros).toHaveLength(597);
    expect(registros.every((r, i) => r.tacoId === i + 1)).toBe(true);
    expect([...new Set(registros.map((r) => r.grupo))]).toEqual([...GRUPOS_TACO]);
  });

  it('valores conferidos no PDF da TACO', () => {
    const por = (id: number) => registros.find((r) => r.tacoId === id)!;
    expect(por(3)).toMatchObject({ nome: 'Arroz, tipo 1, cozido', kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 });
    expect(por(561)).toMatchObject({ nome: 'Feijão, carioca, cozido', grupo: 'Leguminosas e derivados', kcal: 76, proteinaG: 4.8, carboidratoG: 13.6, lipidioG: 0.5, fibraG: 8.5 });
    expect(por(458)).toMatchObject({ nome: 'Leite, de vaca, integral', kcal: null }); // "*" — em reavaliação
    expect(por(260)).toMatchObject({ nome: 'Azeite, de oliva, extra virgem', kcal: 884, proteinaG: null, lipidioG: 100 }); // "NA"
    expect(por(42)).toMatchObject({ nome: 'Milho, amido, cru', lipidioG: 0 }); // "Tr"
    expect(por(373).micros.piridoxina_mg).toBe(0.02);
  });

  it('seeds/taco-4ed.csv e a migration de seed são exatamente o que o script gera (rode `pnpm seed:taco`)', () => {
    expect(readFileSync(TACO_FONTE.csv, 'utf8')).toBe(paraCsvTaco(registros));
    expect(readFileSync(TACO_FONTE.migration, 'utf8')).toBe(sqlSeedTaco(registros));
  });
});
