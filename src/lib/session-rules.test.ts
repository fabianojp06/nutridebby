import { describe, expect, it } from 'vitest';
import {
  ACESSO_DESATIVADO_PATH,
  caminhoOutroPapel,
  capSessionExpiry,
  ehMotivoDoFim,
  ehPapel,
  estadoDaSessao,
  evaluateSession,
  fimDaSessao,
  homeFor,
  isRefreshDue,
  MSG_AVISO_INATIVIDADE,
  MSG_FIM_DA_SESSAO,
  OUTRO_PAPEL_PATH,
  papelEsperado,
  PATIENT_REFRESH_MS,
  PATIENT_SESSION_MS,
  PRAZOS_DA_EQUIPE,
  prazosDeTeste,
  ROTULO_CONTINUAR,
  ROTULO_PAPEL,
  semPermissaoPath,
  sessionExpiresAt,
  STAFF_IDLE_MS,
  STAFF_MAX_MS,
  STAFF_REFRESH_MS,
  STAFF_WARNING_MS,
  textoOutroPapel,
} from './session-rules';

const MIN = 60_000;
const H = 60 * MIN;
const now = new Date('2026-10-01T12:00:00Z');
const antes = (msAtras: number) => new Date(now.getTime() - msAtras);
const recent = antes(MIN);
const logada = antes(H); // login há 1 h
const idle = antes(STAFF_IDLE_MS + 1);
const base = { now, path: '/admin', allowed: ['admin'] as const };
const ativa = { updatedAt: recent, createdAt: logada };
const nutri = (session: { updatedAt: Date; createdAt: Date }) =>
  evaluateSession({ now, path: '/painel', allowed: ['nutri'], session, user: { appRole: 'nutri', twoFactorEnabled: false } });

describe('prazos da equipe (RNF-06, P12-14 — decisão do dono 07/10/2026)', () => {
  it('30 min sem uso, aviso 2 min antes, 8 h de limite, renovação a cada 5 min; o paciente segue com 30 dias e 15 min', () => {
    expect([STAFF_IDLE_MS, STAFF_WARNING_MS, STAFF_MAX_MS, STAFF_REFRESH_MS]).toEqual([30 * MIN, 2 * MIN, 8 * H, 5 * MIN]);
    expect(PRAZOS_DA_EQUIPE).toEqual({ inatividadeMs: 30 * MIN, avisoMs: 2 * MIN, cadenciaMs: 5 * MIN, limiteMs: 8 * H });
    expect([PATIENT_SESSION_MS, PATIENT_REFRESH_MS]).toEqual([30 * 24 * H, 15 * MIN]);
  });
  it('textos exatos do aviso, do botão e do login', () => {
    expect(MSG_AVISO_INATIVIDADE).toBe('Sua sessão vai encerrar em 2 minutos por falta de uso.');
    expect(ROTULO_CONTINUAR).toBe('Continuar na sessão');
    expect(MSG_FIM_DA_SESSAO.inatividade).toBe('Sua sessão foi encerrada por falta de uso. Entre de novo.');
    expect(MSG_FIM_DA_SESSAO.limite).toBe('Sua sessão chegou ao limite de 8 horas. Entre de novo.');
  });
  it('prazos de teste (SESSAO_TESTE_MS): inatividade = ms, aviso na metade, cadência 1/6, limite 16×', () => {
    expect(prazosDeTeste(30_000)).toEqual({ inatividadeMs: 30_000, avisoMs: 15_000, cadenciaMs: 5_000, limiteMs: 480_000 });
  });
  it('ehMotivoDoFim só aceita os dois motivos', () => {
    expect(['inatividade', 'limite'].every(ehMotivoDoFim)).toBe(true);
    for (const v of ['expirada', '', null, undefined, 'Limite']) expect(ehMotivoDoFim(v)).toBe(false);
  });
});

