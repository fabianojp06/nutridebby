import { formatarDecimal, casasDecimais, lerDecimal } from '@/lib/numero';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { gramasDaMedida, gramasDaMedidaTexto, QTD_MEDIDA_MAX } from '@/modules/alimentos/medidas-constantes';
import { lerQuantidade, type ItemCalculo } from '@/modules/plano-alimentar/calculo';
import { MAX_ITENS, MAX_REFEICOES } from '@/modules/plano-alimentar/constantes';
import type { ItemPlano, PlanoDoCliente, RascunhoEnviado } from '@/modules/plano-alimentar/tipos';

/** Estado local do editor: textos como a nutricionista digitou; números só na hora de calcular e enviar. */
export type ItemEstado = Omit<ItemPlano, 'quantidadeG' | 'medida' | 'medidaCaseiraTxt'> & {
  quantidadeTexto: string;
  medida: { nome: string; plural: string; gramas: number } | null;
  qtdTexto: string;
};
export type RefeicaoEstado = { id: string; nome: string; horario: string; observacao: string; itens: ItemEstado[] };
export type EstadoEditor = { titulo: string; metaTexto: string; energyCalcId: string | null; mostrarCalorias: boolean; orientacoes: string; refeicoes: RefeicaoEstado[] };

export type Acao =
  | { tipo: 'titulo'; valor: string }
  | { tipo: 'meta'; valor: string }
  | { tipo: 'usarCalculo'; id: string; kcal: number }
  | { tipo: 'mostrarCalorias'; valor: boolean }
  | { tipo: 'orientacoes'; valor: string }
  | { tipo: 'novaRefeicao'; id: string }
  | { tipo: 'refeicao'; id: string; campo: 'nome' | 'horario' | 'observacao'; valor: string }
  | { tipo: 'removerRefeicao'; id: string }
  | { tipo: 'adicionarItem'; refeicaoId: string; id: string; alimento: AlimentoEncontrado; substituiItemId?: string | null }
  | { tipo: 'quantidade'; itemId: string; valor: string }
  | { tipo: 'medida'; itemId: string; medida: { nome: string; plural: string; gramas: number } | null }
  | { tipo: 'qtdMedida'; itemId: string; valor: string }
  | { tipo: 'removerItem'; itemId: string }
  | { tipo: 'moverItem'; itemId: string; direcao: -1 | 1 };

/** Limites do servidor (15 refeições, 200 itens com as substituições): passando deles o PUT inteiro é recusado. */
export const totalDeItens = (e: EstadoEditor): number => e.refeicoes.reduce((n, r) => n + r.itens.length, 0);
export const podeAdicionarRefeicao = (e: EstadoEditor): boolean => e.refeicoes.length < MAX_REFEICOES;
export const podeAdicionarItem = (e: EstadoEditor): boolean => totalDeItens(e) < MAX_ITENS;

const numTexto = (n: number) => formatarDecimal(n, casasDecimais(n));

export function estadoInicial(p: PlanoDoCliente): EstadoEditor {
  return {
    titulo: p.titulo,
    metaTexto: p.metaKcal === null ? '' : String(p.metaKcal),
    energyCalcId: p.energyCalcId,
    mostrarCalorias: p.mostrarCalorias,
    orientacoes: p.orientacoes,
    refeicoes: p.refeicoes.map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: r.horario,
      observacao: r.observacao,
      itens: r.itens.map((i) => ({
        id: i.id,
        foodId: i.foodId,
        nome: i.nome,
        origem: i.origem,
        porCem: i.porCem,
        medidas: i.medidas,
        substituiItemId: i.substituiItemId,
        quantidadeTexto: numTexto(i.quantidadeG),
        medida: i.medida ? { nome: i.medida.nome, plural: i.medida.plural, gramas: i.medida.gramas } : null,
        qtdTexto: i.medida ? numTexto(i.medida.qtd) : '',
      })),
    })),
  };
}

/** Gramas do item ou null se o que foi digitado é inválido (o total trata como fora da conta). */
export function gramasDoItem(i: ItemEstado): number | null {
  if (!i.medida) return lerQuantidade(i.quantidadeTexto);
  const q = lerDecimal(i.qtdTexto);
  if (q === null || Number.isNaN(q) || q <= 0 || q > QTD_MEDIDA_MAX) return null;
  return lerQuantidade(gramasDaMedida(q, i.medida.gramas));
}

/** Valor da opção da medida gravada no item que não está mais na lista do alimento (medida própria excluída). */
const REMOVIDA = 'removida';

const posicaoDaMedida = (i: ItemEstado): number => {
  const m = i.medida;
  return m ? i.medidas.findIndex((x) => x.nome === m.nome && x.gramas === m.gramas) : -1;
};

