import type { MotivoFalha } from './constantes';
import { custoMaximoMicroUsd, custoMicroUsd, tokensDeBytes } from './precos';
import { ErroProvedor, type BlocoDoUsuario, type ChamadaFerramenta, type PedidoGeracao, type ProvedorIA, type RespostaGeracao, type TurnoIA, type UsoTokens } from './provedor';

/**
 * Plano 14B (RN-121, RN-124, D2, D4, D5): o laço de ferramentas, no worker. A conversa é SÓ DE INCLUSÃO: cada resposta do
 * provedor volta inteira no turno seguinte (o raciocínio dos modelos 5.5 fica preso à conversa — editar um turno o
 * invalida). Antes de cada volta confere, nesta ordem: voltas, prazo, `antesDaVolta` (a tarefa e a autorização, no
 * rascunho) e o custo — real somado + custo MÁXIMO da próxima ≤ teto. Nada de conteúdo em log (quem chama loga só números).
 */
export type LimitesDoLaco = { voltas: number; tetoMicroUsd: number; prazoMs: number };
type Base = { voltas: number; custoMicroUsd: number; uso: UsoTokens; requestId: string | null };
export type FimDoLaco = ({ tipo: 'final'; texto: string } | { tipo: 'parou'; motivo: MotivoFalha | 'recusa' | 'resposta_invalida'; recusaCategoria: string | null }) & Base;

/** O provedor falhou numa volta: leva o erro classificado, as voltas já feitas e o que elas custaram (o acerto é de quem chama). */
export class ErroNoLaco extends Error {
  override name = 'ErroNoLaco';
  constructor(
    readonly erro: ErroProvedor,
    readonly voltas: number,
    readonly custoMicroUsd: number,
    readonly uso: UsoTokens,
  ) {
    super(`laço: ${erro.tipo}`);
  }
}

const ZERO: UsoTokens = { entrada: 0, cacheLeitura: 0, cacheGravacao: 0, saida: 0, geo: null };
export const somarUso = (a: UsoTokens, b: UsoTokens): UsoTokens => ({
  entrada: a.entrada + b.entrada,
  cacheLeitura: a.cacheLeitura + b.cacheLeitura,
  cacheGravacao: a.cacheGravacao + b.cacheGravacao,
  saida: a.saida + b.saida,
  geo: b.geo ?? a.geo,
});
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

/** A entrada estimada da 1ª volta, em tokens: as instruções, as ferramentas, o schema e a mensagem inicial. */
const entradaDaPrimeiraVolta = (pedido: Omit<PedidoGeracao, 'turnos'>, inicio: string): number =>
  tokensDeBytes(bytes(pedido.sistema) + bytes(inicio) + bytes(JSON.stringify(pedido.ferramentas)) + bytes(JSON.stringify(pedido.schema)));

/**
 * O custo MÁXIMO da 1ª volta — a mesma conta com que o laço confere o teto antes de chamar o provedor. O portão do rascunho
 * a faz ANTES de marcar a saída: se nem a 1ª volta cabe no teto, nada sai e nada se registra como enviado (RN-101).
 */
export const custoMaximoDaPrimeiraVolta = (pedido: Omit<PedidoGeracao, 'turnos'>, inicio: string): number =>
  custoMaximoMicroUsd(pedido.modelo, pedido.geo, entradaDaPrimeiraVolta(pedido, inicio), pedido.maxTokens);

export async function rodarLaco(o: {
  provedor: ProvedorIA;
  pedido: Omit<PedidoGeracao, 'turnos'>;
  inicio: string;
  executar: (c: ChamadaFerramenta) => Promise<{ conteudo: string; erro?: true }>;
  antesDaVolta?: (volta: number) => Promise<MotivoFalha | null>;
  limites: LimitesDoLaco;
  relogio?: () => number;
}): Promise<FimDoLaco> {
  const relogio = o.relogio ?? Date.now;
  const comeco = relogio();
  const turnos: TurnoIA[] = [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: o.inicio }] }];
  // a 1ª volta: as instruções, as ferramentas, o schema e a mensagem inicial
  let entradaEstimada = entradaDaPrimeiraVolta(o.pedido, o.inicio);
  let custo = 0;
  let uso = ZERO;
  let requestId: string | null = null;
  const parou = (motivo: MotivoFalha | 'recusa' | 'resposta_invalida', voltas: number, recusaCategoria: string | null = null): FimDoLaco => ({
    tipo: 'parou',
    motivo,
    recusaCategoria,
    voltas,
    custoMicroUsd: custo,
    uso,
    requestId,
  });
  for (let volta = 1; ; volta++) {
    // o prazo esgotado usa o mesmo motivo (e o mesmo texto da US-122) do limite de voltas (D5)
    if (volta > o.limites.voltas || relogio() - comeco > o.limites.prazoMs) return parou('limite_voltas', volta - 1);
    const motivo = (await o.antesDaVolta?.(volta)) ?? null;
    if (motivo) return parou(motivo, volta - 1);
    if (custo + custoMaximoMicroUsd(o.pedido.modelo, o.pedido.geo, entradaEstimada, o.pedido.maxTokens) > o.limites.tetoMicroUsd) return parou('limite_custo', volta - 1);
    let r: RespostaGeracao;
    try {
      r = await o.provedor.gerar({ ...o.pedido, turnos: [...turnos] });
    } catch (e) {
      // erro que não veio classificado pelo provedor: pode ter saído — tratado como incerto (D4)
      throw new ErroNoLaco(e instanceof ErroProvedor ? e : new ErroProvedor('incerto', null, null), volta - 1, custo, uso);
    }
    custo += custoMicroUsd(o.pedido.modelo, o.pedido.geo, r.uso);
    uso = somarUso(uso, r.uso);
    requestId = r.requestId;
    if (r.tipo === 'final') return { tipo: 'final', texto: r.texto, voltas: volta, custoMicroUsd: custo, uso, requestId };
    if (r.tipo === 'recusa') return parou('recusa', volta, r.categoria);
    if (r.tipo === 'cortada') return parou('resposta_invalida', volta);
    turnos.push({ papel: 'assistente', bruto: r.bruto });
    const resultados: Extract<BlocoDoUsuario, { tipo: 'resultado' }>[] = [];
    for (const c of r.chamadas) {
      const x = await o.executar(c);
      resultados.push({ tipo: 'resultado', chamadaId: c.id, conteudo: x.conteudo, ...(x.erro ? { erro: true as const } : {}) });
    }
    turnos.push({ papel: 'usuario', blocos: resultados }); // todos os resultados num turno só (uso paralelo de ferramentas)
    // a próxima volta reenvia tudo o que esta leu e escreveu, mais os resultados das ferramentas
    entradaEstimada = r.uso.entrada + r.uso.cacheLeitura + r.uso.cacheGravacao + r.uso.saida + tokensDeBytes(resultados.reduce((n, b) => n + bytes(b.conteudo), 0));
  }
}
