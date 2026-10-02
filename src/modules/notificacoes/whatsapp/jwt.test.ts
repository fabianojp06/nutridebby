import { describe, expect, it } from 'vitest';
import { chaveDoWebhook } from './jwt';

describe('chave do webhook por instância (D4 a)', () => {
  it('uma chave por instância, estável, sem o segredo-mestre dentro', () => {
    const S = 's'.repeat(40);
    const a = chaveDoWebhook(S, 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f');
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(chaveDoWebhook(S, 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).toBe(a);
    expect(chaveDoWebhook(S, 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70')).not.toBe(a);
    expect(chaveDoWebhook('t'.repeat(40), 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).not.toBe(a);
    expect(a).not.toContain(S.slice(0, 8));
  });
});