/**
 * Opções do select de medida: as do alimento, com a posição na lista como valor (o nome não serve: uma "Minha medida"
 * pode repetir o nome de uma do IBGE com outros gramas, cadastrada antes da trava em `cadastrarMedida`). Se a medida
 * gravada no item saiu da lista, ela entra como "{nome} (removida)", com os gramas gravados: o select mostra o que o
 * item usa e "gramas" volta a funcionar.
 */
export function opcoesDeMedida(i: ItemEstado): { valor: string; rotulo: string }[] {
  const opcoes = i.medidas.map((m, k) => ({ valor: String(k), rotulo: `${m.nome} (${gramasDaMedidaTexto(m.gramas)})` }));
  return i.medida && posicaoDaMedida(i) < 0 ? [...opcoes, { valor: REMOVIDA, rotulo: `${i.medida.nome} (removida)` }] : opcoes;
}

/** Valor selecionado no select: '' (gramas), a posição da medida ou a removida. */
export function opcaoDaMedida(i: ItemEstado): string {
  if (!i.medida) return '';
  const k = posicaoDaMedida(i);
  return k < 0 ? REMOVIDA : String(k);
}

/** A medida da opção escolhida, com os gramas dela; '' (gramas) ou opção que não existe → null. */
export function medidaDaOpcao(i: ItemEstado, valor: string): ItemEstado['medida'] {
  if (valor === REMOVIDA) return i.medida;
  const m = valor === '' ? undefined : i.medidas[Number(valor)];
  return m ? { nome: m.nome, plural: m.plural, gramas: m.gramas } : null;
}

const nosItens = (e: EstadoEditor, f: (itens: ItemEstado[]) => ItemEstado[]): EstadoEditor => ({ ...e, refeicoes: e.refeicoes.map((r) => ({ ...r, itens: f(r.itens) })) });
const noItem = (e: EstadoEditor, id: string, f: (i: ItemEstado) => ItemEstado) => nosItens(e, (its) => its.map((i) => (i.id === id ? f(i) : i)));

export function reduzir(e: EstadoEditor, a: Acao): EstadoEditor {
  switch (a.tipo) {
    case 'titulo':
      return { ...e, titulo: a.valor };
    case 'meta':
      return { ...e, metaTexto: a.valor, energyCalcId: null };
    case 'usarCalculo':
      return { ...e, metaTexto: String(a.kcal), energyCalcId: a.id };
    case 'mostrarCalorias':
      return { ...e, mostrarCalorias: a.valor };
    case 'orientacoes':
      return { ...e, orientacoes: a.valor };
    case 'novaRefeicao':
      if (!podeAdicionarRefeicao(e)) return e;
      return { ...e, refeicoes: [...e.refeicoes, { id: a.id, nome: `Refeição ${e.refeicoes.length + 1}`, horario: '', observacao: '', itens: [] }] };
    case 'refeicao':
      return { ...e, refeicoes: e.refeicoes.map((r) => (r.id === a.id ? { ...r, [a.campo]: a.valor } : r)) };
    case 'removerRefeicao':
      return { ...e, refeicoes: e.refeicoes.filter((r) => r.id !== a.id) };
    case 'adicionarItem': {
      if (!podeAdicionarItem(e)) return e;
      const m = a.alimento.medidas[0];
      const novo: ItemEstado = {
        id: a.id,
        foodId: a.alimento.id,
        nome: a.alimento.nome,
        origem: a.alimento.origem,
        porCem: a.alimento.porCem,
        medidas: a.alimento.medidas,
        substituiItemId: a.substituiItemId ?? null,
        medida: m ? { nome: m.nome, plural: m.plural, gramas: m.gramas } : null,
        qtdTexto: m ? '1' : '',
        quantidadeTexto: m ? numTexto(m.gramas) : '100',
      };
      const destino = e.refeicoes.find((r) => r.id === a.refeicaoId);
      if (!destino) return e;
      if (!novo.substituiItemId) return { ...e, refeicoes: e.refeicoes.map((r) => (r === destino ? { ...r, itens: [...r.itens, novo] } : r)) };
      // US-023: a substituição aponta para um principal da mesma refeição e fica junto dele (depois das que ele já tem)
      const k = destino.itens.findIndex((i) => i.id === novo.substituiItemId);
      if (k < 0 || destino.itens[k].substituiItemId !== null) return e; // o servidor recusaria: nada muda
      let fim = k + 1;
      while (fim < destino.itens.length && destino.itens[fim].substituiItemId === novo.substituiItemId) fim++;
      return { ...e, refeicoes: e.refeicoes.map((r) => (r === destino ? { ...r, itens: [...r.itens.slice(0, fim), novo, ...r.itens.slice(fim)] } : r)) };
    }
    case 'quantidade':
      return noItem(e, a.itemId, (i) => ({ ...i, quantidadeTexto: a.valor }));
    case 'medida':
      return noItem(e, a.itemId, (i) => {
        const g = gramasDoItem(i);
        return a.medida ? { ...i, medida: a.medida, qtdTexto: '1' } : { ...i, medida: null, quantidadeTexto: g === null ? i.quantidadeTexto : numTexto(g) };
      });
    case 'qtdMedida':
      return noItem(e, a.itemId, (i) => ({ ...i, qtdTexto: a.valor }));
    case 'removerItem':
      return nosItens(e, (its) => its.filter((i) => i.id !== a.itemId && i.substituiItemId !== a.itemId));
    case 'moverItem': {
      const r = e.refeicoes.find((x) => x.itens.some((i) => i.id === a.itemId));
      if (!r) return e;
      const itens = moverNaRefeicao(r.itens, a.itemId, a.direcao);
      return itens === r.itens ? e : { ...e, refeicoes: e.refeicoes.map((x) => (x === r ? { ...x, itens } : x)) };
    }
  }
}

