import { formatarDecimal, casasDecimais, lerDecimal } from '@/lib/numero';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { gramasDaMedida, gramasDaMedidaTexto, QTD_MEDIDA_MAX, textoMedida } from '@/modules/alimentos/medidas-constantes';
import { formatarNutriente, formatarReferencia, NUTRIENTES, type ChaveNutriente } from '@/modules/alimentos/nutrientes';
import { MAX_NUTRIENTES_EXIBIDOS, type ReferenciaParaPlano } from '@/modules/alimentos/referencias-constantes';
import { itensComoTexto, lerQuantidade, totalDoDia, totaisDoDia, totalMicros, ZERO, type ItemComMicros, type Nutrientes } from '@/modules/plano-alimentar/calculo';
import { MAX_ITENS, MAX_REFEICOES, MSG_DIAS } from '@/modules/plano-alimentar/constantes';
import { diasSemRefeicao, ORDEM_DIAS, perfisDeDia, refeicoesDoDia, rotuloDosDias, TODOS_OS_DIAS, valeNoDia, type DiaDaSemana } from '@/modules/plano-alimentar/dias';
import type { ItemPlano, ModoPlano, PlanoDoCliente, RascunhoEnviado, ReceitaDaRefeicao } from '@/modules/plano-alimentar/tipos';

/** Estado local do editor: textos como a nutricionista digitou; números só na hora de calcular e enviar. */
export type ItemEstado = Omit<ItemPlano, 'quantidadeG' | 'medida' | 'medidaCaseiraTxt'> & {
  quantidadeTexto: string;
  medida: { nome: string; plural: string; gramas: number } | null;
  qtdTexto: string;
};
/** `descricao`: o texto livre (RN-243), '' no calculado; `diasSemana` em ordem 0…6 (RN-246). */
export type RefeicaoEstado = { id: string; nome: string; horario: string; observacao: string; diasSemana: DiaDaSemana[]; descricao: string; itens: ItemEstado[]; receita?: ReceitaDaRefeicao | null };
/** RN-244: a distribuição prescrita como digitada (% do VET). */
export type MacrosTexto = { proteina: string; carboidrato: string; lipidio: string };
export type EstadoEditor = {
  titulo: string;
  metaTexto: string;
  energyCalcId: string | null;
  mostrarCalorias: boolean;
  orientacoes: string;
  modo: ModoPlano;
  macros: MacrosTexto;
  /** RN-238/RN-239: o perfil escolhido ("Sem perfil" = null), os nutrientes do resumo (ordem do catálogo) e o PDF. */
  referenciaId: string | null;
  nutrientesExibidos: ChaveNutriente[];
  mostrarMicrosPdf: boolean;
  refeicoes: RefeicaoEstado[];
};
/** O filtro de dias do editor (RN-247 a): "Todos" ou um dia. Estado da tela, não do plano (não é edição). */
export type FiltroDia = 'todos' | DiaDaSemana;

const SEM_MACROS: MacrosTexto = { proteina: '', carboidrato: '', lipidio: '' };

export type Acao =
  | { tipo: 'titulo'; valor: string }
  | { tipo: 'meta'; valor: string }
  | { tipo: 'usarCalculo'; id: string; kcal: number }
  | { tipo: 'mostrarCalorias'; valor: boolean }
  | { tipo: 'orientacoes'; valor: string }
  | { tipo: 'modo'; modo: ModoPlano }
  | { tipo: 'macro'; campo: keyof MacrosTexto; valor: string }
  | { tipo: 'referencia'; id: string | null }
  | { tipo: 'nutriente'; chave: ChaveNutriente; marcado: boolean }
  | { tipo: 'mostrarMicrosPdf'; valor: boolean }
  | { tipo: 'novaRefeicao'; id: string }
  | { tipo: 'refeicao'; id: string; campo: 'nome' | 'horario' | 'observacao' | 'descricao'; valor: string }
  | { tipo: 'dia'; id: string; dia: DiaDaSemana; marcado: boolean }
  | { tipo: 'removerRefeicao'; id: string }
  | { tipo: 'receita'; id: string; receita: { id: string; titulo: string } | null }
  | { tipo: 'adicionarItem'; refeicaoId: string; id: string; alimento: AlimentoEncontrado; substituiItemId?: string | null }
  | { tipo: 'quantidade'; itemId: string; valor: string }
  | { tipo: 'medida'; itemId: string; medida: { nome: string; plural: string; gramas: number } | null }
  | { tipo: 'qtdMedida'; itemId: string; valor: string }
  | { tipo: 'removerItem'; itemId: string }
  | { tipo: 'moverItem'; itemId: string; direcao: -1 | 1 };

