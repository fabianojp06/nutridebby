import { MSG_FALHA, MSG_IA } from '@/modules/ia/constantes';

/**
 * US-163 "Aceitar e ler, com a IA recusando o pedido": depois do aceite, a tela do prontuário mostra "Exame salvo no
 * prontuário." e a mensagem da US-110. Pela URL vai só a CHAVE de uma lista fechada (os textos de MSG_IA e MSG_FALHA);
 * a tela mostra o texto da lista — nunca o que veio na URL.
 */
const MENSAGENS: Record<string, string> = Object.fromEntries([
  ...Object.entries(MSG_IA).flatMap(([k, v]) => (typeof v === 'string' ? [[`ia.${k}`, v] as const] : [])),
  ...Object.entries(MSG_FALHA).map(([k, v]) => [`falha.${k}`, v] as const),
]);

export const chaveDaMensagemIa = (mensagem: string): string | null => Object.entries(MENSAGENS).find(([, v]) => v === mensagem)?.[0] ?? null;

export const mensagemIaDaChave = (chave: unknown): string | null => (typeof chave === 'string' && Object.hasOwn(MENSAGENS, chave) ? MENSAGENS[chave] : null);
