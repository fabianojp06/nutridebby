import { NOME_IA_NUTRI, type CategoriaConversa, type TipoResposta } from './constantes';

/** Plano 15 (US-173, US-174, US-172, US-176, DP-4): os textos fixos — o banco guarda o código (`texto_fixo`); a tela traduz aqui. */
export type CodigoTextoFixo =
  | 'risco_emergencia' | 'risco_transtorno' | 'sintoma_agudo'
  | 'fora_do_escopo' | 'mudanca_plano' | 'sintoma_ou_exame' | 'suplemento_ou_remedio' | 'peso_ou_dieta_restritiva'
  | 'nao_encontrei' | 'falha' | 'indisponivel';
export const TEXTOS_FIXOS: Record<CodigoTextoFixo, string> = {
  risco_emergencia: 'Sinto muito que você esteja passando por isso. Eu não consigo ajudar com isso, mas você não precisa passar por isso sozinho(a). Se você está pensando em se machucar ou corre perigo agora, ligue para o CVV no 188 (gratuito, 24 horas por telefone; também há chat em cvv.org.br) ou para o SAMU no 192, ou vá ao pronto-socorro mais próximo.',
  sintoma_agudo: 'Esses sinais precisam de atendimento médico agora. Ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo. Eu não consigo avaliar sintomas.',
  risco_transtorno: 'Que bom que você contou. Esse assunto é importante e precisa ser conversado com a sua nutricionista, não comigo. Sua mensagem foi enviada ao consultório, que não acompanha as mensagens em tempo real e não atende emergências. Se você sentir que está em perigo, ligue para o CVV no 188 (gratuito, 24 horas por telefone) ou para o SAMU no 192.',
  fora_do_escopo: 'Não consigo responder isso. Eu só tiro dúvidas sobre o seu plano alimentar e as orientações da sua nutricionista. Quer enviar essa pergunta para ela?',
  mudanca_plano: 'Não posso mudar o seu plano. Só a sua nutricionista pode fazer isso. Quer enviar esse pedido para ela?',
  sintoma_ou_exame: 'Não posso avaliar sintomas ou exames nem fazer diagnóstico. Quer enviar essa pergunta para sua nutricionista?',
  suplemento_ou_remedio: 'Não posso indicar suplementos, fitoterápicos ou remédios. Quer enviar essa pergunta para sua nutricionista?',
  // D33: o mesmo para todos, sem "peso", "calorias" nem "jejum" (RN-203, RN-214 da spec G)
  peso_ou_dieta_restritiva: 'Essa é uma conversa para ter com a sua nutricionista. Quer enviar a pergunta para ela?',
  nao_encontrei: 'Não encontrei isso no seu plano. Quer enviar essa pergunta para sua nutricionista?',
  falha: 'Não consegui responder agora. Tente de novo em alguns minutos ou envie sua dúvida para sua nutricionista.',
  indisponivel: `A ${NOME_IA_NUTRI} está indisponível no momento. Você pode enviar sua dúvida para sua nutricionista.`,
};
/** Os textos fixos que aparecem com o botão "Enviar para minha nutricionista" (US-174, US-172 "Falha", US-176 "Cota"). */
export const COM_ENCAMINHAR: ReadonlySet<CodigoTextoFixo> = new Set(['fora_do_escopo', 'mudanca_plano', 'sintoma_ou_exame', 'suplemento_ou_remedio', 'peso_ou_dieta_restritiva', 'nao_encontrei', 'falha', 'indisponivel']);
/** US-174: o texto fixo de cada categoria que não é `plano`; `risco` do modelo → o de transtorno alimentar (US-173). */
export const TEXTO_DA_CATEGORIA: Record<Exclude<CategoriaConversa, 'plano'>, CodigoTextoFixo> = {
  fora_do_escopo: 'fora_do_escopo', mudanca_plano: 'mudanca_plano', sintoma_ou_exame: 'sintoma_ou_exame',
  suplemento_ou_remedio: 'suplemento_ou_remedio', peso_ou_dieta_restritiva: 'peso_ou_dieta_restritiva', risco: 'risco_transtorno',
};
/** RN-172: a frase fixa de cada tipo e a frase final — nenhuma soa como sim ou não (revisão de 09/10/2026). */
export const FRASE_DO_TIPO: Record<TipoResposta, string> = {
  quantidade: 'No seu plano está assim:',
  substituicao: 'No seu plano, as opções de substituição são:',
  horario: 'No seu plano, o horário é:',
  refeicao: 'No seu plano, essa refeição tem:',
  orientacao: 'Sua nutricionista escreveu esta orientação:',
};
export const FRASE_FINAL = 'Isto é o que está escrito no seu plano. Se a sua dúvida é se pode fazer diferente por causa de um sintoma ou situação de hoje, envie para sua nutricionista.';
