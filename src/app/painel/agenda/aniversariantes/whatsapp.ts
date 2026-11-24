import { MSG_ANIVERSARIO } from '@/modules/agenda/constantes';

/**
 * Plano 23 (RN-435, US-413 "Abrir no WhatsApp", PL-21): o único dono da URL `wa.me` do aniversário. Puro, montado no
 * navegador da nutricionista com o texto fixo da RN-435 — sem rodapé e sem link (nem o de saída, credencial do titular;
 * INT-01). O sistema não envia, não grava e não gasta cota (C-405).
 */
export function urlWhatsappAniversario(telefoneE164: string, primeiroNome: string, nutri: string): string {
  const numero = telefoneE164.replace(/\D/g, '');
  return `https://wa.me/${numero}?text=${encodeURIComponent(MSG_ANIVERSARIO.mensagem(primeiroNome, nutri))}`;
}
