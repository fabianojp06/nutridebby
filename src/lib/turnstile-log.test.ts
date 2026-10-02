import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';
import { registrarFalhaTurnstile } from './turnstile-log';

afterEach(() => vi.restoreAllMocks());

describe('registrarFalhaTurnstile (INT-06, CLAUDE.md regra 3)', () => {
  it('configuração errada é error; Cloudflare fora do ar é warn; só motivo, status e códigos', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    registrarFalhaTurnstile({ motivo: 'config', status: 400, codigos: ['invalid-input-secret'] });
    registrarFalhaTurnstile({ motivo: 'timeout' });
    expect(error).toHaveBeenCalledWith({ motivo: 'config', status: 400, codigos: ['invalid-input-secret'] }, 'Turnstile indisponível');
    expect(warn).toHaveBeenCalledWith({ motivo: 'timeout', status: undefined, codigos: undefined }, 'Turnstile indisponível');
  });
});
