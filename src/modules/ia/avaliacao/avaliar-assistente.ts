import { validarModelo } from '@/modules/pacientes/anamnese-tipos';
import { AREAS_MODELOS_IA, MAX_VOLTAS_MODELOS, PRAZO_LACO_MS, TETO_PACOTE_MODELOS_USD, usdParaMicro, type AreaModelosIA, type ModeloIA, type RegiaoIA } from '../constantes';
import { executarFerramenta, FERRAMENTAS_ALIMENTOS, novoCatalogo, type CatalogoDaTarefa } from '../ferramentas-alimentos';
import { ESFORCO_MODELOS, instrucaoModelos, PROMPT_VERSAO_MODELOS, SCHEMA_MODELOS, SISTEMA_MODELOS } from '../instrucoes/modelos';
import { ErroNoLaco, rodarLaco, type FimDoLaco } from '../laco-ferramentas';
import { lerPacote } from '../modelos-job';
import { validarPlanoIa } from '../plano-ia';
import { MAX_TOKENS_VOLTA } from '../precos';
import type { ProvedorIA } from '../provedor';
import { catalogoTaco } from './catalogo-taco';

export type TarefaAssistente = 'resumo' | 'rascunho' | 'modelos';
export type ResultadoDaArea = 'valido' | 'invalido' | 'parou' | 'erro' | 'nao_rodou';
/** Só números e códigos: nada do texto que o modelo escreveu. */
export type MetricasDaArea = {
  area: AreaModelosIA;
  resultado: ResultadoDaArea;
  planosValidos: number;
  anamneseValida: boolean;
  itens: number;
  descartados: number;
  termosProibidos: number;
  voltas: number;
  custoMicroUsd: number;
  tempoMs: number;
};
export type MetricasModelos = {
  promptVersao: string;
  tetoPorPacoteMicroUsd: number;
  /** Pacotes enviados ao provedor. */
  pacotes: number;
  /** Os 3 modelos válidos, pela mesma leitura do worker (`lerPacote`): o pacote seria gravado. */
  pacotesValidos: number;
  planosValidos: number;
  anamnesesValidas: number;
  /** Itens sugeridos nos planos válidos (os aproveitados + os descartados) e os descartados (D14). */
  itens: number;
  itensDescartados: number;
  descartadosPct: number;
  /** RN-123: ocorrências de medicamento ou suplemento nos textos dos planos (título, orientações e nome da refeição). */
  termosProibidos: number;
  /** O laço parou antes do fim (limite_voltas, limite_custo, resposta_invalida…), sem a recusa. */
  paradas: Record<string, number>;
  recusas: Record<string, number>;
  errosDoProvedor: Record<string, number>;
  voltasMedia: number;
  voltasMaximo: number;
  custoMedioMicroUsd: number;
  custoMaximoMicroUsd: number;
  /** Pacotes cujo custo real passou do teto do pacote (o laço não deixa: > 0 é defeito). */
  acimaDoTeto: number;
  tempoMedioMs: number;
  tempoMaximoMs: number;
  porArea: MetricasDaArea[];
};
export type RelatorioAssistente = {
  geradoEm: string;
  modelo: ModeloIA;
  geo: RegiaoIA;
  provedor: string;
  tetoMicroUsd: number;
  gastoMaximoMicroUsd: number;
  gastoRealMicroUsd: number;
  parouPeloTeto: boolean;
  modelos: MetricasModelos | null;
};

/**
 * RN-127 (Plano 14B): termos que a RN-123 proíbe sugerir nos modelos — medicamento, suplemento, fitoterápico e afins —,
 * sem acento e sem maiúsculas. Só nos textos dos planos: a anamnese pode legitimamente PERGUNTAR se o paciente usa
 * medicamento ou suplemento (histórico), o que não é prescrição.
 */
const TERMOS_RN123 = /\b(suplement\w*|medicament\w*|remedio\w*|fitoterap\w*|farmac\w*|polivitaminic\w*|capsula\w*|comprimido\w*|whey|creatina)\b/g;
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const contarTermos = (textos: string[]) => textos.reduce((n, t) => n + (semAcento(t).match(TERMOS_RN123)?.length ?? 0), 0);
const mais = (r: Record<string, number>, k: string) => void (r[k] = (r[k] ?? 0) + 1);
const media = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

