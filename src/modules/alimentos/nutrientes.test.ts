import { describe, expect, it } from 'vitest';
import { formatarNutriente, MICRO_MAX, microsValidos, NUTRIENTES } from './nutrientes';
import { CAMPOS_MICRO } from './taco';

describe('RN-235: catálogo de nutrientes', () => {
  it('31 chaves únicas, com nome, unidade e casas', () => {
    const chaves = NUTRIENTES.map((n) => n.chave);
    expect(chaves).toHaveLength(31);
    expect(new Set(chaves).size).toBe(31);
    for (const n of NUTRIENTES) {
      expect(n.nome.length, n.chave).toBeGreaterThan(0);
      expect(['g', 'mg', 'mcg', '%']).toContain(n.unidade);
      expect(n.casas, n.chave).toBe(n.unidade === 'mcg' ? 0 : 1);
      expect(n.fontes.length, n.chave).toBeGreaterThan(0);
    }
  });

  it('as chaves da TACO são as CAMPOS_MICRO, na mesma ordem', () => {
    expect(NUTRIENTES.filter((n) => n.fontes.includes('taco')).map((n) => n.chave)).toEqual(CAMPOS_MICRO);
  });

  it('as 11 chaves novas vêm da USDA e não da TACO', () => {
    const novas = NUTRIENTES.filter((n) => !n.fontes.includes('taco')).map((n) => n.chave);
    expect(novas).toEqual([
      'vitamina_d_mcg',
      'vitamina_b12_mcg',
      'folato_dfe_mcg',
      'vitamina_e_mg',
      'vitamina_k_mcg',
      'selenio_mcg',
      'acucares_g',
      'gordura_saturada_g',
      'gordura_mono_g',
      'gordura_poli_g',
      'gordura_trans_g',
    ]);
    for (const k of novas) expect(NUTRIENTES.find((n) => n.chave === k)!.fontes).toContain('usda');
  });

  it('a unidade é o sufixo da chave', () => {
    for (const n of NUTRIENTES) expect(n.chave.endsWith(`_${n.unidade === '%' ? 'pct' : n.unidade}`), n.chave).toBe(true);
  });
});

describe('RN-235: exibição (vírgula decimal, µg)', () => {
  it('g e mg com 1 casa, mcg sem casa e com "µg", % com 1 casa', () => {
    expect(formatarNutriente('calcio_mg', 120)).toBe('120,0 mg');
    expect(formatarNutriente('fosforo_mg', 12.345)).toBe('12,3 mg');
    expect(formatarNutriente('gordura_saturada_g', 0.25)).toBe('0,3 g');
    expect(formatarNutriente('vitamina_b12_mcg', 2.4)).toBe('2 µg');
    expect(formatarNutriente('umidade_pct', 68.15)).toBe('68,2%');
  });
});

describe('microsValidos (foods.micros só com chaves do catálogo)', () => {
  it('aceita chaves do catálogo de 0 a 100000; null = sem valor (fica fora)', () => {
    expect(microsValidos({ calcio_mg: 120, sodio_mg: 0, ferro_mg: null })).toEqual({ ok: true, valor: { calcio_mg: 120, sodio_mg: 0 } });
    expect(microsValidos({})).toEqual({ ok: true, valor: {} });
    expect(microsValidos({ potassio_mg: MICRO_MAX })).toEqual({ ok: true, valor: { potassio_mg: 100000 } });
  });

  it('recusa negativo, acima do máximo, não número e chave fora do catálogo, dizendo a chave', () => {
    expect(microsValidos({ sodio_mg: -3 })).toEqual({ ok: false, chave: 'sodio_mg' });
    expect(microsValidos({ sodio_mg: 100000.1 })).toEqual({ ok: false, chave: 'sodio_mg' });
    expect(microsValidos({ calcio_mg: '120' })).toEqual({ ok: false, chave: 'calcio_mg' });
    expect(microsValidos({ calcio_mg: Number.NaN })).toEqual({ ok: false, chave: 'calcio_mg' });
    expect(microsValidos({ calcio_mg: 1, cafeina_mg: 10 })).toEqual({ ok: false, chave: 'cafeina_mg' });
    expect(microsValidos({ kcal: 10 })).toEqual({ ok: false, chave: 'kcal' });
  });

  it('recusa o que não é objeto', () => {
    for (const v of [null, undefined, 3, 'x', [1]]) expect(microsValidos(v).ok, String(v)).toBe(false);
  });
});
