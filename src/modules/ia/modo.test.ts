import { describe, expect, it } from 'vitest';
import { configIA, estadoIaComPaciente, estadoIaDoTenant } from './modo';
import { IA_ADITIVO_VERSAO } from './textos-legais';

const base = { IA_MODELO_LEITURA: 'claude-opus-5-5' as const, IA_INFERENCE_GEO: 'us' as const, IA_TETO_GLOBAL_MENSAL_USD: 50 };
const tenant = { status: 'ativa', iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: IA_ADITIVO_VERSAO };

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

describe('Plano 14A — destino, retenção zero e estado com dado de paciente (RN-100, RN-109, A-D4)', () => {
  it('o destino vem do IA_PROVEDOR (inclusive na emergência); a retenção zero só com IA_RETENCAO_ZERO=1', () => {
    expect(configIA(base)).toMatchObject({ destino: null, retencaoZero: false });
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic' })).toMatchObject({ modo: 'anthropic', destino: 'anthropic-us' });
    expect(configIA({ ...base, IA_PROVEDOR: 'bedrock-eu', IA_DESLIGADA: '1' })).toMatchObject({ modo: 'emergencia', destino: 'bedrock-eu' });
    expect(configIA({ ...base, IA_PROVEDOR: 'sandbox', IA_RETENCAO_ZERO: '1' })).toMatchObject({ modo: 'sandbox', destino: 'teste', retencaoZero: true });
    expect(configIA({ ...base, IA_PROVEDOR: 'fake', IA_RETENCAO_ZERO: '0' }).retencaoZero).toBe(false);
  });

  it('D5: a região efetiva — eu no bedrock-eu (o IA_INFERENCE_GEO só vale para a API direta)', () => {
    expect(configIA({ ...base, IA_PROVEDOR: 'bedrock-eu' }).geo).toBe('eu');
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic' }).geo).toBe('us');
  });

  it('estadoIaComPaciente: o do consultório e, por cima, sem retenção zero = sem_retencao; o aditivo 0.1 não vale mais', () => {
    expect(estadoIaComPaciente(tenant, { modo: 'fake', retencaoZero: true })).toBe('ativa');
    expect(estadoIaComPaciente(tenant, { modo: 'fake', retencaoZero: false })).toBe('sem_retencao');
    expect(estadoIaComPaciente({ ...tenant, iaLiberada: false }, { modo: 'fake', retencaoZero: false })).toBe('nao_liberada');
    expect(estadoIaDoTenant({ ...tenant, iaAditivoVersao: '0.1-provisorio' }, 'bedrock-eu')).toBe('aditivo_desatualizado');
  });
});
