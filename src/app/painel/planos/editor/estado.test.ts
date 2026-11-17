import { describe, expect, it } from 'vitest';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { totalDoDia } from '@/modules/plano-alimentar/calculo';
import type { PlanoDoCliente } from '@/modules/plano-alimentar/tipos';
import { MAX_ITENS, MAX_REFEICOES } from '@/modules/plano-alimentar/constantes';
import { errosSemCampo, estadoInicial, gramasDoItem, medidaDaOpcao, opcaoDaMedida, opcoesDeMedida, paraEnvio, podeAdicionarItem, podeAdicionarRefeicao, reduzir, refeicoesParaCalculo, type EstadoEditor } from './estado';

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