describe('evaluateSession (RNF-06, US-002, US-003)', () => {
  it('sem sessão → login', () => {
    expect(evaluateSession({ ...base, session: null, user: null })).toBe('login');
  });
  it('sem sessão mas com cookie (sessão expirada e apagada) → expired', () => {
    expect(evaluateSession({ ...base, session: null, user: null, hasSessionCookie: true })).toBe('expired');
  });
  it('papel fora da lista → forbidden', () => {
    expect(evaluateSession({ ...base, session: ativa, user: { appRole: 'nutri', twoFactorEnabled: true } })).toBe('forbidden');
  });
  it('nutri sem uso há 29 min → ok; há 31 min → expired (P12-14)', () => {
    expect(nutri({ updatedAt: antes(29 * MIN), createdAt: logada })).toBe('ok');
    expect(nutri({ updatedAt: antes(31 * MIN), createdAt: logada })).toBe('expired');
    expect(nutri({ updatedAt: antes(STAFF_IDLE_MS), createdAt: logada })).toBe('ok'); // exatamente 30 min ainda vale
    expect(nutri({ updatedAt: idle, createdAt: logada })).toBe('expired');
  });
  it('limite de 8 h desde o login, mesmo com uso contínuo (P12-14)', () => {
    expect(nutri({ updatedAt: recent, createdAt: antes(8 * H - MIN) })).toBe('ok');
    expect(nutri({ updatedAt: recent, createdAt: antes(8 * H) })).toBe('ok'); // no limite exato ainda vale
    expect(nutri({ updatedAt: recent, createdAt: antes(8 * H + 1) })).toBe('expired');
    expect(evaluateSession({ ...base, session: { updatedAt: recent, createdAt: antes(9 * H) }, user: { appRole: 'admin', twoFactorEnabled: true } })).toBe('expired');
  });
  it('paciente intocado: inativo há 13 h e logado há 20 dias continua ok (o limite é 30 dias, no expiresAt)', () => {
    expect(
      evaluateSession({ now, path: '/p/inicio', allowed: ['paciente'], session: { updatedAt: antes(13 * H), createdAt: antes(20 * 24 * H) }, user: { appRole: 'paciente', twoFactorEnabled: false } }),
    ).toBe('ok');
  });
  it('prazos de teste valem quando passados (E2E)', () => {
    const prazos = prazosDeTeste(30_000);
    const s = { updatedAt: antes(31_000), createdAt: antes(40_000) };
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: s, user: { appRole: 'nutri' }, prazos })).toBe('expired');
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: s, user: { appRole: 'nutri' } })).toBe('ok');
  });
  it('admin sem 2FA → setup-2fa, exceto na própria tela de segurança', () => {
    const user = { appRole: 'admin', twoFactorEnabled: false };
    expect(evaluateSession({ ...base, session: ativa, user })).toBe('setup-2fa');
    expect(evaluateSession({ now, path: '/conta/seguranca', allowed: ['admin', 'nutri'], session: ativa, user })).toBe('ok');
  });
  it('admin com 2FA → ok', () => {
    expect(evaluateSession({ ...base, session: ativa, user: { appRole: 'admin', twoFactorEnabled: true } })).toBe('ok');
  });
  it('homeFor', () => {
    expect([homeFor('admin'), homeFor('nutri'), homeFor('paciente')]).toEqual(['/admin', '/painel', '/p/inicio']);
  });
  it('conta suspensa → suspended, mesmo com sessão válida (RN-15)', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: ativa, user: { appRole: 'nutri' }, tenantStatus: 'suspensa' })).toBe('suspended');
  });
  it('conta ativa ou usuário sem tenant seguem a regra normal', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: ativa, user: { appRole: 'nutri' }, tenantStatus: 'ativa' })).toBe('ok');
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: ativa, user: { appRole: 'nutri' }, tenantStatus: null })).toBe('ok');
  });
  it('sessão ociosa de conta suspensa continua "expired" (a ociosidade vem antes)', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: { updatedAt: idle, createdAt: logada }, user: { appRole: 'nutri' }, tenantStatus: 'suspensa' })).toBe('expired');
  });
});

describe('fimDaSessao e estadoDaSessao (P12-14)', () => {
  it('o motivo: limite vence a inatividade; null enquanto vale', () => {
    expect(fimDaSessao({ updatedAt: recent, createdAt: logada }, now)).toBeNull();
    expect(fimDaSessao({ updatedAt: antes(31 * MIN), createdAt: logada }, now)).toBe('inatividade');
    expect(fimDaSessao({ updatedAt: recent, createdAt: antes(8 * H + 1) }, now)).toBe('limite');
    expect(fimDaSessao({ updatedAt: antes(31 * MIN), createdAt: antes(9 * H) }, now)).toBe('limite');
  });
  it('quanto falta: inatividade pelo updatedAt (sem passar do expiresAt) e limite pelo createdAt, nunca negativo', () => {
    const e = estadoDaSessao({ updatedAt: antes(10 * MIN), createdAt: logada, expiresAt: new Date(now.getTime() + 20 * MIN) }, now);
    expect(e).toEqual({ inatividadeMs: 20 * MIN, limiteMs: 7 * H, avisoMs: 2 * MIN, cadenciaMs: 5 * MIN });
    // sessão antiga com expiresAt longo: vale a regra de 30 min
    expect(estadoDaSessao({ updatedAt: antes(10 * MIN), createdAt: logada, expiresAt: new Date(now.getTime() + 11 * H) }, now).inatividadeMs).toBe(20 * MIN);
    // expiresAt menor (o limite de 8 h já gravado nele)
    expect(estadoDaSessao({ updatedAt: recent, createdAt: antes(8 * H - 5 * MIN), expiresAt: new Date(now.getTime() + 5 * MIN) }, now).inatividadeMs).toBe(5 * MIN);
    expect(estadoDaSessao({ updatedAt: antes(H), createdAt: antes(9 * H), expiresAt: antes(MIN) }, now)).toMatchObject({ inatividadeMs: 0, limiteMs: 0 });
  });
});

