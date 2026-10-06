export type AppRole = 'admin' | 'nutri' | 'paciente';
export type SessionDecision = 'ok' | 'login' | 'expired' | 'setup-2fa' | 'forbidden' | 'suspended';

// RNF-06: equipe (admin/nutri) expira após 12 h sem atividade; paciente, após 30 dias.
export const STAFF_IDLE_MS = 12 * 60 * 60 * 1000;
export const PATIENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** Cadência da renovação: com uso, updatedAt/expiresAt deslizam no máximo a cada 15 min. */
export const SESSION_REFRESH_MS = 15 * 60 * 1000;
export const SECURITY_PATH = '/conta/seguranca';
/** RN-15: tela mostrada a quem é de uma conta suspensa. */
export const SUSPENDED_PATH = '/indisponivel';
/** 401 das rotas de API (e o que o editor do plano mostra quando o salvamento recebe 401). */
export const MSG_SESSAO_EXPIRADA = 'Sessão expirada. Entre de novo.';

export function homeFor(role: AppRole): string {
  return role === 'admin' ? '/admin' : role === 'nutri' ? '/painel' : '/p/inicio';
}

/** P09-03: tela "este aparelho está conectado com outra conta" (o caso `forbidden` de requireUser). */
export const OUTRO_PAPEL_PATH = '/conta/outro-papel';
export const ROTULO_PAPEL: Record<AppRole, string> = { admin: 'administrador', nutri: 'nutricionista', paciente: 'paciente' };

export function ehPapel(v: unknown): v is AppRole {
  return v === 'admin' || v === 'nutri' || v === 'paciente';
}

/** O papel que a tela pedia. A Segurança aceita admin e nutricionista: o aviso pede a conta de nutricionista. */
export function papelEsperado(allowed: readonly AppRole[]): AppRole {
  return allowed.includes('nutri') ? 'nutri' : allowed[0];
}

export function caminhoOutroPapel(allowed: readonly AppRole[]): string {
  return `${OUTRO_PAPEL_PATH}?esperado=${papelEsperado(allowed)}`;
}

export function textoOutroPapel(atual: AppRole, esperado: AppRole): string {
  return `Este aparelho está conectado como ${ROTULO_PAPEL[atual]}. Saia e entre com a conta de ${ROTULO_PAPEL[esperado]}.`;
}

/** Quando a sessão expira se houver atividade agora. */
export function sessionExpiresAt(role: AppRole, now: Date): Date {
  return new Date(now.getTime() + (role === 'paciente' ? PATIENT_SESSION_MS : STAFF_IDLE_MS));
}

/**
 * Limita o expiresAt que o Better Auth quer gravar (ele usa 30 dias para todos).
 * Papel desconhecido é tratado como equipe: na dúvida, vale o limite menor.
 */
export function capSessionExpiry(expiresAt: Date, role: string | null | undefined, now: Date): Date {
  if (role === 'paciente') return expiresAt;
  const staffLimit = sessionExpiresAt('nutri', now);
  return expiresAt.getTime() < staffLimit.getTime() ? expiresAt : staffLimit;
}

/** Se a sessão ativa já deve deslizar (updatedAt mais velho que a cadência). */
export function isRefreshDue(updatedAt: Date, now: Date): boolean {
  return now.getTime() - new Date(updatedAt).getTime() >= SESSION_REFRESH_MS;
}

export function evaluateSession(input: {
  session: { updatedAt: Date } | null;
  user: { appRole: string; twoFactorEnabled?: boolean | null } | null;
  allowed: readonly AppRole[];
  now: Date;
  path: string;
  /** O navegador mandou cookie de sessão (sessão nula + cookie = sessão que expirou). */
  hasSessionCookie?: boolean;
  tenantStatus?: 'ativa' | 'suspensa' | null;
}): SessionDecision {
  const { session, user, allowed, now, path, hasSessionCookie, tenantStatus } = input;
  if (!session || !user) return hasSessionCookie ? 'expired' : 'login';
  const role = user.appRole as AppRole;
  if (!allowed.includes(role)) return 'forbidden';
  const staff = role === 'admin' || role === 'nutri';
  // Defesa extra ao expiresAt de 12 h: exige que a leitura seja feita sem renovar (disableRefresh)
  if (staff && now.getTime() - new Date(session.updatedAt).getTime() > STAFF_IDLE_MS) return 'expired';
  if (tenantStatus === 'suspensa') return 'suspended';
  if (role === 'admin' && !user.twoFactorEnabled && path !== SECURITY_PATH) return 'setup-2fa';
  return 'ok';
}
