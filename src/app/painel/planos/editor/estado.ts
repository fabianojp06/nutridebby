import { formatarDecimal, casasDecimais, lerDecimal } from '@/lib/numero';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { gramasDaMedida, QTD_MEDIDA_MAX } from '@/modules/alimentos/medidas-constantes';
import { lerQuantidade, type ItemCalculo } from '@/modules/plano-alimentar/calculo';
import type { ItemPlano, PlanoCompleto, RascunhoEnviado } from '@/modules/plano-alimentar/tipos';

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

const numTexto = (n: number) => formatarDecimal(n, casasDecimais(n));

export function estadoInicial(p: PlanoCompleto): EstadoEditor {
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
      return { ...e, refeicoes: [...e.refeicoes, { id: a.id, nome: `Refeição ${e.refeicoes.length + 1}`, horario: '', observacao: '', itens: [] }] };
    case 'refeicao':
      return { ...e, refeicoes: e.refeicoes.map((r) => (r.id === a.id ? { ...r, [a.campo]: a.valor } : r)) };
    case 'removerRefeicao':
      return { ...e, refeicoes: e.refeicoes.filter((r) => r.id !== a.id) };
    case 'adicionarItem': {
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
      return { ...e, refeicoes: e.refeicoes.map((r) => (r.id === a.refeicaoId ? { ...r, itens: [...r.itens, novo] } : r)) };
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
    case 'moverItem':
      return nosItens(e, (its) => {
        const k = its.findIndex((i) => i.id === a.itemId);
        const j = k + a.direcao;
        if (k < 0 || j < 0 || j >= its.length) return its;
        const novo = [...its];
        [novo[k], novo[j]] = [novo[j], novo[k]];
        return novo;
      });
  }
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
