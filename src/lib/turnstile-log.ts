import { logger } from './logger';
import type { FalhaTurnstile } from './turnstile';

/**
 * INT-06: o `onFalha` do verifyTurnstile no servidor (login/"Esqueci minha senha" e página pública de agendamento).
 * Só motivo, status e códigos vão ao log — nunca token, segredo, IP ou e-mail (CLAUDE.md regra 3). Segredo errado é
 * erro de configuração nosso (error); Cloudflare fora do ar é aviso (warn).
 */
export function registrarFalhaTurnstile({ motivo, status, codigos }: FalhaTurnstile): void {
  if (motivo === 'config') logger.error({ motivo, status, codigos }, 'Turnstile indisponível');
  else logger.warn({ motivo, status, codigos }, 'Turnstile indisponível');
}
