import { describe, expect, it } from 'vitest';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { totalDoDia } from '@/modules/plano-alimentar/calculo';
import type { PlanoCompleto } from '@/modules/plano-alimentar/tipos';
import { MAX_ITENS, MAX_REFEICOES } from '@/modules/plano-alimentar/constantes';
import { errosSemCampo, estadoInicial, gramasDoItem, paraEnvio, podeAdicionarItem, podeAdicionarRefeicao, reduzir, refeicoesParaCalculo, type EstadoEditor } from './estado';

const plano: PlanoCompleto = {
  id: 'p', patientId: 'pac', isTemplate: false, titulo: 'Plano alimentar', metaKcal: null, energyCalcId: null, status: 'rascunho', versao: 1, revisao: 0,
  publicadoEm: null, mostrarCalorias: false, orientacoes: '', pdfStatus: null, pdfPath: null, refeicoes: [],
};
const arroz: AlimentoEncontrado = {
  id: 'f-arroz', nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', origem: 'TACO',
  porCem: { kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 },
  medidas: [{ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 }],
};
const proprio: AlimentoEncontrado = { id: 'f-130', nome: 'Alimento 130', grupo: 'Miscelâneas', origem: 'Meu alimento', porCem: { kcal: 130, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 }, medidas: [] };

const aplicar = (e: EstadoEditor, ...as: Parameters<typeof reduzir>[1][]) => as.reduce(reduzir, e);

describe('estado do editor (US-022)', () => {
  it('nova refeição; alimento com medida entra com 1 medida; sem medida entra com 100 g', () => {
    const e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: arroz }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i2', alimento: proprio });
    expect(e.refeicoes[0]).toMatchObject({ id: 'r1', nome: 'Refeição 1', horario: '' });
    expect(gramasDoItem(e.refeicoes[0].itens[0])).toBe(25);
    expect(gramasDoItem(e.refeicoes[0].itens[1])).toBe(100);
  });

  it('"Medidas caseiras": quantidade 4 da colher de sopa cheia = 100 g; trocar para gramas mantém o valor', () => {
    let e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: arroz }, { tipo: 'qtdMedida', itemId: 'i1', valor: '4' });
    expect(gramasDoItem(e.refeicoes[0].itens[0])).toBe(100);
    expect(paraEnvio(e, 3).refeicoes[0].itens[0]).toEqual({ id: 'i1', foodId: 'f-arroz', quantidadeG: '100', medida: { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 }, substituiItemId: null });
    e = reduzir(e, { tipo: 'medida', itemId: 'i1', medida: null });
    expect(e.refeicoes[0].itens[0]).toMatchObject({ medida: null, quantidadeTexto: '100' });
    e = reduzir(e, { tipo: 'quantidade', itemId: 'i1', valor: '1,5' });
    expect(gramasDoItem(e.refeicoes[0].itens[0])).toBe(1.5);
  });

  it('"Cálculo do item": 150 g de 130 kcal/100 g → 195 kcal no total do dia; quantidade inválida não vira NaN', () => {
    let e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: proprio }, { tipo: 'quantidade', itemId: 'i1', valor: '150' });
    expect(totalDoDia(refeicoesParaCalculo(e)).kcal).toBe(195);
    e = reduzir(e, { tipo: 'quantidade', itemId: 'i1', valor: 'abc' });
    expect(totalDoDia(refeicoesParaCalculo(e)).kcal).toBe(0);
  });

  it('remover o principal remove as substituições; mover troca a ordem dentro da refeição', () => {
    let e = aplicar(
      estadoInicial(plano),
      { tipo: 'novaRefeicao', id: 'r1' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'a', alimento: arroz },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'b', alimento: proprio },
      { tipo: 'moverItem', itemId: 'b', direcao: -1 },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 's', alimento: proprio, substituiItemId: 'a' },
    );
    expect(e.refeicoes[0].itens.map((i) => i.id)).toEqual(['b', 'a', 's']);
    e = reduzir(e, { tipo: 'removerItem', itemId: 'a' });
    expect(e.refeicoes[0].itens.map((i) => i.id)).toEqual(['b']);
  });

  it('"Usar como meta do plano" grava meta e cálculo; digitar a meta desliga o cálculo de origem', () => {
    let e = reduzir(estadoInicial(plano), { tipo: 'usarCalculo', id: 'calc', kcal: 2008 });
    expect(paraEnvio(e, 0)).toMatchObject({ metaKcal: '2008', energyCalcId: 'calc' });
    e = reduzir(e, { tipo: 'meta', valor: '1900' });
    expect(paraEnvio(e, 0)).toMatchObject({ metaKcal: '1900', energyCalcId: null });
  });

  it('"Limites do plano": a 16ª refeição e o 201º item (principal ou substituição) não entram (RN/US-022)', () => {
    let e = estadoInicial(plano);
    for (let k = 0; k < MAX_REFEICOES; k++) e = reduzir(e, { tipo: 'novaRefeicao', id: `r${k}` });
    expect(e.refeicoes).toHaveLength(MAX_REFEICOES);
    expect(podeAdicionarRefeicao(e)).toBe(false);
    expect(reduzir(e, { tipo: 'novaRefeicao', id: 'r-extra' })).toBe(e); // mesmo objeto: nada mudou, não conta como edição

    for (let k = 0; k < MAX_ITENS; k++) e = reduzir(e, { tipo: 'adicionarItem', refeicaoId: `r${k % 2}`, id: `i${k}`, alimento: proprio });
    expect(e.refeicoes.reduce((n, r) => n + r.itens.length, 0)).toBe(MAX_ITENS);
    expect(podeAdicionarItem(e)).toBe(false);
    expect(reduzir(e, { tipo: 'adicionarItem', refeicaoId: 'r0', id: 'i-extra', alimento: proprio })).toBe(e);
    expect(reduzir(e, { tipo: 'adicionarItem', refeicaoId: 'r0', id: 's-extra', alimento: proprio, substituiItemId: 'i0' })).toBe(e);

    e = reduzir(e, { tipo: 'removerItem', itemId: 'i0' }); // liberou uma vaga
    expect(podeAdicionarItem(e)).toBe(true);
    e = reduzir(e, { tipo: 'removerRefeicao', id: 'r3' });
    expect(podeAdicionarRefeicao(e)).toBe(true);
  });

  it('erro do servidor sem campo na tela (geral, substituição, id que sumiu) vai para o aviso do topo, sem repetir mensagem', () => {
    const e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: proprio });
    expect(
      errosSemCampo(e, {
        titulo: 'Informe o título',
        metaKcal: 'Meta inválida',
        orientacoes: 'Texto longo',
        'refeicao:r1:nome': 'Nome',
        'refeicao:r1:horario': 'Horário',
        'refeicao:r1:observacao': 'Texto longo',
        'item:i1:quantidadeG': 'Quantidade',
        'item:i1:medida': 'Quantidade',
        'item:i1:foodId': 'Alimento',
      }),
    ).toEqual([]);
    expect(errosSemCampo(e, { geral: 'O plano pode ter até 15 refeições e 200 itens.', 'item:i1:substituiItemId': 'Substituição', 'item:sumiu:quantidadeG': 'Substituição', 'refeicao:sumiu:nome': 'Nome' })).toEqual([
      'O plano pode ter até 15 refeições e 200 itens.',
      'Substituição',
      'Nome',
    ]);
  });
});