/** Limites do servidor (50 refeições, 400 itens com as substituições, RN-249): passando deles o PUT inteiro é recusado. */
export const totalDeItens = (e: EstadoEditor): number => e.refeicoes.reduce((n, r) => n + r.itens.length, 0);
export const podeAdicionarRefeicao = (e: EstadoEditor): boolean => e.refeicoes.length < MAX_REFEICOES;
export const podeAdicionarItem = (e: EstadoEditor): boolean => totalDeItens(e) < MAX_ITENS;
/** RN-239: até 12 nutrientes no resumo; o 13º é recusado ("Escolha até 12 nutrientes."). */
export const podeEscolherNutriente = (e: EstadoEditor): boolean => e.nutrientesExibidos.length < MAX_NUTRIENTES_EXIBIDOS;
const ORDEM_NUTRIENTE = new Map<string, number>(NUTRIENTES.map((n, k) => [n.chave, k]));

const numTexto = (n: number) => formatarDecimal(n, casasDecimais(n));

export function estadoInicial(p: PlanoDoCliente): EstadoEditor {
  return {
    titulo: p.titulo,
    metaTexto: p.metaKcal === null ? '' : String(p.metaKcal),
    energyCalcId: p.energyCalcId,
    mostrarCalorias: p.mostrarCalorias,
    orientacoes: p.orientacoes,
    modo: p.modo,
    macros: p.macrosPrescritos
      ? { proteina: String(p.macrosPrescritos.proteina), carboidrato: String(p.macrosPrescritos.carboidrato), lipidio: String(p.macrosPrescritos.lipidio) }
      : SEM_MACROS,
    referenciaId: p.referenciaId,
    nutrientesExibidos: [...p.nutrientesExibidos],
    mostrarMicrosPdf: p.mostrarMicrosPdf,
    refeicoes: p.refeicoes.map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: r.horario,
      observacao: r.observacao,
      diasSemana: [...r.diasSemana],
      descricao: r.descricaoLivre ?? '',
      ...(r.receita ? { receita: r.receita } : {}),
      itens: r.itens.map((i) => ({
        id: i.id,
        foodId: i.foodId,
        nome: i.nome,
        fonte: i.fonte,
        origem: i.origem,
        porCem: i.porCem,
        micros: i.micros,
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
    case 'modo':
      return trocarModo(e, a.modo);
    case 'macro':
      return { ...e, macros: { ...e.macros, [a.campo]: a.valor } };
    case 'referencia':
      return e.referenciaId === a.id ? e : { ...e, referenciaId: a.id };
    case 'nutriente': {
      if (e.nutrientesExibidos.includes(a.chave) === a.marcado) return e;
      if (!a.marcado) return { ...e, nutrientesExibidos: e.nutrientesExibidos.filter((c) => c !== a.chave) };
      if (!podeEscolherNutriente(e)) return e; // o 13º não entra (o servidor também recusa)
      return { ...e, nutrientesExibidos: [...e.nutrientesExibidos, a.chave].sort((x, y) => ORDEM_NUTRIENTE.get(x)! - ORDEM_NUTRIENTE.get(y)!) };
    }
    case 'mostrarMicrosPdf':
      return { ...e, mostrarMicrosPdf: a.valor };
    case 'novaRefeicao':
      if (!podeAdicionarRefeicao(e)) return e;
      return {
        ...e,
        refeicoes: [...e.refeicoes, { id: a.id, nome: `Refeição ${e.refeicoes.length + 1}`, horario: '', observacao: '', diasSemana: [...TODOS_OS_DIAS], descricao: '', itens: [] }],
      };
    case 'refeicao':
      return { ...e, refeicoes: e.refeicoes.map((r) => (r.id === a.id ? { ...r, [a.campo]: a.valor } : r)) };
    case 'dia': {
      const r = e.refeicoes.find((x) => x.id === a.id);
      if (!r || r.diasSemana.includes(a.dia) === a.marcado) return e;
      const diasSemana = a.marcado ? [...r.diasSemana, a.dia].sort((x, y) => x - y) : r.diasSemana.filter((d) => d !== a.dia);
      return { ...e, refeicoes: e.refeicoes.map((x) => (x === r ? { ...x, diasSemana } : x)) };
    }
    case 'removerRefeicao':
      return { ...e, refeicoes: e.refeicoes.filter((r) => r.id !== a.id) };
    case 'receita':
      return { ...e, refeicoes: e.refeicoes.map((r) => (r.id === a.id ? { ...r, receita: a.receita ? { ...a.receita, disponivel: true } : null } : r)) };
    case 'adicionarItem': {
      if (e.modo === 'livre' || !podeAdicionarItem(e)) return e; // RN-243: no modo livre a refeição não tem alimentos
      const m = a.alimento.medidas[0];
      const novo: ItemEstado = {
        id: a.id,
        foodId: a.alimento.id,
        nome: a.alimento.nome,
        fonte: a.alimento.fonte,
        origem: a.alimento.origem,
        porCem: a.alimento.porCem,
        micros: a.alimento.micros,
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
 * RN-245: o item como entra no texto da troca para o modo livre. Quantidade válida: a medida caseira (o mesmo
 * `textoMedida` que o servidor grava em `medida_caseira_txt`) ou os gramas. Inválida (o campo está em erro): o que foi
 * digitado, com a unidade ("abc g", "? colher de sopa cheia"), em vez de um número que a nutricionista não escreveu.
 */
function itemParaTexto(i: ItemEstado) {
  const g = gramasDoItem(i);
  const base = { id: i.id, nome: i.nome, substituiItemId: i.substituiItemId };
  if (g !== null) return { ...base, quantidadeG: g, medidaCaseiraTxt: i.medida ? textoMedida(lerDecimal(i.qtdTexto)!, i.medida) : null };
  const digitado = (i.medida ? i.qtdTexto : i.quantidadeTexto).trim() || '?';
  return { ...base, quantidadeG: 0, medidaCaseiraTxt: `${digitado} ${i.medida ? i.medida.nome : 'g'}` };
}

/**
 * RN-245: calculado → livre, cada refeição ganha o texto dos seus alimentos (`itensComoTexto`, a mesma regra do
 * servidor) e os alimentos saem; livre → calculado, o texto e a distribuição prescrita saem. O `confirm` é da tela;
 * a gravação é o salvamento automático de sempre (D7).
 */
function trocarModo(e: EstadoEditor, modo: ModoPlano): EstadoEditor {
  if (e.modo === modo) return e;
  if (modo === 'livre') return { ...e, modo, refeicoes: e.refeicoes.map((r) => ({ ...r, descricao: itensComoTexto(r.itens.map(itemParaTexto)), itens: [] })) };
  return { ...e, modo, macros: SEM_MACROS, refeicoes: e.refeicoes.map((r) => ({ ...r, descricao: '' })) };
}

/** Há o que a troca de modo apaga? (o `confirm` só aparece quando há: alimentos, ou texto e distribuição.) */
export function trocaPerdeAlgo(e: EstadoEditor): boolean {
  if (e.modo === 'calculado') return e.refeicoes.some((r) => r.itens.length > 0);
  return e.refeicoes.some((r) => r.descricao.trim() !== '') || Object.values(e.macros).some((v) => v.trim() !== '');
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
export function errosSemCampo(e: EstadoEditor, erros: Record<string, string>, filtro: FiltroDia = 'todos', fixadas: ReadonlySet<string> = NENHUMA): string[] {
  const campos = new Set(['titulo', 'metaKcal', 'orientacoes']);
  if (e.modo === 'livre') campos.add('macrosPrescritos');
  else campos.add('nutrientesExibidos'); // RN-243: a seção "Nutrientes do paciente" some no modo livre
  // Plano 19: a refeição escondida pelo filtro de dias não tem campo na tela (a fixada continua na tela)
  for (const r of refeicoesDoFiltro(e, filtro, fixadas)) {
    for (const c of ['nome', 'horario', 'observacao', 'receita', 'dias']) campos.add(`refeicao:${r.id}:${c}`);
    if (e.modo === 'livre') campos.add(`refeicao:${r.id}:descricaoLivre`);
    for (const i of r.itens) for (const c of ['quantidadeG', 'medida', 'foodId']) campos.add(`item:${i.id}:${c}`);
  }
  return [...new Set(Object.entries(erros).filter(([chave]) => !campos.has(chave)).map(([, msg]) => msg))];
}

export const refeicoesParaCalculo = (e: EstadoEditor): { id: string; diasSemana: DiaDaSemana[]; itens: ItemComMicros[] }[] =>
  e.refeicoes.map((r) => ({
    id: r.id,
    diasSemana: r.diasSemana,
    itens: r.itens.map((i) => ({ id: i.id, quantidadeG: gramasDoItem(i), porCem: i.porCem, micros: i.micros, substituiItemId: i.substituiItemId })),
  }));

const NENHUMA: ReadonlySet<string> = new Set();

/**
 * RN-247 (a): as refeições que o editor mostra — todas em "Todos"; num dia, só as que valem nele, mais as `fixadas`:
 * as que a nutricionista mexeu nos dias com este filtro escolhido. Desmarcar o dia filtrado numa refeição não tira o
 * cartão da tela no meio da edição (o foco não cai no body e o erro "Escolha ao menos um dia da semana." aparece ao
 * lado); o cartão diz que não vale no dia e sai quando o filtro muda (o editor limpa as fixadas). Ordem do plano.
 */
export const refeicoesDoFiltro = (e: EstadoEditor, filtro: FiltroDia, fixadas: ReadonlySet<string> = NENHUMA): RefeicaoEstado[] =>
  filtro === 'todos' ? e.refeicoes : e.refeicoes.filter((r) => valeNoDia(r, filtro) || fixadas.has(r.id));

export type PerfilComTotal = { rotulo: string; total: Nutrientes };

/**
 * RN-247 (a): o total do painel é sempre o de um dia (`totaisDoDia`), nunca a soma de todas as refeições. Num dia, o
 * total dele. Em "Todos": com um perfil de dia só, o total desse perfil; com perfis diferentes, `perfis` traz o total
 * de cada um (a tabela do painel, com "Escolha um dia para ver os detalhes.") e `total` fica zerado.
 */
export function totaisDoFiltro(e: EstadoEditor, filtro: FiltroDia): { total: Nutrientes; perfis: PerfilComTotal[] } {
  const calc = refeicoesParaCalculo(e);
  if (filtro !== 'todos') return { total: totaisDoDia(calc, filtro), perfis: [] };
  const perfis = perfisDeDia(calc);
  if (perfis.length <= 1) return { total: perfis.length ? totalDoDia(perfis[0].refeicoes) : ZERO, perfis: [] };
  return { total: ZERO, perfis: perfis.map((p) => ({ rotulo: rotuloDosDias(p.dias), total: totalDoDia(p.refeicoes) })) };
}

/** Uma linha de "Nutrientes do paciente" (RN-239): o total do dia e, com perfil, a meta e o máximo, já formatados. */
export type LinhaDoNutriente = {
  chave: ChaveNutriente;
  nome: string;
  /** "12,4 mg" (RN-235). */
  total: string;
  /** "18 mg" e "69%"; nulos sem perfil ou sem meta (a porcentagem também com meta 0). */
  meta: string | null;
  porcentagem: string | null;
  maximo: string | null;
  /** O total passou do máximo do perfil: a tela diz "Acima do máximo ({máximo})" em texto (RN-02, WCAG 1.4.1). */
  acimaDoMaximo: boolean;
  /** Itens principais sem o valor na fonte ("2 itens sem valor de ferro", RN-236). */
  semValor: number;
};

/**
 * US-233: o resumo "Nutrientes do paciente". `naoRegistrados`: plano publicado antes do Plano 19 (item sem micros na
 * cópia, RN-237). Por dia (RN-247 a): num dia, as refeições que valem nele (`totalMicros(refeicoesDoDia(…))`); em
 * "Todos", com um perfil de dia só, as dele; com perfis diferentes, `escolhaUmDia` (nunca a soma de todas as refeições).
 */
export type ResumoDeNutrientes = { tipo: 'naoRegistrados' } | { tipo: 'escolhaUmDia' } | { tipo: 'linhas'; linhas: LinhaDoNutriente[] };

export function resumoDeNutrientes(e: EstadoEditor, filtro: FiltroDia, chaves: readonly ChaveNutriente[], perfil: Pick<ReferenciaParaPlano, 'valores'> | null): ResumoDeNutrientes {
  if (e.refeicoes.some((r) => r.itens.some((i) => i.micros === null))) return { tipo: 'naoRegistrados' };
  const calc = refeicoesParaCalculo(e);
  let doDia: typeof calc;
  if (filtro !== 'todos') doDia = refeicoesDoDia(calc, filtro);
  else {
    const perfis = perfisDeDia(calc);
    if (perfis.length > 1) return { tipo: 'escolhaUmDia' };
    doDia = perfis[0]?.refeicoes ?? [];
  }
  const totais = totalMicros(doDia, chaves);
  const nome = new Map(NUTRIENTES.map((n) => [n.chave as string, n.nome]));
  return {
    tipo: 'linhas',
    linhas: chaves.map((c) => {
      const { total, semValor } = totais[c];
      const v = perfil?.valores[c];
      const meta = typeof v?.meta === 'number' ? v.meta : null;
      const maximo = typeof v?.maximo === 'number' ? v.maximo : null;
      return {
        chave: c,
        nome: nome.get(c)!,
        total: formatarNutriente(c, total),
        meta: meta === null ? null : formatarReferencia(c, meta),
        porcentagem: meta === null || meta === 0 ? null : `${Math.round((total / meta) * 100)}%`,
        maximo: maximo === null ? null : formatarReferencia(c, maximo),
        acimaDoMaximo: maximo !== null && total > maximo,
        semValor,
      };
    }),
  };
}

/** "Ferro: 12,4 mg · meta 18 mg (69%)" (US-233); sem perfil, só o total. */
export const textoDaLinha = (l: LinhaDoNutriente): string => `${l.nome}: ${l.total}${l.meta === null ? '' : ` · meta ${l.meta}${l.porcentagem === null ? '' : ` (${l.porcentagem})`}`}`;

/** kcal da legenda com o milhar, como no exemplo da spec ("seg a sex: 1.820 kcal"). */
const kcalComMilhar = (n: number): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(n));

/**
 * RN-247 (a): a legenda do filtro, na ordem do primeiro dia (seg…dom): cada perfil com a energia do dia ("seg a sex:
 * 1.820 kcal"; no modo livre, sem cálculo, só os dias) e os dias sem refeição juntos ("dom: sem refeições").
 */
export function legendaDosDias(e: EstadoEditor): string[] {
  const perfis = perfisDeDia(refeicoesParaCalculo(e));
  const partes = perfis.map((p) => ({ primeiro: ORDEM_DIAS.indexOf(p.dias[0]), texto: e.modo === 'livre' ? rotuloDosDias(p.dias) : `${rotuloDosDias(p.dias)}: ${kcalComMilhar(totalDoDia(p.refeicoes).kcal)} kcal` }));
  const vazios = diasSemRefeicao(e.refeicoes);
  if (vazios.length) partes.push({ primeiro: ORDEM_DIAS.indexOf(vazios[0]), texto: MSG_DIAS.semRefeicoes(rotuloDosDias(vazios)) });
  return partes.sort((a, b) => a.primeiro - b.primeiro).map((p) => p.texto);
}

/**
 * RNF-232: o nome da refeição nos rótulos ("Horário de {nome}", "Dias de {nome}"…), único na tela. Nome repetido leva
 * os dias ("Almoço (seg a sex)"); se ainda repete (mesmos dias), a posição ("Almoço (seg a sex, 3ª)"). Sem nome,
 * "Refeição {n}".
 */
export function nomesAcessiveis(e: EstadoEditor): Map<string, string> {
  const repete = (lista: string[]) => {
    const n = new Map<string, number>();
    for (const x of lista) n.set(x.toLowerCase(), (n.get(x.toLowerCase()) ?? 0) + 1);
    return (x: string) => n.get(x.toLowerCase())! > 1;
  };
  const base = e.refeicoes.map((r, k) => r.nome.trim() || `Refeição ${k + 1}`);
  const dias = (k: number) => rotuloDosDias(e.refeicoes[k].diasSemana) || 'sem dias';
  const nomeRepete = repete(base);
  const comDias = base.map((n, k) => (nomeRepete(n) ? `${n} (${dias(k)})` : n));
  const comDiasRepete = repete(comDias);
  return new Map(e.refeicoes.map((r, k) => [r.id, nomeRepete(base[k]) && comDiasRepete(comDias[k]) ? `${base[k]} (${dias(k)}, ${k + 1}ª)` : comDias[k]]));
}

/** Corpo do PUT (D7). Quantidade inválida vai como texto para o servidor devolver o erro do campo. */
export function paraEnvio(e: EstadoEditor, revisao: number): RascunhoEnviado {
  return {
    revisao,
    titulo: e.titulo,
    metaKcal: e.metaTexto,
    energyCalcId: e.energyCalcId,
    mostrarCalorias: e.mostrarCalorias,
    orientacoes: e.orientacoes,
    modo: e.modo,
    // RN-244: os três vazios = sem distribuição; o servidor confere a soma
    macrosPrescritos: e.modo === 'livre' && Object.values(e.macros).some((v) => v.trim() !== '') ? { ...e.macros } : null,
    referenciaId: e.referenciaId,
    nutrientesExibidos: [...e.nutrientesExibidos],
    mostrarMicrosPdf: e.mostrarMicrosPdf,
    refeicoes: e.refeicoes.map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: r.horario,
      observacao: r.observacao,
      diasSemana: [...r.diasSemana],
      descricaoLivre: e.modo === 'livre' ? r.descricao : null,
      ...(r.receita ? { recipeContentId: r.receita.id } : {}),
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