/** As métricas de um pacote que chegou ao fim do laço: cada modelo validado como o worker valida, e nenhum texto guardado. */
function medirPacote(texto: string, cat: CatalogoDaTarefa): Pick<MetricasDaArea, 'resultado' | 'planosValidos' | 'anamneseValida' | 'itens' | 'descartados' | 'termosProibidos'> {
  let obj: unknown;
  try {
    obj = JSON.parse(texto);
  } catch {
    obj = null;
  }
  const o = (obj && typeof obj === 'object' ? obj : {}) as { planos?: unknown; anamnese?: unknown };
  const brutos = Array.isArray(o.planos) ? o.planos : [];
  const planos = brutos.map((b) => validarPlanoIa(b, cat)).filter((p) => p !== null && p.refeicoes.length > 0);
  const an = (o.anamnese && typeof o.anamnese === 'object' ? o.anamnese : {}) as { nome?: unknown; perguntas?: unknown };
  const textos = brutos.flatMap((b) => {
    const p = (b && typeof b === 'object' ? b : {}) as { titulo?: unknown; orientacoes?: unknown; refeicoes?: unknown };
    const nomes = Array.isArray(p.refeicoes) ? p.refeicoes.map((r) => (r && typeof r === 'object' ? (r as { nome?: unknown }).nome : null)) : [];
    return [p.titulo, p.orientacoes, ...nomes].filter((t): t is string => typeof t === 'string');
  });
  return {
    resultado: lerPacote(texto, cat) ? 'valido' : 'invalido',
    planosValidos: planos.length,
    anamneseValida: validarModelo({ nome: an.nome, perguntas: an.perguntas }).ok,
    itens: planos.reduce((n, p) => n + p!.descartados + p!.refeicoes.reduce((k, r) => k + r.itens.length, 0), 0),
    descartados: planos.reduce((n, p) => n + p!.descartados, 0),
    termosProibidos: contarTermos(textos),
  };
}

/**
 * RN-127 (Plano 14B): mede as tarefas do assistente com o provedor e o modelo pedidos, parando antes de passar do teto
 * somado (custo real + custo máximo da próxima tarefa). Na 14B-1, só os 7 pacotes de área (`modelos`); a T12 (14B-2)
 * acrescenta `resumo` e `rascunho`. O relatório guarda SÓ métricas — custo médio e máximo por tarefa contra o teto,
 * voltas, itens descartados, modelos válidos (2 planos + 1 anamnese), recusas por categoria, termos proibidos pela RN-123
 * encontrados (contagem), tempo — nunca o texto.
 *
 * Avaliar é rodar o mesmo código do worker (`processarGeracaoModelos`): `rodarLaco` com as instruções, o schema, o esforço,
 * as ferramentas, as voltas, o prazo e o teto de produção; `executarFerramenta` com a busca em memória da TACO
 * (`catalogoTaco`, sem banco e sem consultório); `lerPacote` (o "pacote válido" do worker). Nada é gravado.
 */
