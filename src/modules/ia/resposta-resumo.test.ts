import { describe, expect, it } from 'vitest';
import { validarRespostaResumo } from './resposta-resumo';

const enviados = new Set(['#1', '#2', '#3']);
const r = (secoes: unknown) => JSON.stringify({ secoes });

describe('validarRespostaResumo (US-120, D13, A-D17)', () => {
  it('mantém frase com fonte enviada; retira sem fonte, com fonte inexistente, com URL e longa demais', () => {
    const v = validarRespostaResumo(r([{ secao: 'evolucao', frases: [
      { texto: 'O peso caiu 3,5 kg no período.', fontes: ['#1', '#3'] },
      { texto: 'Sem fonte.', fontes: [] },
      { texto: 'Fonte inventada.', fontes: ['#9'] },
      { texto: 'Veja https://exemplo.invalid', fontes: ['#1'] },
      { texto: 'x'.repeat(401), fontes: ['#1'] },
    ] }]), enviados)!;
    expect(v.secoes).toEqual([{ secao: 'evolucao', frases: [{ texto: 'O peso caiu 3,5 kg no período.', fontes: ['#1', '#3'] }] }]);
    expect(v.retiradas).toBe(4);
  });

  it('A-D17: na seção de exames, frase com interpretação sai (alto, baixo, normal, alterado, elevado…), sem acento e sem maiúsculas', () => {
    const v = validarRespostaResumo(r([{ secao: 'exames', frases: [
      { texto: 'Glicose: 110 mg/dL em 01/06 e 98 mg/dL em 01/09.', fontes: ['#2'] },
      { texto: 'A glicose estava ELEVADA.', fontes: ['#2'] },
      { texto: 'Valores dentro do normal.', fontes: ['#2'] },
      { texto: 'Colesterol limitrofe.', fontes: ['#2'] },
    ] }]), enviados)!;
    expect(v.secoes[0].frases).toHaveLength(1);
    expect(v.retiradas).toBe(3);
  });

  it('o filtro de interpretação vale só na seção de exames; com acento também sai ("limítrofe", "deficiência")', () => {
    const v = validarRespostaResumo(r([
      { secao: 'exames', frases: [{ texto: 'Ferritina limítrofe.', fontes: ['#2'] }, { texto: 'Deficiência de ferro.', fontes: ['#2'] }] },
      { secao: 'habitos', frases: [{ texto: 'Relata consumo baixo de água.', fontes: ['#3'] }] },
    ]), enviados)!;
    expect(v.secoes).toEqual([{ secao: 'habitos', frases: [{ texto: 'Relata consumo baixo de água.', fontes: ['#3'] }] }]);
    expect(v.retiradas).toBe(2);
  });

  it('caractere de controle tira a frase; fontes repetidas viram uma', () => {
    const v = validarRespostaResumo(r([{ secao: 'condutas', frases: [{ texto: 'Orientou\u0007 hidratação.', fontes: ['#1'] }, { texto: 'Orientou hidratação.', fontes: ['#1', '#1'] }] }]), enviados)!;
    expect(v.secoes).toEqual([{ secao: 'condutas', frases: [{ texto: 'Orientou hidratação.', fontes: ['#1'] }] }]);
    expect(v.retiradas).toBe(1);
  });

  it('seção desconhecida e JSON fora do formato → null; seções na ordem da tela', () => {
    expect(validarRespostaResumo('{', enviados)).toBeNull();
    expect(validarRespostaResumo(r([{ secao: 'pontos_para_avaliar', frases: [] }]), enviados)).toBeNull();
    const v = validarRespostaResumo(r([{ secao: 'condutas', frases: [{ texto: 'a', fontes: ['#1'] }] }, { secao: 'evolucao', frases: [{ texto: 'b', fontes: ['#1'] }] }]), enviados)!;
    expect(v.secoes.map((s) => s.secao)).toEqual(['evolucao', 'condutas']);
  });
});
