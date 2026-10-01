import { describe, expect, it } from 'vitest';
import { converterTaco, idTaco, paraCsvTaco, sqlSeedTaco } from './taco';

// Linhas no formato da aba "CMVCol taco3": 3 de cabeçalho, linha de grupo (só a 1ª célula), linhas de alimento, "Legenda"
const vazio = (n: number) => Array.from({ length: n }, () => '');
const alimento = (id: number, nome: string, valores: Record<number, string>) => {
  const l: string[] = [String(id), nome, ...vazio(27)];
  for (const [i, v] of Object.entries(valores)) l[Number(i)] = v;
  l[13] = String(id); // a planilha repete o número na coluna 13
  return l;
};
const linhas = [
  vazio(29),
  ['Número do', '', 'Umidade', 'Energia', ...vazio(25)],
  ['Alimento', 'Descrição dos alimentos', '(%)', '(kcal)', ...vazio(25)],
  ['Cereais e derivados', ...vazio(28)],
  alimento(1, 'Arroz,  integral, cozido ', { 2: '70.1', 3: '124', 5: '2.6', 6: '1.0', 7: 'NA', 8: '25.8', 9: '2.7', 24: 'Tr' }),
  ['Leite e derivados', ...vazio(28)],
  alimento(458, 'Leite, de vaca, integral', { 3: '*', 5: '*', 6: '*', 8: '*', 9: '*' }),
  alimento(373, 'Carne, bovina, paleta, com gordura, crua', { 3: '159', 5: '21.4', 6: '7.5', 8: '0.0', 26: ',0,02' }),
  ['Legenda', ...vazio(28)],
  ['*', 'as análises estão sendo reavaliadas', ...vazio(27)],
];

describe('conversor da TACO (INT-04)', () => {
  const r = converterTaco(linhas);

  it('lê grupo de cada alimento, limpa espaços do nome e para na legenda', () => {
    expect(r.map((x) => [x.tacoId, x.nome, x.grupo])).toEqual([
      [1, 'Arroz, integral, cozido', 'Cereais e derivados'],
      [458, 'Leite, de vaca, integral', 'Leite e derivados'],
      [373, 'Carne, bovina, paleta, com gordura, crua', 'Leite e derivados'],
    ]);
  });

  it('"Tr" vira 0; "NA", "*" e vazio viram null', () => {
    expect(r[0]).toMatchObject({ kcal: 124, proteinaG: 2.6, lipidioG: 1, carboidratoG: 25.8, fibraG: 2.7 });
    expect(r[0].micros).toMatchObject({ umidade_pct: 70.1, colesterol_mg: null, tiamina_mg: 0, sodio_mg: null });
    expect(r[1]).toMatchObject({ kcal: null, proteinaG: null, lipidioG: null, carboidratoG: null, fibraG: null });
  });

  it('corrige a célula com erro de digitação da planilha (alimento 373, piridoxina ",0,02")', () => {
    expect(r[2].micros.piridoxina_mg).toBe(0.02);
  });

  it('valor inesperado na planilha é erro, não número inventado', () => {
    const ruim = [['Cereais e derivados', ...vazio(28)], alimento(2, 'X', { 3: '12,5' })];
    expect(() => converterTaco(ruim)).toThrow('Valor inesperado na TACO: alimento 2, coluna 3');
  });

  it('id determinístico (D2) e CSV/SQL com aspas escapadas', () => {
    expect(idTaco(3)).toBe('00000000-0000-4000-8000-000000000003');
    expect(idTaco(597)).toBe('00000000-0000-4000-8000-000000000597');
    const csv = paraCsvTaco([{ ...r[0], nome: 'Biscoito, "maria"' }]);
    expect(csv.split('\n')[0]).toMatch(/^taco_id,nome,grupo,kcal,proteina_g,carboidrato_g,lipidio_g,fibra_g,umidade_pct,/);
    expect(csv.split('\n')[1]).toMatch(/^1,"Biscoito, ""maria""",Cereais e derivados,124,2.6,25.8,1,2.7,70.1,,/);
    const sqlTexto = sqlSeedTaco([{ ...r[0], nome: "Pão d'água" }]);
    expect(sqlTexto).toContain(`('00000000-0000-4000-8000-000000000001', 1, 'Pão d''água', 'Cereais e derivados', 124, 2.6, 25.8, 1, 2.7, '{"umidade_pct":70.1,`);
    expect(sqlTexto.trimEnd().endsWith(';')).toBe(true);
  });
});