/**
 * US-023: o principal anda com as suas substituições, como um bloco que troca de lugar com o bloco vizinho; a
 * substituição só se reordena entre as do mesmo principal (nas pontas do grupo não faz nada). Devolve a própria
 * lista quando nada muda.
 */
function moverNaRefeicao(its: ItemEstado[], itemId: string, direcao: -1 | 1): ItemEstado[] {
  const item = its.find((i) => i.id === itemId);
  if (!item) return its;
  const principais = new Set(its.filter((i) => i.substituiItemId === null).map((i) => i.id));
  const filho = (i: ItemEstado) => i.substituiItemId !== null && principais.has(i.substituiItemId);

  if (filho(item)) {
    const grupo = its.map((x, idx) => (x.substituiItemId === item.substituiItemId ? idx : -1)).filter((idx) => idx >= 0);
    const de = grupo.findIndex((idx) => its[idx].id === itemId);
    const para = de + direcao;
    if (para < 0 || para >= grupo.length) return its;
    const novo = [...its];
    [novo[grupo[de]], novo[grupo[para]]] = [novo[grupo[para]], novo[grupo[de]]];
    return novo;
  }

  // principal (ou, em dado antigo, substituição sem principal na refeição): bloco = ele + as substituições dele
  const blocos = its.filter((i) => !filho(i)).map((i) => [i, ...its.filter((x) => filho(x) && x.substituiItemId === i.id)]);
  const de = blocos.findIndex((b) => b[0].id === itemId);
  const para = de + direcao;
  if (para < 0 || para >= blocos.length) return its;
  [blocos[de], blocos[para]] = [blocos[para], blocos[de]];
  return blocos.flat();
}

/**
 * Erros do servidor (D7) que nenhum campo da tela mostra — `geral`, `item:<id>:substituiItemId`, campo de item ou
 * refeição que já saiu da tela. Vão para o aviso do topo, para o "Corrija os campos destacados" nunca ficar sem destaque.
 */
export function errosSemCampo(e: EstadoEditor, erros: Record<string, string>): string[] {
  const campos = new Set(['titulo', 'metaKcal', 'orientacoes']);
  for (const r of e.refeicoes) {
    for (const c of ['nome', 'horario', 'observacao']) campos.add(`refeicao:${r.id}:${c}`);
    for (const i of r.itens) for (const c of ['quantidadeG', 'medida', 'foodId']) campos.add(`item:${i.id}:${c}`);
  }
  return [...new Set(Object.entries(erros).filter(([chave]) => !campos.has(chave)).map(([, msg]) => msg))];
}

export const refeicoesParaCalculo = (e: EstadoEditor): { itens: ItemCalculo[] }[] =>
  e.refeicoes.map((r) => ({ itens: r.itens.map((i) => ({ id: i.id, quantidadeG: gramasDoItem(i), porCem: i.porCem, substituiItemId: i.substituiItemId })) }));

/** Corpo do PUT (D7). Quantidade inválida vai como texto para o servidor devolver o erro do campo. */
export function paraEnvio(e: EstadoEditor, revisao: number): RascunhoEnviado {
  return {
    revisao,
    titulo: e.titulo,
    metaKcal: e.metaTexto,
    energyCalcId: e.energyCalcId,
    mostrarCalorias: e.mostrarCalorias,
    orientacoes: e.orientacoes,
    refeicoes: e.refeicoes.map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: r.horario,
      observacao: r.observacao,
      itens: r.itens.map((i) => {
        const g = gramasDoItem(i);
        const q = lerDecimal(i.qtdTexto);
        return {
          id: i.id,
          foodId: i.foodId,
          quantidadeG: g === null ? i.quantidadeTexto : numTexto(g).replace(',', '.'),
          medida: i.medida ? { ...i.medida, qtd: q !== null && Number.isFinite(q) ? q : 0 } : null,
          substituiItemId: i.substituiItemId,
        };
      }),
    })),
  };
}
