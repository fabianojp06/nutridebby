/**
 * SUS-119: o relógio do app. Em produção (e sempre que `E2E_AGORA` não está definida), `agora()` é `new Date()`.
 *
 * Só no E2E, `E2E_AGORA` desloca o relógio do que o **app** decide pelo `agora()` (ex.: "hoje é aniversário?", "o
 * pedido já venceu?"), para testar a qualquer hora o que depende do dia ou da hora. O formato é **só deslocamento**
 * do relógio real, com sinal obrigatório: `+36h`, `-2d`, `+90m`, `+45s` (`s` segundos, `m` minutos, `h` horas, `d` dias;
 * até 9 dígitos e até 100 anos para qualquer lado).
 *
 * Por que só deslocamento: ele é igual em todo processo. Um instante de partida exigiria medir "instante − relógio real"
 * em algum momento, e cada processo (o app, o worker, cada camada do Next, um worker reiniciado) mediria no seu, com
 * relógios diferentes entre si. Para **começar num instante**, quem lança o app e o worker (o `playwright.config.ts`, na
 * parte 2 do SUS-119) chama `deslocamentoAte(instante)` **uma vez** e passa o mesmo valor aos dois processos.
 *
 * Por que o relógio anda (e não congela): sessões, prazos de link, `setTimeout`, o pg-boss e o `clock_timestamp()` do
 * banco continuam no relógio real; um relógio parado faria "depois" nunca chegar no app e misturaria durações reais com
 * um "agora" fixo. O E2E só desloca o que o app decide pelo `agora()`.
 *
 * Limite: o banco **não** é deslocado — `now()`, `clock_timestamp()` e os gatilhos que conferem prazos (ex.:
 * `appointments_regras_pedido`, 0131, prazo do pedido) seguem no relógio real. O E2E deve escolher deslocamentos
 * coerentes com isso (ex.: só vencer pelo app um prazo que também já venceu no relógio real do banco).
 *
 * Por enquanto nada chama `agora()`: a adoção nos caminhos do aniversário e do "não confirmado" vem com o Plano 23 PR 3
 * (Sessão C), e o E2E que usa a `E2E_AGORA`, na parte 2 do SUS-119.
 *
 * Recusada em produção de verdade (`emProducao` em `src/env.ts`, como o `SESSAO_TESTE_MS`): o app e o worker não sobem.
 * Módulo puro (sem import de servidor). No navegador (e num service worker, sem `process`) `agora()` é sempre o relógio
 * real: componente cliente **não** chama `agora()` no render — recebe o "agora" do servidor por prop, para não dar
 * diferença de hidratação.
 */

/** Mensagem do formato (sem o nome da variável: o `src/env.ts` e o `agora()` já o põem na frente). */
export const MENSAGEM_E2E_AGORA = 'deve ser um deslocamento do relógio real com sinal (ex.: +36h, -2d, +90m, +45s); para começar num instante, use deslocamentoAte()';

const DESLOCAMENTO = /^([+-])(\d{1,9})([smhd])$/;
const MS_DA_UNIDADE = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
/** 100 anos: além disso o `Date` deslocado pode sair da faixa válida (`Invalid Date`). */
const LIMITE_MS = 100 * 365.25 * 86_400_000;

/** O deslocamento da `E2E_AGORA` em ms; `null` quando inválido. Puro (o `src/env.ts` valida com ele). */
export function lerE2eAgora(valor: string): number | null {
  const d = DESLOCAMENTO.exec(valor);
  if (!d) return null;
  const ms = Number(d[2]) * MS_DA_UNIDADE[d[3] as keyof typeof MS_DA_UNIDADE];
  if (ms > LIMITE_MS) return null;
  return d[1] === '-' ? -ms : ms;
}

const ISO_COM_FUSO = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/**
 * Para o lançador do app e do worker: o valor da `E2E_AGORA` que leva o relógio a `instante` (ISO 8601 **com fuso**,
 * ex.: `2026-12-01T08:00:00-03:00`) agora, no relógio real `real`. Devolve o deslocamento em segundos (`+NNNs`/`-NNNs`,
 * arredondado ao segundo mais próximo). Chame **uma vez** e passe o mesmo valor aos dois processos. Instante inválido
 * (sem fuso, data inexistente) ou longe demais do relógio real → erro.
 */
export function deslocamentoAte(instante: string, real: number = Date.now()): string {
  const iso = ISO_COM_FUSO.exec(instante);
  // O Date.parse aceita 30/02 e o leva a 02/03 em silêncio: a data precisa existir no calendário
  const [ano, mes, dia] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [0, 0, 0];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const existe = iso && data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
  const em = existe ? Date.parse(instante) : NaN;
  if (Number.isNaN(em)) {
    throw new Error('Instante inválido para o relógio do E2E: use ISO 8601 com fuso e data existente (ex.: 2026-12-01T08:00:00-03:00)');
  }
  const segundos = Math.round(Math.abs(em - real) / 1_000);
  const valor = `${em < real && segundos > 0 ? '-' : '+'}${segundos}s`;
  if (lerE2eAgora(valor) === null) {
    throw new Error('Instante inválido para o relógio do E2E: longe demais do relógio real (até 999999999 s)');
  }
  return valor;
}

/** O "agora" do app: `new Date()`, salvo no E2E com `E2E_AGORA` (só no servidor; veja o comentário do módulo). */
export function agora(): Date {
  if (typeof window !== 'undefined' || typeof process === 'undefined') return new Date();
  const valor = process.env.E2E_AGORA;
  if (!valor) return new Date();
  const ms = lerE2eAgora(valor);
  if (ms === null) throw new Error(`Configuração inválida — E2E_AGORA: ${MENSAGEM_E2E_AGORA}`);
  return new Date(Date.now() + ms);
}
