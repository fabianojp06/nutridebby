import { describe, expect, it } from 'vitest';
import { validarMetas } from './rascunho-dados';

const base = { metaKcal: '1800', proteinaPct: '20', carboidratoPct: '50', lipidioPct: '30', refeicoes: [{ nome: 'Almoço', horario: '12:00' }], restricoes: '', considerarAnamnese: false };
const erros = (bruto: unknown) => {
  const v = validarMetas(bruto);
  return v.ok ? null : v.erros;
};

describe('validarMetas (US-121): os textos do formulário do rascunho', () => {
  it('metas válidas', () => {
    const v = validarMetas({ ...base, restricoes: '  Sem lactose.\r\nPrefere peixe.  ', considerarAnamnese: 'on' });
    expect(v).toEqual({
      ok: true,
      metas: { metaKcal: 1800, proteinaPct: 20, carboidratoPct: 50, lipidioPct: 30, refeicoes: [{ nome: 'Almoço', horario: '12:00' }], restricoes: 'Sem lactose.\nPrefere peixe.', considerarAnamnese: true },
    });
  });

  it('meta fora de 500–10000', () => {
    expect(erros({ ...base, metaKcal: '400' })).toEqual({ metaKcal: 'Meta deve estar entre 500 e 10000 kcal' });
    expect(erros({ ...base, metaKcal: '' })).toEqual({ metaKcal: 'Meta deve estar entre 500 e 10000 kcal' });
    expect(erros({ ...base, metaKcal: '10001' })).toEqual({ metaKcal: 'Meta deve estar entre 500 e 10000 kcal' });
  });

  it('"1800" e "1800,0" valem 1800; "1.800" é lido como 1,8 (o lerDecimal do editor) e recusado', () => {
    for (const metaKcal of ['1800', '1800,0']) {
      const v = validarMetas({ ...base, metaKcal });
      expect(v.ok && v.metas.metaKcal).toBe(1800);
    }
    expect(erros({ ...base, metaKcal: '1.800' })).toEqual({ metaKcal: 'Meta deve estar entre 500 e 10000 kcal' });
  });

  it('soma das porcentagens diferente de 100%', () => {
    expect(erros({ ...base, lipidioPct: '20' })).toEqual({ macros: 'Soma diferente de 100%' });
    expect(erros({ ...base, lipidioPct: '' })).toEqual({ macros: 'Soma diferente de 100%' });
    expect(erros({ ...base, proteinaPct: '-10', carboidratoPct: '80' })).toEqual({ macros: 'Soma diferente de 100%' });
    const v = validarMetas({ ...base, proteinaPct: '20,5', carboidratoPct: '49,5' });
    expect(v.ok).toBe(true);
  });

  it('refeições: ao menos uma, até 15, nome e horário', () => {
    expect(erros({ ...base, refeicoes: [] })).toEqual({ refeicoes: 'Informe ao menos uma refeição.' });
    expect(erros({ ...base, refeicoes: undefined })).toEqual({ refeicoes: 'Informe ao menos uma refeição.' });
    expect(erros({ ...base, refeicoes: [{ nome: 'Almoço', horario: '25:00' }] })).toEqual({ 'refeicao:0:horario': 'Horário inválido (use HH:MM)' });
    expect(erros({ ...base, refeicoes: [{ nome: '  ', horario: '12:00' }] })).toEqual({ 'refeicao:0:nome': 'Informe o nome da refeição (até 60 caracteres)' });
    expect(erros({ ...base, refeicoes: [{ nome: 'x'.repeat(61), horario: '12:00' }] })).toEqual({ 'refeicao:0:nome': 'Informe o nome da refeição (até 60 caracteres)' });
    const dezesseis = Array.from({ length: 16 }, (_, i) => ({ nome: `R${i}`, horario: '12:00' }));
    // RN-249 (Plano 19): o editor vai a 50 refeições, o rascunho da IA fica em 15
    expect(erros({ ...base, refeicoes: dezesseis })).toEqual({ refeicoes: 'O rascunho da IA pode ter até 15 refeições e 200 itens.' });
    expect(erros({ ...base, refeicoes: dezesseis.slice(0, 15) })).toBeNull();
  });

  it('restrições com mais de 500 caracteres', () => {
    expect(erros({ ...base, restricoes: 'a'.repeat(501) })).toEqual({ restricoes: 'Texto muito longo (até 500 caracteres).' });
    expect(validarMetas({ ...base, restricoes: 'a'.repeat(500) }).ok).toBe(true);
  });

  it('entrada que não é objeto não quebra', () => {
    expect(validarMetas(null).ok).toBe(false);
    expect(validarMetas('x').ok).toBe(false);
  });
});
