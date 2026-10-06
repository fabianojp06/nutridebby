import { describe, expect, it } from 'vitest';
import { configIA, estadoIaDoTenant } from './modo';

const base = { IA_MODELO_LEITURA: 'claude-opus-5-5' as const, IA_INFERENCE_GEO: 'us' as const, IA_TETO_GLOBAL_MENSAL_USD: 50 };
const tenant = { status: 'ativa', iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: '0.1-provisorio' };

describe('modo e estado da IA (spec v0.3 §5.9, RN-100)', () => {
  it('sem IA_PROVEDOR a IA não existe; IA_DESLIGADA=1 é a emergência; o teto vira micro-dólares', () => {
    expect(configIA(base)).toMatchObject({ modo: 'ausente', modelo: 'claude-opus-5-5', geo: 'us', tetoGlobalMicroUsd: 50_000_000 });
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic', IA_DESLIGADA: '1' }).modo).toBe('emergencia');
    expect(configIA({ ...base, IA_PROVEDOR: 'sandbox' }).modo).toBe('sandbox');
  });

  it('estado do consultório na ordem da RN-100', () => {
    expect(estadoIaDoTenant(tenant, 'ausente')).toBe('ausente');
    expect(estadoIaDoTenant(tenant, 'emergencia')).toBe('emergencia');
    expect(estadoIaDoTenant({ ...tenant, status: 'suspensa' }, 'anthropic')).toBe('suspensa');
    expect(estadoIaDoTenant({ ...tenant, iaLiberada: false }, 'anthropic')).toBe('nao_liberada');
    expect(estadoIaDoTenant({ ...tenant, iaAtivadaEm: null }, 'anthropic')).toBe('nao_ativada');
    expect(estadoIaDoTenant({ ...tenant, iaAditivoVersao: null }, 'anthropic')).toBe('aditivo_desatualizado');
    expect(estadoIaDoTenant(tenant, 'fake')).toBe('ativa');
  });
});
