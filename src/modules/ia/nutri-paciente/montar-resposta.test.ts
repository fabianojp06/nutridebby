import { describe, expect, it } from 'vitest';
import { conferirTermos, montarResposta } from './montar-resposta';

describe('montarResposta (RN-172): nenhuma palavra do modelo', () => {
  it('frase do tipo + trechos com a fonte + frase final (exemplo da US-172)', () =>
    expect(montarResposta('substituicao', [{ indice: '#S1', fonte: 'Lanche da tarde — substituições', texto: 'Maçã — 1 unidade média (130 g)' }])).toBe(
      'No seu plano, as opções de substituição são:\nMaçã — 1 unidade média (130 g)\nFonte: Lanche da tarde — substituições\nIsto é o que está escrito no seu plano. Se a sua dúvida é se pode fazer diferente por causa de um sintoma ou situação de hoje, envie para sua nutricionista.',
    ));

  it('D25 = b: termo da pergunta presente no trecho citado → mostra; ausente → recusa', () => {
    const whey = [{ indice: '#I7', fonte: 'Pós-treino — itens', texto: 'Whey protein — 30 g' }];
    expect(conferirTermos('quanto de whey eu tomo depois do treino?', whey)).toBe(true);
    expect(conferirTermos('posso tomar creatina?', whey)).toBe(false);
    expect(conferirTermos('quanto de arroz?', whey)).toBe(true);
  });

  it('D25 = b: o termo vale só no texto do trecho, não na fonte; cada termo da pergunta precisa estar em algum trecho', () => {
    const trechos = [
      { indice: '#I1', fonte: 'Suplementos — itens', texto: 'Vitamina D3 — 1 cápsula' },
      { indice: '#I2', fonte: 'Café da manhã — itens', texto: 'Pão integral — 2 fatias' },
    ];
    expect(conferirTermos('quantas cápsulas de vitamina D3?', trechos)).toBe(true);
    expect(conferirTermos('quantos suplementos?', trechos)).toBe(false);
    expect(conferirTermos('posso tomar whey e vitamina D?', trechos)).toBe(false);
  });

  it('cabe no CHECK de 24.000 caracteres com 4 orientações de 5.000', () =>
    expect(
      montarResposta(
        'orientacao',
        Array.from({ length: 4 }, (_, i) => ({ indice: `#A${i + 1}`, fonte: 'Atendimento de 01/10/2026 — orientações', texto: 'x'.repeat(5000) })),
      ).length,
    ).toBeLessThanOrEqual(24_000));
});
