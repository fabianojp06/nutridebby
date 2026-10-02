/** D1: tudo o que o NutriDebby pede ao WhatsApp, independente do provedor (Evolution, sandbox, falso nos testes). */
export type EnvioTexto = { instancia: string; numero: string; texto: string };
export type CodigoFalha = 'numero_sem_whatsapp' | 'recusado' | 'nao_autorizado' | 'instancia_inexistente' | 'indisponivel' | 'sem_resposta' | 'resposta_invalida';
/** `definitivo`: não adianta tentar de novo — ou não se sabe se saiu (timeout), e repetir poderia duplicar (D6). */
export type ResultadoEnvio = { ok: true; id: string; jid: string } | { ok: false; definitivo: boolean; codigo: CodigoFalha };
export type EstadoConexao = 'conectada' | 'conectando' | 'desconectada';
export type Conexao = { estado: 'conectada' } | { estado: 'qr'; qr: string };

export interface ProvedorWhatsapp {
  readonly nome: 'evolution' | 'sandbox' | 'fake';
  enviarTexto(e: EnvioTexto): Promise<ResultadoEnvio>;
  /** Cria a instância se faltar, (re)configura o webhook e devolve o QR — ou "conectada". */
  conectar(instancia: string): Promise<Conexao>;
  /** null = o provedor não informa (sandbox: o estado muda pelo webhook). */
  estado(instancia: string): Promise<{ estado: EstadoConexao; numero: string | null } | null>;
  desconectar(instancia: string): Promise<void>;
}

/** Serviço do WhatsApp fora do ar ou recusando (mensagem sem chave, número nem QR). */
export class WhatsappIndisponivelError extends Error {
  override name = 'WhatsappIndisponivelError';
}

export const digitosDoE164 = (e164: string) => e164.replace(/^\+/, '');
/** '5511912345678@s.whatsapp.net' (ou ':1@…' de aparelho) → '5511912345678'. */
export const digitosDoJid = (jid: string) => jid.split('@')[0].split(':')[0];
export function e164DoJid(jid: string): string | null {
  const d = digitosDoJid(jid);
  return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
}
