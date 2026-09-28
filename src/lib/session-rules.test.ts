import { describe, expect, it } from 'vitest';
import {
  capSessionExpiry,
  evaluateSession,
  homeFor,
  isRefreshDue,
  PATIENT_SESSION_MS,
  SESSION_REFRESH_MS,
  sessionExpiresAt,
  STAFF_IDLE_MS,
} from './session-rules';

const now = new Date('2026-10-01T12:00:00Z');
const recent = new Date(now.getTime() - 60_000);
const idle = new Date(now.getTime() - STAFF_IDLE_MS - 1);
const base = { now, path: '/admin', allowed: ['admin'] as const };

describe('evaluateSession (RNF-06, US-002, US-003)', () => {
  it('sem sessão → login', () => {
    expect(evaluateSession({ ...base, session: null, user: null })).toBe('login');
  });
  it('sem sessão mas com cookie (sessão expirada e apagada) → expired', () => {
    expect(evaluateSession({ ...base, session: null, user: null, hasSessionCookie: true })).toBe('expired');
  });
  it('papel fora da lista → forbidden', () => {
    expect(evaluateSession({ ...base, session: { updatedAt: recent }, user: { appRole: 'nutri', twoFactorEnabled: true } })).toBe('forbidden');
  });
  it('nutri inativa há mais de 12 h → expired', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: { updatedAt: idle }, user: { appRole: 'nutri', twoFactorEnabled: false } })).toBe('expired');
  });
  it('paciente inativo há mais de 12 h continua ok (limite é 30 dias, no expiresAt)', () => {
    expect(evaluateSession({ now, path: '/p/inicio', allowed: ['paciente'], session: { updatedAt: idle }, user: { appRole: 'paciente', twoFactorEnabled: false } })).toBe('ok');
  });
  it('admin sem 2FA → setup-2fa, exceto na própria tela de segurança', () => {
    const user = { appRole: 'admin', twoFactorEnabled: false };
    expect(evaluateSession({ ...base, session: { updatedAt: recent }, user })).toBe('setup-2fa');
    expect(evaluateSession({ now, path: '/conta/seguranca', allowed: ['admin', 'nutri'], session: { updatedAt: recent }, user })).toBe('ok');
  });
  it('admin com 2FA → ok', () => {
    expect(evaluateSession({ ...base, session: { updatedAt: recent }, user: { appRole: 'admin', twoFactorEnabled: true } })).toBe('ok');
  });
  it('homeFor', () => {
    expect([homeFor('admin'), homeFor('nutri'), homeFor('paciente')]).toEqual(['/admin', '/painel', '/p/inicio']);
  });
});

describe('expiresAt por papel (RNF-06)', () => {
  it('equipe: agora + 12 h; paciente: agora + 30 dias', () => {
    expect(sessionExpiresAt('nutri', now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
    expect(sessionExpiresAt('admin', now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
    expect(sessionExpiresAt('paciente', now).getTime()).toBe(now.getTime() + PATIENT_SESSION_MS);
  });
  it('capSessionExpiry limita a equipe a 12 h e deixa o paciente com o valor do Better Auth', () => {
    const trintaDias = new Date(now.getTime() + PATIENT_SESSION_MS);
    expect(capSessionExpiry(trintaDias, 'nutri', now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
    expect(capSessionExpiry(trintaDias, 'paciente', now)).toBe(trintaDias);
  });
  it('capSessionExpiry não estende um expiresAt menor (ex.: sessão de 1 dia)', () => {
    const umaHora = new Date(now.getTime() + 60 * 60 * 1000);
    expect(capSessionExpiry(umaHora, 'admin', now)).toBe(umaHora);
  });
  it('papel desconhecido recebe o limite menor (12 h)', () => {
    const trintaDias = new Date(now.getTime() + PATIENT_SESSION_MS);
    expect(capSessionExpiry(trintaDias, undefined, now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
  });
  it('isRefreshDue só depois da cadência', () => {
    expect(isRefreshDue(new Date(now.getTime() - SESSION_REFRESH_MS + 1), now)).toBe(false);
    expect(isRefreshDue(new Date(now.getTime() - SESSION_REFRESH_MS), now)).toBe(true);
  });
});