describe('expiresAt por papel (RNF-06)', () => {
  it('equipe: agora + 30 min; paciente: agora + 30 dias', () => {
    expect(sessionExpiresAt('nutri', now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
    expect(sessionExpiresAt('admin', now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
    expect(sessionExpiresAt('paciente', now).getTime()).toBe(now.getTime() + PATIENT_SESSION_MS);
  });
  it('equipe perto do limite de 8 h: o expiresAt para no createdAt + 8 h (o paciente ignora o createdAt)', () => {
    const createdAt = antes(8 * H - 10 * MIN);
    expect(sessionExpiresAt('nutri', now, { createdAt }).getTime()).toBe(createdAt.getTime() + STAFF_MAX_MS);
    expect(sessionExpiresAt('nutri', now, { createdAt: logada }).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
    expect(sessionExpiresAt('paciente', now, { createdAt }).getTime()).toBe(now.getTime() + PATIENT_SESSION_MS);
    expect(sessionExpiresAt('nutri', now, { prazos: prazosDeTeste(30_000) }).getTime()).toBe(now.getTime() + 30_000);
  });
  it('capSessionExpiry limita a equipe a 30 min e deixa o paciente com o valor do Better Auth', () => {
    const trintaDias = new Date(now.getTime() + PATIENT_SESSION_MS);
    expect(capSessionExpiry(trintaDias, 'nutri', now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
    expect(capSessionExpiry(trintaDias, 'paciente', now)).toBe(trintaDias);
  });
  it('capSessionExpiry com createdAt herdado (troca de sessão perto das 8 h) para no limite', () => {
    const umDia = new Date(now.getTime() + 24 * H);
    const createdAt = antes(8 * H - 5 * MIN);
    expect(capSessionExpiry(umDia, 'admin', now, createdAt).getTime()).toBe(createdAt.getTime() + STAFF_MAX_MS);
  });
  it('capSessionExpiry não estende um expiresAt menor (ex.: sessão de 10 min)', () => {
    const dezMin = new Date(now.getTime() + 10 * MIN);
    expect(capSessionExpiry(dezMin, 'admin', now)).toBe(dezMin);
  });
  it('papel desconhecido recebe o limite menor (30 min)', () => {
    const trintaDias = new Date(now.getTime() + PATIENT_SESSION_MS);
    expect(capSessionExpiry(trintaDias, undefined, now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
  });
  it('isRefreshDue: 5 min na equipe, 15 min no paciente', () => {
    expect(isRefreshDue(antes(STAFF_REFRESH_MS - 1), now, 'nutri')).toBe(false);
    expect(isRefreshDue(antes(STAFF_REFRESH_MS), now, 'nutri')).toBe(true);
    expect(isRefreshDue(antes(STAFF_REFRESH_MS), now, 'paciente')).toBe(false);
    expect(isRefreshDue(antes(PATIENT_REFRESH_MS - 1), now, 'paciente')).toBe(false);
    expect(isRefreshDue(antes(PATIENT_REFRESH_MS), now, 'paciente')).toBe(true);
    expect(isRefreshDue(antes(5_000), now, 'admin', prazosDeTeste(30_000))).toBe(true);
  });
});

describe('outro papel no aparelho (P09-03)', () => {
  it('o papel esperado é o da tela: só paciente → paciente; só admin → admin; equipe (admin e nutri) → nutricionista', () => {
    expect(papelEsperado(['paciente'])).toBe('paciente');
    expect(papelEsperado(['admin'])).toBe('admin');
    expect(papelEsperado(['nutri'])).toBe('nutri');
    expect(papelEsperado(['admin', 'nutri'])).toBe('nutri');
    expect(caminhoOutroPapel(['paciente'])).toBe(`${OUTRO_PAPEL_PATH}?esperado=paciente`);
  });
  it('o texto da tela', () => {
    expect(textoOutroPapel('nutri', 'paciente')).toBe('Este aparelho está conectado como nutricionista. Saia e entre com a conta de paciente.');
    expect(textoOutroPapel('paciente', 'admin')).toBe('Este aparelho está conectado como paciente. Saia e entre com a conta de administrador.');
  });
  it('ehPapel só aceita os quatro papéis (Plano 26: recepcao)', () => {
    for (const v of ['admin', 'nutri', 'paciente', 'recepcao']) expect(ehPapel(v)).toBe(true);
    for (const v of ['javascript:alert(1)', 'Nutri', '', undefined, ['nutri'], 'root']) expect(ehPapel(v)).toBe(false);
  });
});

describe('Plano 26: papel recepcao (RN-498, RN-500, RN-501, RN-503)', () => {
  const recepcao = (o: { path?: string; allowed?: readonly ('admin' | 'nutri' | 'paciente' | 'recepcao')[]; doisFatores?: boolean; equipe?: { ativo: boolean } | null; session?: { updatedAt: Date; createdAt: Date } } = {}) =>
    evaluateSession({
      now,
      path: o.path ?? '/painel',
      allowed: o.allowed ?? ['nutri', 'recepcao'],
      session: o.session ?? ativa,
      user: { appRole: 'recepcao', twoFactorEnabled: o.doisFatores ?? true },
      equipe: o.equipe === undefined ? { ativo: true } : o.equipe,
    });

  it('Record<AppRole, …> exaustivo: rótulo "recepção", home /painel', () => {
    expect(Object.keys(ROTULO_PAPEL).sort()).toEqual(['admin', 'nutri', 'paciente', 'recepcao']);
    expect(ROTULO_PAPEL.recepcao).toBe('recepção');
    expect(homeFor('recepcao')).toBe('/painel');
    expect(textoOutroPapel('recepcao', 'paciente')).toBe('Este aparelho está conectado como recepção. Saia e entre com a conta de paciente.');
  });
  it('ativa e com 2FA → ok; sem 2FA → setup-2fa, menos na Segurança (RE-D20)', () => {
    expect(recepcao()).toBe('ok');
    expect(recepcao({ doisFatores: false })).toBe('setup-2fa');
    expect(recepcao({ doisFatores: false, path: '/conta/seguranca', allowed: ['admin', 'nutri', 'recepcao'] })).toBe('ok');
  });
  it('prazos da equipe: 31 min sem uso e mais de 8 h desde o login → expired; 29 min → ok', () => {
    expect(recepcao({ session: { updatedAt: antes(29 * MIN), createdAt: logada } })).toBe('ok');
    expect(recepcao({ session: { updatedAt: antes(31 * MIN), createdAt: logada } })).toBe('expired');
    expect(recepcao({ session: { updatedAt: recent, createdAt: antes(8 * H + MIN) } })).toBe('expired');
    expect(capSessionExpiry(new Date(now.getTime() + 30 * 24 * H), 'recepcao', now).getTime()).toBe(now.getTime() + STAFF_IDLE_MS);
  });
  it('desativada (ou sem a linha de equipe_membros: falha fechada) → desativada em toda tela, inclusive a Segurança e as de outro papel', () => {
    for (const equipe of [{ ativo: false }, null]) {
      expect(recepcao({ equipe })).toBe('desativada');
      expect(recepcao({ equipe, path: '/conta/seguranca', allowed: ['admin', 'nutri', 'recepcao'] })).toBe('desativada');
      expect(recepcao({ equipe, allowed: ['nutri'] })).toBe('desativada');
      expect(recepcao({ equipe, allowed: ['paciente'], path: '/p/inicio' })).toBe('desativada');
    }
    expect(evaluateSession({ now, path: '/painel', allowed: ['recepcao'], session: ativa, user: { appRole: 'recepcao', twoFactorEnabled: true } })).toBe('desativada');
  });
  it('a página "Acesso desativado" abre para a desativada (mesmo sem 2FA); sessão ociosa continua expired', () => {
    expect(recepcao({ equipe: { ativo: false }, path: ACESSO_DESATIVADO_PATH, allowed: ['recepcao'], doisFatores: false })).toBe('ok');
    expect(recepcao({ equipe: { ativo: false }, session: { updatedAt: idle, createdAt: logada } })).toBe('expired');
  });
  it('ativa numa tela de outro papel → forbidden (a sessão leva a Sem permissão ou ao aviso de outro papel)', () => {
    expect(recepcao({ allowed: ['nutri'] })).toBe('forbidden');
    expect(recepcao({ allowed: ['admin'], path: '/admin' })).toBe('forbidden');
  });
  it('a linha da equipe não vale para os outros papéis', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: ativa, user: { appRole: 'nutri' }, equipe: { ativo: false } })).toBe('ok');
  });
  it('Sem permissão: os dois motivos (RE-D47)', () => {
    expect(semPermissaoPath('nutri')).toBe('/painel/sem-permissao?motivo=nutri');
    expect(semPermissaoPath('financeiro')).toBe('/painel/sem-permissao?motivo=financeiro');
  });
});
