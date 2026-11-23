import { describe, expect, it } from 'vitest';
import { lerDecimal } from '@/lib/numero';
import { exameParaFormulario } from './valores';

describe('exameParaFormulario (code review do PR 2, Plano 22)', () => {
  it('limites muito pequenos voltam ao formulário sem notação exponencial e são aceitos de novo no Salvar', () => {
    const f = exameParaFormulario({
      nome: 'Exame',
      unidade: 'mg/dL',
      sinonimos: [],
      componentes: [],
      modeloNotaAbaixo: null,
      modeloNotaAcima: null,
      faixas: [{ sexo: null, idadeMin: null, idadeMax: null, aPartirDe: 0.0000005, abaixoDe: 1.5, categoria: 'Normal', fonte: 'Fonte', atualizadaEm: '2026-11-23T00:00:00.000Z' }],
    } as Parameters<typeof exameParaFormulario>[0]);
    expect(f.faixas[0].aPartirDe).toBe('0,0000005');
    expect(f.faixas[0].abaixoDe).toBe('1,5');
    expect(f.faixas[0].idadeMin).toBe('');
    expect(lerDecimal(f.faixas[0].aPartirDe)).toBe(0.0000005);
  });
});
