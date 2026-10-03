import { describe, expect, it } from 'vitest';
import { PARAM_VINCULO, telaDoPortal } from './link-portal';

describe('telaDoPortal (links ao paciente levam o consultório)', () => {
  it('acrescenta ?v=<tenant> (ou &v= se já há query)', () => {
    const t = '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';
    expect(PARAM_VINCULO).toBe('v');
    expect(telaDoPortal('/p/plano', t)).toBe(`/p/plano?v=${t}`);
    expect(telaDoPortal('/p/plano?pdf=preparando', t)).toBe(`/p/plano?pdf=preparando&v=${t}`);
  });
});
