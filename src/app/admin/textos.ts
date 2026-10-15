/**
 * Plano 15 (RN-185, DP-1, ★ DO-1 = não, ★ DO-5): as confirmações de "Pausar" e "Retomar" a IA Nutri em Admin › Servidor.
 * A pausa é só o DESLIGAMENTO DE EMERGÊNCIA (a IA Nutri liga pela nutricionista) e "Retomar" é a volta dela — não a
 * liberação inicial: a confirmação não lista condição nenhuma do runbook, só pede que o motivo da pausa esteja resolvido.
 * Fora do `actions.ts` ('use server' só exporta funções assíncronas).
 */
export const CONFIRMAR_PAUSAR_IA_NUTRI =
  'Pausar a IA Nutri em todos os consultórios? É o desligamento de emergência: a partir da próxima pergunta, nenhum paciente usa a IA Nutri até você retomar. As dúvidas já enviadas continuam na fila das nutricionistas, e os pacientes continuam podendo ler as conversas e desativar a IA Nutri em Eu › Privacidade.';
export const CONFIRMAR_RETOMAR_IA_NUTRI =
  'Retomar a IA Nutri em todos os consultórios? Ela volta a responder aos pacientes liberados e que consentiram, nos consultórios que a ativaram. Retome só depois de resolver o motivo da pausa.';
