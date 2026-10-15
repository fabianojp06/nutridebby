import { describe, expect, it } from 'vitest';
import { IA_TESTE } from '../../../../test/ia';
import { PAUSADA, SEM_PAUSA } from '../../../../test/ia-nutri';
import type { TenantRow } from '@/db/schema';
import type { ConfigIA } from '../modo';
import { consentimentoVigente, estadoIaNutriDoTenant } from './estado';

const tenantBase = { status: 'ativa', iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: '1.2', iaNutriAtivadaEm: new Date() } as TenantRow;
const ia = { ...IA_TESTE, nutriDesligada: false };

describe('estadoIaNutriDoTenant (RN-170, §7.2) — sem banco', () => {
  it.each([
    [{}, ia, SEM_PAUSA, 'ativa'],
    [{ iaNutriAtivadaEm: null }, ia, SEM_PAUSA, 'desativada'],
    [{ iaAditivoVersao: '1.1' }, ia, SEM_PAUSA, 'aditivo_desatualizado'],
    [{ iaAditivoVersao: '1.0' }, ia, SEM_PAUSA, 'sem_ia'],
    [{ iaLiberada: false }, ia, SEM_PAUSA, 'sem_ia'],
    [{ status: 'suspensa' }, ia, SEM_PAUSA, 'sem_ia'],
    [{ iaAtivadaEm: null }, ia, SEM_PAUSA, 'sem_ia'],
    [{}, { ...ia, retencao: null }, SEM_PAUSA, 'sem_ia'],
    [{}, { ...ia, modo: 'ausente' }, SEM_PAUSA, 'sem_ia'],
    [{}, ia, PAUSADA, 'pausada'],
    [{}, { ...ia, nutriDesligada: true }, SEM_PAUSA, 'pausada'],
    [{}, { ...ia, modo: 'emergencia' }, SEM_PAUSA, 'pausada'],
    [{}, { ...ia, destino: null }, SEM_PAUSA, 'pausada'],
    // a pausa vem antes do aditivo e da ativação (a ordem em que a tela explica)
    [{ iaAditivoVersao: '1.1', iaNutriAtivadaEm: null }, ia, PAUSADA, 'pausada'],
  ])('%o → %s', (extra, cfg, pausa, esperado) => expect(estadoIaNutriDoTenant({ ...tenantBase, ...extra } as TenantRow, cfg as ConfigIA, pausa)).toBe(esperado));
});

describe('consentimentoVigente (DP-2, US-171 "Nova versão") — sem banco', () => {
  const ev = (o: Partial<{ evento: 'aceite' | 'revogacao'; versao: string | null; destino: string | null }> = {}) => ({
    id: 'e1', evento: 'aceite' as const, versao: '1.0', destino: 'teste', registradoEm: new Date('2026-10-14T12:00:00Z'), ...o,
  });
  it('só o aceite da versão mínima no destino de agora', () => {
    expect(consentimentoVigente(ev(), 'teste')).toBe(true);
    expect(consentimentoVigente(null, 'teste')).toBe(false);
    expect(consentimentoVigente(ev({ evento: 'revogacao', versao: null, destino: null }), 'teste')).toBe(false);
    expect(consentimentoVigente(ev({ destino: 'anthropic-us' }), 'teste')).toBe(false);
    expect(consentimentoVigente(ev(), null)).toBe(false);
    expect(consentimentoVigente(ev({ versao: '0.1-provisorio' }), 'teste')).toBe(false);
    expect(consentimentoVigente(ev({ versao: '1.1' }), 'teste')).toBe(true);
  });
});
