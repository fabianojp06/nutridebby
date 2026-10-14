import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import type { SituacaoAutorizacao } from '@/modules/ia/autorizacao';
import { MSG_IA } from '@/modules/ia/constantes';

// Revisão da T13 (rodada 1): o roteiro do manual do usuário (itens 17 e 18) diz quando a seção "Inteligência artificial"
// da página do paciente e o aviso da aba Plano alimentar aparecem. Este teste amarra essa regra ao código: a seção aparece
// em todo paciente ativo quando a IA existe, com o link ou com o motivo (os textos da aba Exames), e some só com o
// consultório liberado e a IA ainda não ativada, com o paciente que não está ativo, com o consultório suspenso ou sem IA.
const estado = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  situacao: { tipo: 'nunca' } as SituacaoAutorizacao,
  cota: { usadoMicroUsd: 0, cotaMicroUsd: 1, percentual: 0, nivel: 'ok' as 'ok' | 'aviso' | 'esgotada' },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getEnv: () => estado.env }));
vi.mock('@/modules/ia/autorizacao', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/ia/autorizacao')>()),
  situacaoIaDoPaciente: async () => estado.situacao,
}));
vi.mock('@/modules/ia/cota', () => ({ situacaoDaCotaIa: async () => estado.cota }));
const { iaDoAssistente } = await import('./ia-assistente');

const CTX = { tenantId: 't1', actorUserId: 'u1', ip: null } as unknown as TenantContext;
const PACIENTE = { id: 'p1', status: 'ativo' as const, anonimizadoEm: null };
const VIGENTE_11: SituacaoAutorizacao = {
  tipo: 'vigente', id: 'a1', em: new Date('2026-10-14T12:00:00Z'), canal: 'app', versao: '1.1', destino: 'teste',
  usos: ['leitura_laudos', 'resumo_historico', 'rascunho_plano'],
};
const tenant = (t: Partial<TenantRow> = {}) =>
  ({ status: 'ativa', iaLiberada: true, iaAtivadaEm: new Date('2026-10-10T12:00:00Z'), iaAditivoVersao: '1.1', fuso: 'America/Sao_Paulo', iaCotaMensalUsd: 10, ...t }) as TenantRow;

describe('iaDoAssistente: quando a seção de IA e o aviso aparecem (manual do usuário, itens 17 e 18)', () => {
  beforeEach(() => {
    estado.env = { IA_PROVEDOR: 'sandbox', IA_RETENCAO_ZERO: '1', IA_TETO_GLOBAL_MENSAL_USD: 100, IA_TETO_RASCUNHO_USD: 1 };
    estado.situacao = VIGENTE_11;
    estado.cota = { usadoMicroUsd: 0, cotaMicroUsd: 1, percentual: 0, nivel: 'ok' };
  });

  it.each(['resumo_historico', 'rascunho_plano'] as const)('%s: com tudo em ordem, o link (pode pedir)', async (uso) => {
    expect(await iaDoAssistente(CTX, tenant(), PACIENTE, uso)).toEqual({ podePedir: true, aviso: null });
  });

  it('consultório sem a liberação do suporte e IA ainda não ativada: aparece "A IA ainda não foi liberada…"', async () => {
    const t = tenant({ iaLiberada: false, iaAtivadaEm: null, iaAditivoVersao: null });
    expect(await iaDoAssistente(CTX, t, PACIENTE, 'resumo_historico')).toEqual({ podePedir: false, aviso: MSG_IA.naoLiberada });
    expect(await iaDoAssistente(CTX, t, PACIENTE, 'rascunho_plano')).toEqual({ podePedir: false, aviso: MSG_IA.naoLiberada });
  });

  it('consultório liberado e IA ainda não ativada: nada aparece', async () => {
    expect(await iaDoAssistente(CTX, tenant({ iaAtivadaEm: null, iaAditivoVersao: null }), PACIENTE, 'resumo_historico')).toBeNull();
  });

  it('aditivo 1.0 aceito: o aviso do aditivo', async () => {
    expect(await iaDoAssistente(CTX, tenant({ iaAditivoVersao: '1.0' }), PACIENTE, 'resumo_historico')).toEqual({ podePedir: false, aviso: MSG_IA.aditivoDesatualizado });
  });

  it('paciente que autorizou só a 1.0 (ou nunca autorizou): "Antes de usar a IA, peça a autorização…"', async () => {
    estado.situacao = { tipo: 'versao_antiga', id: 'a0', em: new Date('2026-10-10T12:00:00Z'), canal: 'app', versao: '1.0' };
    expect(await iaDoAssistente(CTX, tenant(), PACIENTE, 'rascunho_plano')).toEqual({ podePedir: false, aviso: MSG_IA.semAutorizacao });
    estado.situacao = { tipo: 'nunca' };
    expect(await iaDoAssistente(CTX, tenant(), PACIENTE, 'resumo_historico')).toEqual({ podePedir: false, aviso: MSG_IA.semAutorizacao });
  });

  it('paciente que retirou a autorização: "Este paciente retirou a autorização…"', async () => {
    estado.situacao = { tipo: 'retirada', id: 'a2', em: new Date('2026-10-12T12:00:00Z'), canal: 'app' };
    expect(await iaDoAssistente(CTX, tenant(), PACIENTE, 'resumo_historico')).toEqual({ podePedir: false, aviso: MSG_IA.retirouAutorizacao });
  });

  it('limite do mês esgotado: o aviso da cota', async () => {
    estado.cota = { usadoMicroUsd: 1, cotaMicroUsd: 1, percentual: 100, nivel: 'esgotada' };
    expect(await iaDoAssistente(CTX, tenant(), PACIENTE, 'rascunho_plano')).toEqual({ podePedir: false, aviso: MSG_IA.cotaAcabou });
  });

  it('IA desligada pelo suporte (IA_DESLIGADA): "A IA está indisponível no momento…"', async () => {
    estado.env = { ...estado.env, IA_DESLIGADA: '1' };
    expect(await iaDoAssistente(CTX, tenant(), PACIENTE, 'resumo_historico')).toEqual({ podePedir: false, aviso: MSG_IA.indisponivel });
  });

  it('nada aparece: IA ausente na plataforma, consultório suspenso ou paciente que não está ativo', async () => {
    expect(await iaDoAssistente(CTX, tenant({ status: 'suspensa' }), PACIENTE, 'resumo_historico')).toBeNull();
    expect(await iaDoAssistente(CTX, tenant(), { ...PACIENTE, status: 'bloqueado' }, 'resumo_historico')).toBeNull();
    estado.env = {};
    expect(await iaDoAssistente(CTX, tenant(), PACIENTE, 'resumo_historico')).toBeNull();
  });
});
