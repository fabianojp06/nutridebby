import { describe, expect, it } from 'vitest';
import { configIA, estadoIaComPaciente, estadoIaDoTenant } from './modo';
import { IA_ADITIVO_VERSAO } from './textos-legais';

const base = { IA_MODELO_LEITURA: 'claude-opus-5-5' as const, IA_MODELO_ASSISTENTE: 'claude-sonnet-5-5' as const, IA_INFERENCE_GEO: 'us' as const, IA_TETO_GLOBAL_MENSAL_USD: 50, IA_TETO_RASCUNHO_USD: 1 };
const tenant = { status: 'ativa', iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: IA_ADITIVO_VERSAO };

describe('modo e estado da IA (spec v0.3 §5.9, RN-100)', () => {
  it('sem IA_PROVEDOR a IA não existe; IA_DESLIGADA=1 é a emergência; o teto vira micro-dólares', () => {
    expect(configIA(base)).toMatchObject({ modo: 'ausente', modelo: 'claude-opus-5-5', geo: 'us', tetoGlobalMicroUsd: 50_000_000 });
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic', IA_DESLIGADA: '1' }).modo).toBe('emergencia');
    expect(configIA({ ...base, IA_PROVEDOR: 'sandbox' }).modo).toBe('sandbox');
  });

  it('configIA: modelo do assistente e teto do rascunho em micro-dólares (Plano 14B)', () => {
    const c = configIA({ IA_PROVEDOR: 'sandbox', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_MODELO_ASSISTENTE: 'claude-sonnet-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50, IA_TETO_RASCUNHO_USD: 1 });
    expect(c.modeloAssistente).toBe('claude-sonnet-5-5');
    expect(c.tetoRascunhoMicroUsd).toBe(1_000_000);
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

  it('Plano 15 (D27, DP-3): o aditivo 1.2 não pede novo aceite das outras funções — quem aceitou a 1.1 continua ativa; a 1.0 não', () => {
    expect(estadoIaDoTenant({ ...tenant, iaAditivoVersao: '1.1' }, 'anthropic')).toBe('ativa');
    expect(estadoIaDoTenant({ ...tenant, iaAditivoVersao: '1.2' }, 'anthropic')).toBe('ativa');
    expect(estadoIaDoTenant({ ...tenant, iaAditivoVersao: '1.0' }, 'anthropic')).toBe('aditivo_desatualizado');
  });
});

describe('Plano 14A — destino, retenção zero e estado com dado de paciente (RN-100, RN-109, A-D4)', () => {
  it('o destino vem do IA_PROVEDOR (inclusive na emergência); a retenção zero só com IA_RETENCAO_ZERO=1', () => {
    expect(configIA(base)).toMatchObject({ destino: null, retencao: null });
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic' })).toMatchObject({ modo: 'anthropic', destino: 'anthropic-us', retencao: null });
    expect(configIA({ ...base, IA_PROVEDOR: 'bedrock-eu', IA_DESLIGADA: '1' })).toMatchObject({ modo: 'emergencia', destino: 'bedrock-eu' });
    expect(configIA({ ...base, IA_PROVEDOR: 'sandbox', IA_RETENCAO_ZERO: '1' })).toMatchObject({ modo: 'sandbox', destino: 'teste', retencao: 'zero' });
    expect(configIA({ ...base, IA_PROVEDOR: 'fake', IA_RETENCAO_ZERO: '0' }).retencao).toBeNull();
    expect('retencaoZero' in configIA(base)).toBe(false); // A-D27: a retenção de 30 dias nunca passa por retenção zero
  });

  it.each([
    // provedor × variável: A-D27 (dono, 09/10/2026) — a Anthropic direta aceita a retenção de até 30 dias; o Bedrock continua exigindo a zero
    ['anthropic', { IA_RETENCAO_ZERO: '1' }, 'zero'],
    ['anthropic', { IA_RETENCAO_ACEITA_30_DIAS: '1' }, '30-dias'],
    ['anthropic', { IA_RETENCAO_ZERO: '1', IA_RETENCAO_ACEITA_30_DIAS: '1' }, 'zero'],
    ['anthropic', { IA_RETENCAO_ACEITA_30_DIAS: '0' }, null],
    ['bedrock-eu', { IA_RETENCAO_ZERO: '1' }, 'zero'],
    ['bedrock-eu', { IA_RETENCAO_ACEITA_30_DIAS: '1' }, null],
    ['sandbox', { IA_RETENCAO_ACEITA_30_DIAS: '1' }, null],
  ] as const)('A-D27: %s com %o → retenção %s', (provedor, vars, retencao) => {
    const ia = configIA({ ...base, IA_PROVEDOR: provedor, ...vars });
    expect(ia.retencao).toBe(retencao);
    expect(estadoIaComPaciente(tenant, ia)).toBe(retencao ? 'ativa' : 'sem_retencao');
  });

  it('D5: a região efetiva — eu no bedrock-eu (o IA_INFERENCE_GEO só vale para a API direta)', () => {
    expect(configIA({ ...base, IA_PROVEDOR: 'bedrock-eu' }).geo).toBe('eu');
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic' }).geo).toBe('us');
  });

  it('estadoIaComPaciente: o do consultório e, por cima, sem retenção zero = sem_retencao; o aditivo 0.1 não vale mais', () => {
    expect(estadoIaComPaciente(tenant, { modo: 'fake', retencao: 'zero' })).toBe('ativa');
    expect(estadoIaComPaciente(tenant, { modo: 'anthropic', retencao: '30-dias' })).toBe('ativa');
    expect(estadoIaComPaciente(tenant, { modo: 'fake', retencao: null })).toBe('sem_retencao');
    expect(estadoIaComPaciente({ ...tenant, iaLiberada: false }, { modo: 'fake', retencao: null })).toBe('nao_liberada');
    expect(estadoIaDoTenant({ ...tenant, iaAditivoVersao: '0.1-provisorio' }, 'bedrock-eu')).toBe('aditivo_desatualizado');
  });
});

describe('Plano 15 (D5, RN-185) — o modelo da IA Nutri do paciente e a segunda barreira', () => {
  it('IA_MODELO_PACIENTE e IA_NUTRI_DESLIGADA=1 chegam à configuração', () => {
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic', IA_MODELO_PACIENTE: 'claude-haiku-5-5', IA_NUTRI_DESLIGADA: '1' })).toMatchObject({ modeloPaciente: 'claude-haiku-5-5', nutriDesligada: true });
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic', IA_MODELO_PACIENTE: 'claude-sonnet-5-5', IA_NUTRI_DESLIGADA: '0' })).toMatchObject({ modeloPaciente: 'claude-sonnet-5-5', nutriDesligada: false });
  });

  it('sem IA_NUTRI_DESLIGADA a IA Nutri não está desligada pela variável', () => {
    expect(configIA(base).nutriDesligada).toBe(false);
    expect(configIA({ ...base, IA_PROVEDOR: 'sandbox' }).nutriDesligada).toBe(false);
  });

  it.each([
    [undefined, 'claude-haiku-5-5'],
    ['anthropic', 'claude-haiku-5-5'],
    ['sandbox', 'claude-haiku-5-5'],
    ['fake', 'claude-haiku-5-5'],
    ['bedrock-eu', 'claude-sonnet-5-5'],
  ] as const)('sem IA_MODELO_PACIENTE, o padrão com IA_PROVEDOR=%s é %s (o Haiku 5.5 fora do perfil eu.)', (provedor, modelo) => {
    expect(configIA({ ...base, ...(provedor ? { IA_PROVEDOR: provedor } : {}) }).modeloPaciente).toBe(modelo);
  });
});
