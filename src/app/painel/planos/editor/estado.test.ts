import { describe, expect, it } from 'vitest';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { itensComoTexto, totalDoDia } from '@/modules/plano-alimentar/calculo';
import type { PlanoDoCliente } from '@/modules/plano-alimentar/tipos';
import { MAX_ITENS, MAX_REFEICOES } from '@/modules/plano-alimentar/constantes';
import {
  errosSemCampo, estadoInicial, gramasDoItem, legendaDosDias, medidaDaOpcao, nomesAcessiveis, opcaoDaMedida, opcoesDeMedida, paraEnvio, podeAdicionarItem, podeAdicionarRefeicao, reduzir, refeicoesDoFiltro,
  refeicoesParaCalculo, totaisDoFiltro, type EstadoEditor,
} from './estado';

const plano: PlanoDoCliente = {
  id: 'p', patientId: 'pac', isTemplate: false, titulo: 'Plano alimentar', metaKcal: null, energyCalcId: null, status: 'rascunho', versao: 1, revisao: 0,
  publicadoEm: null, mostrarCalorias: false, orientacoes: '', modo: 'calculado', macrosPrescritos: null, pdfStatus: null, refeicoes: [], origemIa: null, iaOrigemEm: null,
};
const arroz: AlimentoEncontrado = {
  id: 'f-arroz', nome: 'Arroz, tipo 1, cozido', nomeOriginal: null, grupo: 'Cereais e derivados', fonte: 'taco', origem: 'TACO', micros: {},
  porCem: { kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 },
  medidas: [{ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 }],
};
const proprio: AlimentoEncontrado = { id: 'f-130', nome: 'Alimento 130', nomeOriginal: null, grupo: 'Miscelâneas', fonte: 'propria', origem: 'Meu alimento', micros: {}, porCem: { kcal: 130, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 }, medidas: [] };

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

  it('medida própria com o nome de uma do IBGE: escolher a própria aplica os gramas dela, não os do IBGE', () => {
    const comPropria: AlimentoEncontrado = { ...arroz, medidas: [...arroz.medidas, { id: 'm-propria', origem: 'Minha medida', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 30 }] };
    let e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: comPropria });
    expect(opcaoDaMedida(e.refeicoes[0].itens[0])).toBe('0'); // entra com a primeira (IBGE, 25 g)
    e = reduzir(e, { tipo: 'medida', itemId: 'i1', medida: medidaDaOpcao(e.refeicoes[0].itens[0], '1') });
    expect(gramasDoItem(e.refeicoes[0].itens[0])).toBe(30);
    expect(opcaoDaMedida(e.refeicoes[0].itens[0])).toBe('1'); // o select continua na própria
    expect(medidaDaOpcao(e.refeicoes[0].itens[0], '')).toBeNull(); // "gramas"
  });

  it('medida gravada que saiu da lista (medida própria excluída): opção "(removida)" selecionada, com os gramas gravados; "gramas" volta a funcionar', () => {
    const pires = { nome: 'pires pequeno', plural: 'pires pequenos', gramas: 60 };
    const comItem: PlanoDoCliente = {
      ...plano,
      refeicoes: [{ id: 'r1', nome: 'Almoço', horario: '12:00', observacao: '', diasSemana: [0, 1, 2, 3, 4, 5, 6], descricaoLivre: null, itens: [
        { id: 'i1', foodId: arroz.id, nome: arroz.nome, fonte: 'taco', origem: 'TACO', porCem: arroz.porCem, medidas: arroz.medidas, quantidadeG: 120, medida: { ...pires, qtd: 2 }, medidaCaseiraTxt: '2 pires pequenos', substituiItemId: null },
      ] }],
    };
    let e = estadoInicial(comItem);
    const item = e.refeicoes[0].itens[0];
    expect(opcaoDaMedida(item)).toBe('removida');
    expect(opcoesDeMedida(item)).toEqual([
      { valor: '0', rotulo: 'colher de sopa cheia (25 g)' },
      { valor: 'removida', rotulo: 'pires pequeno (removida)' },
    ]);
    expect(medidaDaOpcao(item, 'removida')).toEqual(pires);
    expect(gramasDoItem(item)).toBe(120);
    expect(opcoesDeMedida({ ...item, medidas: [] })).toEqual([{ valor: 'removida', rotulo: 'pires pequeno (removida)' }]); // alimento sem outras medidas
    e = reduzir(e, { tipo: 'medida', itemId: 'i1', medida: medidaDaOpcao(item, '') }); // "gramas"
    expect(e.refeicoes[0].itens[0]).toMatchObject({ medida: null, quantidadeTexto: '120' });
    expect(opcoesDeMedida(e.refeicoes[0].itens[0])).toEqual([{ valor: '0', rotulo: 'colher de sopa cheia (25 g)' }]); // a removida some com a troca
  });

  it('rótulo da medida no select com vírgula decimal e as casas que a medida tem (RNF-12): 12,5 g, 12,25 g, 30 g', () => {
    const medida = (nome: string, gramas: number) => ({ id: null, origem: 'IBGE' as const, nome, plural: nome, gramas });
    const comMedidas: AlimentoEncontrado = { ...arroz, medidas: [medida('concha', 12.5), medida('colher', 12.25), medida('escumadeira', 30)] };
    const e = aplicar(estadoInicial(plano), { tipo: 'novaRefeicao', id: 'r1' }, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'i1', alimento: comMedidas });
    expect(opcoesDeMedida(e.refeicoes[0].itens[0]).map((o) => o.rotulo)).toEqual(['concha (12,5 g)', 'colher (12,25 g)', 'escumadeira (30 g)']);
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

  it('"Grupo de substituição": tapioca e cuscuz entram logo depois do pão e não somam no total (US-023, RN-02)', () => {
    const pao = { ...arroz, id: 'f-pao', nome: 'Pão, trigo, francês', porCem: { kcal: 300, proteinaG: 8, carboidratoG: 58.6, lipidioG: 3.1, fibraG: 2.3 }, medidas: [] };
    const tapioca = { ...proprio, id: 'f-tap', nome: 'Tapioca, com manteiga', porCem: { kcal: 348, proteinaG: 0.1, carboidratoG: 63.6, lipidioG: 10.9, fibraG: 0 } };
    const cuscuz = { ...proprio, id: 'f-cus', nome: 'Cuscuz, de milho, cozido com sal', porCem: { kcal: 113, proteinaG: 2.2, carboidratoG: 25.3, lipidioG: 0.7, fibraG: 2.1 } };
    const e = aplicar(
      estadoInicial(plano),
      { tipo: 'novaRefeicao', id: 'r1' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'pao', alimento: pao },
      { tipo: 'quantidade', itemId: 'pao', valor: '50' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'cafe', alimento: proprio },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'tap', alimento: tapioca, substituiItemId: 'pao' },
      { tipo: 'quantidade', itemId: 'tap', valor: '40' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'cus', alimento: cuscuz, substituiItemId: 'pao' },
    );
    expect(e.refeicoes[0].itens.map((i) => i.id)).toEqual(['pao', 'tap', 'cus', 'cafe']);
    expect(totalDoDia(refeicoesParaCalculo(e)).kcal).toBe(280); // pão 150 + item de 130 kcal com 100 g; substituições fora
    expect(paraEnvio(e, 0).refeicoes[0].itens.filter((i) => i.substituiItemId === 'pao').map((i) => i.id)).toEqual(['tap', 'cus']);
  });

  it('substituição que não aponta para um principal da mesma refeição não entra e não conta como edição', () => {
    const e = aplicar(
      estadoInicial(plano),
      { tipo: 'novaRefeicao', id: 'r1' },
      { tipo: 'novaRefeicao', id: 'r2' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'a', alimento: arroz },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 's', alimento: proprio, substituiItemId: 'a' },
    );
    expect(reduzir(e, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'x', alimento: proprio, substituiItemId: 'nao-existe' })).toBe(e);
    expect(reduzir(e, { tipo: 'adicionarItem', refeicaoId: 'r2', id: 'x', alimento: proprio, substituiItemId: 'a' })).toBe(e); // principal de outra refeição
    expect(reduzir(e, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'x', alimento: proprio, substituiItemId: 's' })).toBe(e); // substituição de substituição
  });

  describe('mover itens com substituições (US-023)', () => {
    // a (a1, a2) · b (b1) · c — cada principal anda junto com as suas substituições
    const montar = () =>
      aplicar(
        estadoInicial(plano),
        { tipo: 'novaRefeicao', id: 'r1' },
        { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'a', alimento: arroz },
        { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'b', alimento: proprio },
        { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'c', alimento: proprio },
        { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'a1', alimento: proprio, substituiItemId: 'a' },
        { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'a2', alimento: proprio, substituiItemId: 'a' },
        { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'b1', alimento: proprio, substituiItemId: 'b' },
      );
    const ordem = (e: EstadoEditor) => e.refeicoes[0].itens.map((i) => i.id);

    it('principal sobe e desce com as suas substituições, trocando com o bloco inteiro do vizinho', () => {
      const e = montar();
      expect(ordem(e)).toEqual(['a', 'a1', 'a2', 'b', 'b1', 'c']);
      expect(ordem(reduzir(e, { tipo: 'moverItem', itemId: 'b', direcao: -1 }))).toEqual(['b', 'b1', 'a', 'a1', 'a2', 'c']);
      expect(ordem(reduzir(e, { tipo: 'moverItem', itemId: 'a', direcao: 1 }))).toEqual(['b', 'b1', 'a', 'a1', 'a2', 'c']);
      expect(ordem(reduzir(e, { tipo: 'moverItem', itemId: 'c', direcao: -1 }))).toEqual(['a', 'a1', 'a2', 'c', 'b', 'b1']);
      expect(ordem(reduzir(e, { tipo: 'moverItem', itemId: 'b', direcao: 1 }))).toEqual(['a', 'a1', 'a2', 'c', 'b', 'b1']);
      // dois passos seguidos: c passa por cima do bloco de b e depois do de a, sem separar ninguém de suas substituições
      const duas = reduzir(reduzir(e, { tipo: 'moverItem', itemId: 'c', direcao: -1 }), { tipo: 'moverItem', itemId: 'c', direcao: -1 });
      expect(ordem(duas)).toEqual(['c', 'a', 'a1', 'a2', 'b', 'b1']);
    });

    it('nas pontas da lista o principal não se move e o estado é o mesmo objeto (não conta como edição)', () => {
      const e = montar();
      expect(reduzir(e, { tipo: 'moverItem', itemId: 'a', direcao: -1 })).toBe(e);
      expect(reduzir(e, { tipo: 'moverItem', itemId: 'c', direcao: 1 })).toBe(e);
      expect(reduzir(e, { tipo: 'moverItem', itemId: 'nao-existe', direcao: 1 })).toBe(e);
    });

    it('substituição só troca de lugar com as do mesmo principal; nas pontas do grupo não faz nada', () => {
      const e = montar();
      expect(ordem(reduzir(e, { tipo: 'moverItem', itemId: 'a1', direcao: 1 }))).toEqual(['a', 'a2', 'a1', 'b', 'b1', 'c']);
      expect(ordem(reduzir(e, { tipo: 'moverItem', itemId: 'a2', direcao: -1 }))).toEqual(['a', 'a2', 'a1', 'b', 'b1', 'c']);
      expect(reduzir(e, { tipo: 'moverItem', itemId: 'a1', direcao: -1 })).toBe(e); // acima dela só está o principal
      expect(reduzir(e, { tipo: 'moverItem', itemId: 'a2', direcao: 1 })).toBe(e); // abaixo dela começa o bloco de b
      expect(reduzir(e, { tipo: 'moverItem', itemId: 'b1', direcao: -1 })).toBe(e);
      expect(reduzir(e, { tipo: 'moverItem', itemId: 'b1', direcao: 1 })).toBe(e); // abaixo dela está c
    });
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

  it('US-054: escolher, trocar e tirar a receita; o envio leva recipeContentId só com sugestão', () => {
    const plano: PlanoDoCliente = {
      id: 'p1', patientId: 'pa', isTemplate: false, titulo: 'Plano', metaKcal: null, energyCalcId: null, status: 'rascunho', versao: 1, revisao: 0,
      publicadoEm: null, mostrarCalorias: false, orientacoes: '', modo: 'calculado', macrosPrescritos: null, pdfStatus: null, origemIa: null, iaOrigemEm: null,
      refeicoes: [{ id: 'r1', nome: 'Café', horario: '07:00', observacao: '', diasSemana: [0, 1, 2, 3, 4, 5, 6], descricaoLivre: null, itens: [], receita: { id: 'c1', titulo: 'Panqueca', disponivel: false } }],
    };
    const e0 = estadoInicial(plano);
    expect(e0.refeicoes[0].receita).toEqual({ id: 'c1', titulo: 'Panqueca', disponivel: false });
    const e1 = reduzir(e0, { tipo: 'receita', id: 'r1', receita: { id: 'c2', titulo: 'Mingau' } });
    expect(e1.refeicoes[0].receita).toEqual({ id: 'c2', titulo: 'Mingau', disponivel: true });
    expect(paraEnvio(e1, 3).refeicoes[0].recipeContentId).toBe('c2');
    const e2 = reduzir(e1, { tipo: 'receita', id: 'r1', receita: null });
    expect(paraEnvio(e2, 3).refeicoes[0]).not.toHaveProperty('recipeContentId');
    expect(errosSemCampo(e2, { 'refeicao:r1:receita': 'Receita não encontrada.' })).toEqual([]);
  });
});

