/**
 * SUS-119: o relógio do app. Em produção (e sempre que `E2E_AGORA` não está definida), `agora()` é `new Date()`.
 *
 * Só no E2E, `E2E_AGORA` desloca o relógio do que o **app** decide pelo `agora()` (ex.: "hoje é aniversário?", "o
 * pedido já venceu?"), para testar a qualquer hora o que depende do dia ou da hora. Dois formatos:
 *
 * - instante ISO 8601 **com fuso** (ex.: `2026-12-01T08:00:00-03:00`): o relógio começa nesse instante no primeiro uso
 *   do processo e **segue andando** (deslocamento = instante − relógio real no primeiro uso);
 * - deslocamento relativo ao relógio real: `+36h`, `-2d`, `+90m` (sinal obrigatório; `m` minutos, `h` horas, `d` dias).
 *
 * Por que o relógio anda (e não congela no instante): sessões, prazos de link, `setTimeout`, o pg-boss e o
 * `clock_timestamp()` do banco continuam no relógio real; um relógio parado faria "depois" nunca chegar no app e
 * misturaria durações reais com um "agora" fixo. O E2E só desloca o que o app decide pelo `agora()`.
 *
 * Limite: o banco **não** é deslocado — `now()`, `clock_timestamp()`, `app_hoje_do_tenant()` e os gatilhos que conferem
 * prazos seguem no relógio real. O E2E deve escolher instantes coerentes com isso (ex.: só vencer pelo app um prazo que
 * também já venceu no relógio real do banco).
 *
 * Recusada em produção de verdade (`emProducao` em `src/env.ts`, como o `SESSAO_TESTE_MS`): o app e o worker não sobem.
 * Módulo puro (sem import de servidor): pode ir para o cliente, onde `agora()` é sempre `new Date()` — `process.env` só é
 * lido no servidor.
 */

/** O relógio pedido pela `E2E_AGORA`: um instante fixo de partida ou um deslocamento fixo do relógio real. */
export type RelogioDoE2e = { tipo: 'instante'; em: number } | { tipo: 'deslocamento'; ms: number };

export const MENSAGEM_E2E_AGORA = 'E2E_AGORA deve ser um instante ISO 8601 com fuso (ex.: 2026-12-01T08:00:00-03:00) ou um deslocamento (ex.: +36h, -2d, +90m)';

const ISO_COM_FUSO = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const RELATIVO = /^([+-])(\d{1,6})([mhd])$/;
const MS_DA_UNIDADE = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Interpreta o valor da `E2E_AGORA`; `null` quando inválido. Puro (o `src/env.ts` valida com ele). */
export function lerE2eAgora(valor: string): RelogioDoE2e | null {
  const rel = RELATIVO.exec(valor);
  if (rel) {
    const ms = Number(rel[2]) * MS_DA_UNIDADE[rel[3] as keyof typeof MS_DA_UNIDADE];
    return { tipo: 'deslocamento', ms: rel[1] === '-' ? -ms : ms };
  }
  const iso = ISO_COM_FUSO.exec(valor);
  if (!iso) return null;
  // O Date.parse aceita 30/02 e o leva a 02/03 em silêncio: a data precisa existir no calendário
  const [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  const em = Date.parse(valor);
  return Number.isNaN(em) ? null : { tipo: 'instante', em };
}

/** O deslocamento do relógio do E2E em relação ao real, calculado no primeiro uso de cada valor da variável. */
let calculado: { valor: string; ms: number } | undefined;

function deslocamentoDoE2e(valor: string): number {
  if (calculado?.valor === valor) return calculado.ms;
  const relogio = lerE2eAgora(valor);
  if (!relogio) throw new Error(`Configuração inválida — E2E_AGORA: ${MENSAGEM_E2E_AGORA}`);
  const ms = relogio.tipo === 'deslocamento' ? relogio.ms : relogio.em - Date.now();
  calculado = { valor, ms };
  return ms;
}

/** O "agora" do app: `new Date()`, salvo no E2E com `E2E_AGORA` (só no servidor; veja o comentário do módulo). */
export function agora(): Date {
  if (typeof window !== 'undefined') return new Date();
  const valor = process.env.E2E_AGORA;
  if (!valor) return new Date();
  return new Date(Date.now() + deslocamentoDoE2e(valor));
}
