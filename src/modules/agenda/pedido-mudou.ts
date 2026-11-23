import { MSG_SOLICITACOES } from './constantes';

/**
 * Plano 23 (US-409): o pedido venceu ou já foi respondido (em outra aba, pela varredura, pelo paciente) entre a tela e a
 * ação. Arquivo próprio (T7): `solicitacoes.ts` (consulta) e `agendamento-publico.ts` (pessoa nova, `aceitarPedidoPublico`)
 * lançam o mesmo erro sem um importar o outro em ciclo; `solicitacoes.ts` reexporta.
 */
export class PedidoMudouError extends Error {
  override name = 'PedidoMudouError';
  constructor() {
    super(MSG_SOLICITACOES.mudou);
  }
}
