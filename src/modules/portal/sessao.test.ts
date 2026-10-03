import { describe, expect, it } from 'vitest';
import { pacienteDaSessao } from './sessao';

const T = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';

describe('pacienteDaSessao', () => {
  it('devolve o patientId da sessão de paciente', () => {
    expect(pacienteDaSessao({ tenantId: T, role: 'paciente', patientId: P }, 'x')).toBe(P);
  });
  it('lança para outro papel ou sem patientId, citando quem pediu', () => {
    expect(() => pacienteDaSessao({ tenantId: T, role: 'nutri', patientId: P }, 'planoDoPaciente')).toThrow('planoDoPaciente só roda em sessão de paciente');
    expect(() => pacienteDaSessao({ tenantId: T, role: 'paciente' }, 'x')).toThrow();
  });
});
