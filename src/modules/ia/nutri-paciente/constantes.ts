/**
 * Plano 15 (IA Nutri do paciente): constantes sem imports de banco. A T4 cria só as três que o texto do consentimento e o
 * aditivo 1.2 citam; a T6 completa o arquivo (autores, situações, limites, prazos).
 */

/** D28: a Debby escolhe o nome; até lá, "IA Nutri" (★ DO-4). Um lugar só: trocar o nome sobe a versão do consentimento (DP-2). */
export const NOME_IA_NUTRI = 'IA Nutri';
/** D8 = (b): as conversas ficam guardadas na plataforma por 180 dias e depois são apagadas. */
export const RETENCAO_DIAS = 180;
/** D22 (teto proposto, a confirmar com o advogado): a mensagem com sinal de risco de quem desativou, até a nutricionista ler. */
export const RISCO_REVOGADO_MAX_DIAS = 30;