export async function avaliarAssistente(o: {
  tarefas: readonly TarefaAssistente[];
  modelo: ModeloIA;
  geo: RegiaoIA;
  provedor: ProvedorIA;
  tetoMicroUsd: number;
  tetoRascunhoMicroUsd: number;
  relogio?: () => number;
}): Promise<RelatorioAssistente> {
  const fora = o.tarefas.filter((t) => t !== 'modelos');
  if (fora.length) throw new Error(`avaliação de ${fora.join(', ')} ainda não disponível (Plano 14B-2)`);
  const relogio = o.relogio ?? (() => Date.now());
  const teto = usdParaMicro(TETO_PACOTE_MODELOS_USD); // a reserva de cada pacote em produção (A-D22 (b))
  let gastoMaximo = 0;
  let gastoReal = 0;
  let parou = false;
  let modelos: MetricasModelos | null = null;

  if (o.tarefas.includes('modelos')) {
    const buscar = catalogoTaco();
    const porArea: MetricasDaArea[] = [];
    const m: MetricasModelos = {
      promptVersao: PROMPT_VERSAO_MODELOS, tetoPorPacoteMicroUsd: teto, pacotes: 0, pacotesValidos: 0, planosValidos: 0, anamnesesValidas: 0, itens: 0,
      itensDescartados: 0, descartadosPct: 0, termosProibidos: 0, paradas: {}, recusas: {}, errosDoProvedor: {}, voltasMedia: 0, voltasMaximo: 0,
      custoMedioMicroUsd: 0, custoMaximoMicroUsd: 0, acimaDoTeto: 0, tempoMedioMs: 0, tempoMaximoMs: 0, porArea,
    };
    const custos: number[] = [];
    const voltas: number[] = [];
    const tempos: number[] = [];
    for (const area of AREAS_MODELOS_IA) {
      const linha: MetricasDaArea = { area, resultado: 'nao_rodou', planosValidos: 0, anamneseValida: false, itens: 0, descartados: 0, termosProibidos: 0, voltas: 0, custoMicroUsd: 0, tempoMs: 0 };
      porArea.push(linha);
      // o teto somado: o gasto real até aqui + o máximo que este pacote pode custar (a reserva dele) cabe no teto
      if (parou || gastoReal + teto > o.tetoMicroUsd) {
        parou = true;
        continue;
      }
      gastoMaximo += teto;
      m.pacotes++;
      const cat = novoCatalogo();
      const t0 = relogio();
      let fim: FimDoLaco;
      try {
        fim = await rodarLaco({
          provedor: o.provedor,
          pedido: { finalidade: 'modelos', modelo: o.modelo, geo: o.geo, sistema: SISTEMA_MODELOS, ferramentas: FERRAMENTAS_ALIMENTOS, schema: SCHEMA_MODELOS, maxTokens: MAX_TOKENS_VOLTA, esforco: ESFORCO_MODELOS },
          inicio: instrucaoModelos(area),
          executar: (c) => executarFerramenta(c, cat, buscar),
          limites: { voltas: MAX_VOLTAS_MODELOS, tetoMicroUsd: teto, prazoMs: PRAZO_LACO_MS },
          relogio,
        });
      } catch (e) {
        if (!(e instanceof ErroNoLaco)) throw e;
        mais(m.errosDoProvedor, e.erro.tipo);
        linha.resultado = 'erro';
        linha.voltas = e.voltas;
        // resultado incerto: o provedor pode ter cobrado a volta que falhou — conta o pacote inteiro (o total segue abaixo do teto)
        linha.custoMicroUsd = e.erro.tipo === 'incerto' ? teto : e.custoMicroUsd;
        gastoReal += linha.custoMicroUsd;
        continue;
      }
      linha.tempoMs = relogio() - t0;
      linha.voltas = fim.voltas;
      linha.custoMicroUsd = fim.custoMicroUsd;
      gastoReal += fim.custoMicroUsd;
      custos.push(fim.custoMicroUsd);
      voltas.push(fim.voltas);
      tempos.push(linha.tempoMs);
      if (fim.custoMicroUsd > teto) m.acimaDoTeto++;
      if (fim.tipo === 'parou') {
        linha.resultado = 'parou';
        if (fim.motivo === 'recusa') mais(m.recusas, fim.recusaCategoria ?? 'sem_categoria');
        else mais(m.paradas, fim.motivo);
        continue;
      }
      Object.assign(linha, medirPacote(fim.texto, cat));
      if (linha.resultado === 'valido') m.pacotesValidos++;
      m.planosValidos += linha.planosValidos;
      if (linha.anamneseValida) m.anamnesesValidas++;
      m.itens += linha.itens;
      m.itensDescartados += linha.descartados;
      m.termosProibidos += linha.termosProibidos;
    }
    m.descartadosPct = m.itens ? Math.round((m.itensDescartados / m.itens) * 1000) / 1000 : 0;
    m.voltasMedia = voltas.length ? Math.round((voltas.reduce((a, b) => a + b, 0) / voltas.length) * 10) / 10 : 0;
    m.voltasMaximo = voltas.length ? Math.max(...voltas) : 0;
    m.custoMedioMicroUsd = media(custos);
    m.custoMaximoMicroUsd = custos.length ? Math.max(...custos) : 0;
    m.tempoMedioMs = media(tempos);
    m.tempoMaximoMs = tempos.length ? Math.max(...tempos) : 0;
    modelos = m;
  }

  return {
    geradoEm: new Date().toISOString(),
    modelo: o.modelo,
    geo: o.geo,
    provedor: o.provedor.nome,
    tetoMicroUsd: o.tetoMicroUsd,
    gastoMaximoMicroUsd: gastoMaximo,
    gastoRealMicroUsd: gastoReal,
    parouPeloTeto: parou,
    modelos,
  };
}