describe('Plano 19 — texto livre e dias da semana no editor (RN-243, RN-245, RN-246, RN-247)', () => {
  const feijao: AlimentoEncontrado = { ...proprio, id: 'f-feijao', nome: 'Feijão, carioca, cozido', porCem: { kcal: 76, proteinaG: 4.8, carboidratoG: 13.6, lipidioG: 0.5, fibraG: 8.5 } };
  /** Almoço (arroz 4 colheres de sopa cheias + feijão 90,5 g, com o próprio de 100 g como substituição do arroz). */
  const comAlimentos = () =>
    aplicar(
      estadoInicial(plano),
      { tipo: 'novaRefeicao', id: 'r1' },
      { tipo: 'refeicao', id: 'r1', campo: 'nome', valor: 'Almoço' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'arroz', alimento: arroz },
      { tipo: 'qtdMedida', itemId: 'arroz', valor: '4' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'feijao', alimento: feijao },
      { tipo: 'quantidade', itemId: 'feijao', valor: '90,5' },
      { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'sub', alimento: proprio, substituiItemId: 'arroz' },
      { tipo: 'novaRefeicao', id: 'r2' },
    );

  it('calculado → livre: cada refeição ganha o texto de itensComoTexto e os alimentos saem; o envio vai sem itens e com o texto', () => {
    const e = reduzir(comAlimentos(), { tipo: 'modo', modo: 'livre' });
    expect(e.modo).toBe('livre');
    const esperado = itensComoTexto([
      { id: 'arroz', nome: arroz.nome, quantidadeG: 100, medidaCaseiraTxt: '4 colheres de sopa cheias', substituiItemId: null },
      { id: 'feijao', nome: feijao.nome, quantidadeG: 90.5, medidaCaseiraTxt: null, substituiItemId: null },
      { id: 'sub', nome: proprio.nome, quantidadeG: 100, medidaCaseiraTxt: null, substituiItemId: 'arroz' },
    ]);
    expect(esperado).toBe('Arroz, tipo 1, cozido — 4 colheres de sopa cheias (ou Alimento 130 — 100 g); Feijão, carioca, cozido — 90,5 g');
    expect(e.refeicoes.map((r) => ({ texto: r.descricao, itens: r.itens.length }))).toEqual([{ texto: esperado, itens: 0 }, { texto: '', itens: 0 }]);
    const envio = paraEnvio(e, 4);
    expect(envio.modo).toBe('livre');
    expect(envio.refeicoes.map((r) => ({ itens: r.itens, descricaoLivre: r.descricaoLivre }))).toEqual([{ itens: [], descricaoLivre: esperado }, { itens: [], descricaoLivre: '' }]);
    // no modo livre não entra alimento (o servidor recusaria o PUT inteiro)
    expect(reduzir(e, { tipo: 'adicionarItem', refeicaoId: 'r1', id: 'x', alimento: proprio })).toBe(e);
    expect(reduzir(e, { tipo: 'modo', modo: 'livre' })).toBe(e); // mesmo modo: nada muda, não é edição
  });

  it('item com quantidade inválida vira texto com o que foi digitado, sem número inventado', () => {
    const e = aplicar(comAlimentos(), { tipo: 'quantidade', itemId: 'feijao', valor: 'abc' }, { tipo: 'qtdMedida', itemId: 'arroz', valor: '' }, { tipo: 'modo', modo: 'livre' });
    expect(e.refeicoes[0].descricao).toBe('Arroz, tipo 1, cozido — ? colher de sopa cheia (ou Alimento 130 — 100 g); Feijão, carioca, cozido — abc g');
  });

  it('livre → calculado: o texto e a distribuição prescrita saem; o calculado envia texto e distribuição nulos', () => {
    let e = aplicar(
      reduzir(comAlimentos(), { tipo: 'modo', modo: 'livre' }),
      { tipo: 'refeicao', id: 'r2', campo: 'descricao', valor: 'Fruta' },
      { tipo: 'macro', campo: 'proteina', valor: '20' },
      { tipo: 'macro', campo: 'carboidrato', valor: '50' },
      { tipo: 'macro', campo: 'lipidio', valor: '30' },
    );
    expect(paraEnvio(e, 0).macrosPrescritos).toEqual({ proteina: '20', carboidrato: '50', lipidio: '30' });
    e = reduzir(e, { tipo: 'modo', modo: 'calculado' });
    expect(e.modo).toBe('calculado');
    expect(e.macros).toEqual({ proteina: '', carboidrato: '', lipidio: '' });
    expect(e.refeicoes.map((r) => r.descricao)).toEqual(['', '']);
    const envio = paraEnvio(e, 0);
    expect(envio.macrosPrescritos).toBeNull();
    expect(envio.refeicoes.map((r) => r.descricaoLivre)).toEqual([null, null]);
  });

  it('distribuição vazia no modo livre vai como null (sem distribuição); o plano gravado volta para o editor como texto', () => {
    const e = reduzir(estadoInicial(plano), { tipo: 'modo', modo: 'livre' });
    expect(paraEnvio(e, 0).macrosPrescritos).toBeNull();
    const gravado = estadoInicial({
      ...plano, modo: 'livre', macrosPrescritos: { proteina: 20, carboidrato: 50, lipidio: 30 },
      refeicoes: [{ id: 'r1', nome: 'Almoço', horario: '12:00', observacao: '', diasSemana: [1, 2, 3, 4, 5], descricaoLivre: 'Prato feito', itens: [] }],
    });
    expect(gravado).toMatchObject({ modo: 'livre', macros: { proteina: '20', carboidrato: '50', lipidio: '30' }, refeicoes: [{ diasSemana: [1, 2, 3, 4, 5], descricao: 'Prato feito' }] });
  });

  /** Almoço seg–sex (Alimento 130, 100 g = 130 kcal), Almoço sáb–dom (200 g = 260 kcal) e Café todos os dias (130 kcal). */
  const semana = () =>
    aplicar(
      estadoInicial(plano),
      { tipo: 'novaRefeicao', id: 'cafe' },
      { tipo: 'refeicao', id: 'cafe', campo: 'nome', valor: 'Café' },
      { tipo: 'adicionarItem', refeicaoId: 'cafe', id: 'c1', alimento: proprio },
      { tipo: 'novaRefeicao', id: 'alm1' },
      { tipo: 'refeicao', id: 'alm1', campo: 'nome', valor: 'Almoço' },
      { tipo: 'adicionarItem', refeicaoId: 'alm1', id: 'a1', alimento: proprio },
      { tipo: 'dia', id: 'alm1', dia: 6, marcado: false },
      { tipo: 'dia', id: 'alm1', dia: 0, marcado: false },
      { tipo: 'novaRefeicao', id: 'alm2' },
      { tipo: 'refeicao', id: 'alm2', campo: 'nome', valor: 'Almoço' },
      { tipo: 'adicionarItem', refeicaoId: 'alm2', id: 'a2', alimento: proprio },
      { tipo: 'quantidade', itemId: 'a2', valor: '200' },
      ...([1, 2, 3, 4, 5] as const).map((dia) => ({ tipo: 'dia' as const, id: 'alm2', dia, marcado: false })),
    );

  it('dias: refeição nova com os 7 dias; desmarcar e marcar mantém a ordem; o envio leva os dias', () => {
    const e = semana();
    expect(e.refeicoes.map((r) => r.diasSemana)).toEqual([[0, 1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5], [0, 6]]);
    expect(reduzir(e, { tipo: 'dia', id: 'alm1', dia: 6, marcado: true }).refeicoes[1].diasSemana).toEqual([1, 2, 3, 4, 5, 6]);
    expect(reduzir(e, { tipo: 'dia', id: 'alm1', dia: 1, marcado: true })).toBe(e); // já marcado: nada muda
    expect(paraEnvio(e, 0).refeicoes.map((r) => r.diasSemana)).toEqual([[0, 1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5], [0, 6]]);
  });

  it('filtro "sáb": só as refeições de sábado e o total de sábado (nunca a soma dos dois Almoços)', () => {
    const e = semana();
    expect(refeicoesDoFiltro(e, 6).map((r) => r.id)).toEqual(['cafe', 'alm2']);
    expect(refeicoesDoFiltro(e, 'todos').map((r) => r.id)).toEqual(['cafe', 'alm1', 'alm2']);
    expect(totaisDoFiltro(e, 6)).toMatchObject({ total: { kcal: 390 }, perfis: [] });
    expect(totaisDoFiltro(e, 1)).toMatchObject({ total: { kcal: 260 }, perfis: [] });
    // "Todos" com perfis diferentes: a tabela dos perfis, sem um total que some os dois Almoços
    const todos = totaisDoFiltro(e, 'todos');
    expect(todos.perfis.map((p) => ({ rotulo: p.rotulo, kcal: p.total.kcal }))).toEqual([{ rotulo: 'seg a sex', kcal: 260 }, { rotulo: 'sáb e dom', kcal: 390 }]);
    // um perfil só: o total dele, sem tabela
    const umPerfil = totaisDoFiltro(aplicar(e, { tipo: 'removerRefeicao', id: 'alm2' }, { tipo: 'dia', id: 'alm1', dia: 6, marcado: true }, { tipo: 'dia', id: 'alm1', dia: 0, marcado: true }), 'todos');
    expect(umPerfil).toMatchObject({ total: { kcal: 260 }, perfis: [] });
  });

  it('legenda com o total de cada perfil e o dia sem refeições', () => {
    const e = semana();
    expect(legendaDosDias(e)).toEqual(['seg a sex: 260 kcal', 'sáb e dom: 390 kcal']);
    const semDomingo = reduzir(reduzir(e, { tipo: 'dia', id: 'alm2', dia: 0, marcado: false }), { tipo: 'dia', id: 'cafe', dia: 0, marcado: false });
    expect(legendaDosDias(semDomingo)).toEqual(['seg a sex: 260 kcal', 'sáb: 390 kcal', 'dom: sem refeições']);
    expect(legendaDosDias(estadoInicial(plano))).toEqual(['todos os dias: sem refeições']);
    // milhar com ponto, como no exemplo da spec ("seg a sex: 1.820 kcal")
    const grande = reduzir(e, { tipo: 'quantidade', itemId: 'c1', valor: '1300' });
    expect(legendaDosDias(grande)[0]).toBe('seg a sex: 1.820 kcal');
    // modo livre: sem cálculo, só os perfis
    expect(legendaDosDias(reduzir(semDomingo, { tipo: 'modo', modo: 'livre' }))).toEqual(['seg a sex', 'sáb', 'dom: sem refeições']);
  });

  it('nomes acessíveis únicos: dois "Almoço" levam os dias; nome único fica como está', () => {
    const e = semana();
    expect(nomesAcessiveis(e)).toEqual(new Map([['cafe', 'Café'], ['alm1', 'Almoço (seg a sex)'], ['alm2', 'Almoço (sáb e dom)']]));
    // mesmo nome e mesmos dias: a posição desempata; sem nome, "Refeição {n}"
    const iguais = aplicar(e, { tipo: 'dia', id: 'alm2', dia: 1, marcado: true }, { tipo: 'dia', id: 'alm2', dia: 2, marcado: true }, { tipo: 'dia', id: 'alm2', dia: 3, marcado: true }, { tipo: 'dia', id: 'alm2', dia: 4, marcado: true }, { tipo: 'dia', id: 'alm2', dia: 5, marcado: true }, { tipo: 'dia', id: 'alm2', dia: 6, marcado: false }, { tipo: 'dia', id: 'alm2', dia: 0, marcado: false }, { tipo: 'refeicao', id: 'cafe', campo: 'nome', valor: '' });
    const nomes = nomesAcessiveis(iguais);
    expect(nomes.get('cafe')).toBe('Refeição 1');
    expect(new Set(nomes.values()).size).toBe(3);
    expect([nomes.get('alm1'), nomes.get('alm2')]).toEqual(['Almoço (seg a sex, 2ª)', 'Almoço (seg a sex, 3ª)']);
  });

  it('erros de dias, texto e distribuição têm campo; refeição escondida pelo filtro de dia vai para o aviso do topo', () => {
    const livre = reduzir(semana(), { tipo: 'modo', modo: 'livre' });
    const erros = { 'refeicao:alm1:dias': 'Escolha ao menos um dia da semana.', 'refeicao:alm2:descricaoLivre': 'Texto muito longo (até 2000 caracteres).', macrosPrescritos: 'A soma de proteína, carboidrato e lipídio precisa dar 100%.' };
    expect(errosSemCampo(livre, erros)).toEqual([]);
    expect(errosSemCampo(livre, erros, 6)).toEqual(['Escolha ao menos um dia da semana.']); // o Almoço de seg a sex não está na tela
    // no calculado não há caixa "O que comer" nem distribuição
    expect(errosSemCampo(semana(), erros)).toEqual(['Texto muito longo (até 2000 caracteres).', 'A soma de proteína, carboidrato e lipídio precisa dar 100%.']);
  });
});
