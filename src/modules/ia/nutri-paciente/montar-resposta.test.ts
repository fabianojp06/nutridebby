import { describe, expect, it } from 'vitest';
import { conferirTermos, cortarParaCaber, MAX_RESPOSTA_IA, montarResposta } from './montar-resposta';

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

  it('Review Focus 5 (RN-255, D25): fontes ["#L1-1", "#S2"] → cita #S2 primeiro, qualquer que seja a ordem do modelo', () => {
    const lista = { indice: '#L1-1', fonte: 'Lista de substituição — Carboidratos — 1 porção', texto: 'Arroz, tipo 1, cozido — 100 g; Mandioca, cozida — 100 g' };
    const sub = { indice: '#S2', fonte: 'Almoço — substituições', texto: 'Batata, doce, cozida — 150 g' };
    const r = montarResposta('substituicao', [lista, sub]);
    expect(r.indexOf('Batata, doce')).toBeLessThan(r.indexOf('Arroz, tipo 1'));
    expect(r).toBe(montarResposta('substituicao', [sub, lista]));
    expect(r.split('\n').slice(1, 5)).toEqual([sub.texto, `Fonte: ${sub.fonte}`, lista.texto, `Fonte: ${lista.fonte}`]);
    // entre fontes do mesmo tipo, a ordem recebida (estável)
    const s1 = { indice: '#S1', fonte: 'Almoço — substituições', texto: 'S1' };
    expect(montarResposta('substituicao', [{ ...lista, indice: '#L1-2', texto: 'L2' }, sub, lista, s1]).split('\n').filter((l) => !l.startsWith('Fonte')).slice(1, 5)).toEqual([sub.texto, 'S1', 'L2', lista.texto]);
  });

  it('R-239: trechos enormes (refeições de 60 itens com nomes de 120 caracteres) são cortados para a resposta caber no CHECK; trechos curtos ficam inteiros', () => {
    const grande = (i: number) => ({ indice: `#L1-${i}`, fonte: 'Refeição com nome bem comprido — itens', texto: Array.from({ length: 60 }, () => `${'N'.repeat(120)} — ${'M'.repeat(60)} (100 g) · 128 kcal`).join('; ') });
    const curto = { indice: '#S1', fonte: 'Almoço — substituições', texto: 'Batata, doce, cozida — 150 g' };
    const cortados = cortarParaCaber('substituicao', [grande(1), curto, grande(2), grande(3)]);
    expect(montarResposta('substituicao', cortados).length).toBeLessThanOrEqual(MAX_RESPOSTA_IA);
    expect(montarResposta('substituicao', cortados).length).toBeGreaterThan(MAX_RESPOSTA_IA - 10); // o espaço é usado
    expect(cortados[1]).toEqual(curto);
    for (const k of [0, 2, 3]) expect(cortados[k].texto.endsWith('…')).toBe(true);
    expect(cortados.map((t) => t.fonte)).toEqual([grande(1).fonte, curto.fonte, grande(2).fonte, grande(3).fonte]);
    // já cabe → nada muda
    expect(cortarParaCaber('substituicao', [curto])).toEqual([curto]);
    // sem partir um emoji (par substituto) no corte
    const emoji = { indice: '#O1', fonte: 'Orientações do plano', texto: '🍎'.repeat(20_000) };
    const [e] = cortarParaCaber('orientacao', [emoji]);
    expect(e.texto.endsWith('…')).toBe(true);
    expect(e.texto.slice(0, -1).length % 2).toBe(0);
  });

  it('cabe no CHECK de 24.000 caracteres com 4 orientações de 5.000', () =>
    expect(
      montarResposta(
        'orientacao',
        Array.from({ length: 4 }, (_, i) => ({ indice: `#A${i + 1}`, fonte: 'Atendimento de 01/10/2026 — orientações', texto: 'x'.repeat(5000) })),
      ).length,
    ).toBeLessThanOrEqual(24_000));
});
