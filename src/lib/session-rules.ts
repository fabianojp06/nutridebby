/** Plano 26 (RN-498): `recepcao` — a pessoa da recepção de um consultório (linha em `equipe_membros`). */
export type AppRole = 'admin' | 'nutri' | 'paciente' | 'recepcao';
/** `desativada` (Plano 26, RN-503): a conta da recepção sem linha ativa em `equipe_membros` — recusada em toda tela. */
export type SessionDecision = 'ok' | 'login' | 'expired' | 'setup-2fa' | 'forbidden' | 'suspended' | 'desativada';

/**
 * RNF-06 (decisão do dono 07/10/2026, P12-14; boa prática SBIS NGS1 — bloqueio de sessão por inatividade): a equipe
 * (admin/nutri) sai depois de 30 min sem uso, com aviso 2 min antes, e no máximo 8 h depois do login completo (depois do
 * 2FA), mesmo com uso contínuo. O paciente não muda: 30 dias.
 */
export const STAFF_IDLE_MS = 30 * 60 * 1000;
export const STAFF_WARNING_MS = 2 * 60 * 1000;
export const STAFF_MAX_MS = 8 * 60 * 60 * 1000;
/** Cadência da renovação da equipe: com uso, updatedAt/expiresAt deslizam no máximo a cada 5 min (a tela também). */
export const STAFF_REFRESH_MS = 5 * 60 * 1000;
export const PATIENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** Cadência da renovação do paciente (inalterada): no máximo a cada 15 min. */
export const PATIENT_REFRESH_MS = 15 * 60 * 1000;

/** Os prazos da sessão da equipe numa estrutura só: os de produção ou os encurtados do E2E (`prazosDeTeste`). */
export type PrazosDaEquipe = { inatividadeMs: number; avisoMs: number; cadenciaMs: number; limiteMs: number };
export const PRAZOS_DA_EQUIPE: PrazosDaEquipe = Object.freeze({
  inatividadeMs: STAFF_IDLE_MS,
  avisoMs: STAFF_WARNING_MS,
  cadenciaMs: STAFF_REFRESH_MS,
  limiteMs: STAFF_MAX_MS,
});

/**
 * Só teste (SESSAO_TESTE_MS, recusada em produção em src/env.ts): a inatividade vira `ms`; o aviso aparece na metade, a
 * cadência é 1/6 (como 5 de 30 min) e o limite absoluto é 16 vezes (como 8 h de 30 min).
 */
export function prazosDeTeste(ms: number): PrazosDaEquipe {
  return { inatividadeMs: ms, avisoMs: Math.floor(ms / 2), cadenciaMs: Math.floor(ms / 6), limiteMs: ms * 16 };
}

/** Por que a sessão da equipe acabou: sem uso (30 min) ou no limite absoluto (8 h). */
export type MotivoDoFim = 'inatividade' | 'limite';
export function ehMotivoDoFim(v: unknown): v is MotivoDoFim {
  return v === 'inatividade' || v === 'limite';
}
/** Textos de /entrar?motivo=… (P12-14). */
export const MSG_FIM_DA_SESSAO: Record<MotivoDoFim, string> = {
  inatividade: 'Sua sessão foi encerrada por falta de uso. Entre de novo.',
  limite: 'Sua sessão chegou ao limite de 8 horas. Entre de novo.',
};
/** O aviso que a tela mostra 2 min antes (P12-14) e o botão que renova a sessão. */
export const MSG_AVISO_INATIVIDADE = 'Sua sessão vai encerrar em 2 minutos por falta de uso.';
export const ROTULO_CONTINUAR = 'Continuar na sessão';

const ms = (d: Date | string) => new Date(d).getTime();
const ehEquipe = (role: string | null | undefined) => role !== 'paciente';

export const SECURITY_PATH = '/conta/seguranca';
/** RN-15: tela mostrada a quem é de uma conta suspensa. */
export const SUSPENDED_PATH = '/indisponivel';
/** 401 das rotas de API (e o que o editor do plano mostra quando o salvamento recebe 401). */
export const MSG_SESSAO_EXPIRADA = 'Sessão expirada. Entre de novo.';

export function homeFor(role: AppRole): string {
  return role === 'admin' ? '/admin' : role === 'nutri' || role === 'recepcao' ? '/painel' : '/p/inicio';
}

/**
 * Plano 26 (RE-D47, RN-504): "Sem permissão" — `nutri`, a recepção numa tela só da nutricionista (requireNutri); `financeiro`,
 * a recepção sem a permissão do Financeiro (requireEquipe com `financeiro: true`).
 */
export type MotivoSemPermissao = 'nutri' | 'financeiro';
export const SEM_PERMISSAO_PATH = '/painel/sem-permissao';
export const semPermissaoPath = (motivo: MotivoSemPermissao): string => `${SEM_PERMISSAO_PATH}?motivo=${motivo}`;
/** RN-501 (RE-D29): o DPA do consultório pendente, para a recepção (quem aceita é a nutricionista). */
export const CONTRATO_PENDENTE_PATH = '/painel/contrato-pendente';
/** RN-503 (RE-D45): a conta da recepção desativada; fora do painel, como a Segurança. */
export const ACESSO_DESATIVADO_PATH = '/conta/acesso-desativado';

/** P09-03: tela "este aparelho está conectado com outra conta" (o caso `forbidden` de requireUser). */
export const OUTRO_PAPEL_PATH = '/conta/outro-papel';
export const ROTULO_PAPEL: Record<AppRole, string> = { admin: 'administrador', nutri: 'nutricionista', paciente: 'paciente', recepcao: 'recepção' };

export function ehPapel(v: unknown): v is AppRole {
  return v === 'admin' || v === 'nutri' || v === 'paciente' || v === 'recepcao';
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

/**
 * Quando a sessão expira se houver atividade agora. Equipe: agora + 30 min, sem passar do limite de 8 h contado do
 * `createdAt` (com o limite no `expiresAt`, o próprio Better Auth recusa a sessão em qualquer rota).
 */
export function sessionExpiresAt(role: AppRole, now: Date, o: { createdAt?: Date; prazos?: PrazosDaEquipe } = {}): Date {
  if (role === 'paciente') return new Date(now.getTime() + PATIENT_SESSION_MS);
  const prazos = o.prazos ?? PRAZOS_DA_EQUIPE;
  const ocioso = now.getTime() + prazos.inatividadeMs;
  return new Date(o.createdAt ? Math.min(ocioso, ms(o.createdAt) + prazos.limiteMs) : ocioso);
}

/**
 * Limita o expiresAt que o Better Auth quer gravar (ele usa 30 dias, ou 1 dia sem "lembrar de mim").
 * Papel desconhecido é tratado como equipe: na dúvida, vale o limite menor.
 */
export function capSessionExpiry(expiresAt: Date, role: string | null | undefined, now: Date, createdAt: Date = now): Date {
  if (!ehEquipe(role)) return expiresAt;
  const staffLimit = sessionExpiresAt('nutri', now, { createdAt });
  return expiresAt.getTime() < staffLimit.getTime() ? expiresAt : staffLimit;
}

/** Se a sessão ativa já deve deslizar (updatedAt mais velho que a cadência do papel: 5 min na equipe, 15 no paciente). */
export function isRefreshDue(updatedAt: Date, now: Date, role: AppRole, prazos: PrazosDaEquipe = PRAZOS_DA_EQUIPE): boolean {
  const cadencia = role === 'paciente' ? PATIENT_REFRESH_MS : prazos.cadenciaMs;
  return now.getTime() - ms(updatedAt) >= cadencia;
}

/**
 * Se a sessão da equipe já acabou, e por quê: o limite de 8 h desde o login vence a inatividade (sem uso há mais de
 * 30 min desde a última atividade registrada). `null` = ainda vale.
 */
export function fimDaSessao(
  session: { updatedAt: Date; createdAt: Date },
  now: Date,
  prazos: PrazosDaEquipe = PRAZOS_DA_EQUIPE,
): MotivoDoFim | null {
  if (now.getTime() - ms(session.createdAt) > prazos.limiteMs) return 'limite';
  if (now.getTime() - ms(session.updatedAt) > prazos.inatividadeMs) return 'inatividade';
  return null;
}

/**
 * O que a tela da equipe precisa para o relógio do aviso (P12-14): quanto falta para a sessão acabar por inatividade e
 * pelo limite, em ms relativos (o relógio do aparelho pode estar errado), e os prazos. Nada de dado pessoal.
 */
export type EstadoDaSessao = { inatividadeMs: number; limiteMs: number; avisoMs: number; cadenciaMs: number };
export function estadoDaSessao(
  session: { updatedAt: Date; createdAt: Date; expiresAt: Date },
  now: Date,
  prazos: PrazosDaEquipe = PRAZOS_DA_EQUIPE,
): EstadoDaSessao {
  const limite = ms(session.createdAt) + prazos.limiteMs;
  const ocioso = Math.min(ms(session.updatedAt) + prazos.inatividadeMs, ms(session.expiresAt));
  return {
    inatividadeMs: Math.max(0, ocioso - now.getTime()),
    limiteMs: Math.max(0, limite - now.getTime()),
    avisoMs: prazos.avisoMs,
    cadenciaMs: prazos.cadenciaMs,
  };
}

export function evaluateSession(input: {
  session: { updatedAt: Date; createdAt: Date } | null;
  user: { appRole: string; twoFactorEnabled?: boolean | null } | null;
  allowed: readonly AppRole[];
  now: Date;
  path: string;
  /** O navegador mandou cookie de sessão (sessão nula + cookie = sessão que expirou). */
  hasSessionCookie?: boolean;
  tenantStatus?: 'ativa' | 'suspensa' | null;
  /** Os prazos da equipe (os encurtados só no E2E). */
  prazos?: PrazosDaEquipe;
  /**
   * Plano 26 (RN-503, RN-504): a linha de `equipe_membros` da conta `recepcao`, lida com a sessão. Sem ela, ou desativada,
   * a recepção é recusada em toda tela (falha fechada); não vale para os outros papéis.
   */
  equipe?: { ativo: boolean } | null;
}): SessionDecision {
  const { session, user, allowed, now, path, hasSessionCookie, tenantStatus, prazos } = input;
  if (!session || !user) return hasSessionCookie ? 'expired' : 'login';
  const role = user.appRole as AppRole;
  const desativada = role === 'recepcao' && input.equipe?.ativo !== true;
  // a desativada é recusada em toda tela, inclusive nas de outro papel: o aviso dela vence o de outro papel
  if (!allowed.includes(role) && !desativada) return 'forbidden';
  // RNF-06: inatividade (30 min) e limite (8 h) da equipe. Defesa extra ao expiresAt: exige a leitura sem renovar
  // (disableRefresh) e vale também para sessões abertas antes desta regra (P12-14, item 6)
  if (ehEquipe(role) && fimDaSessao(session, now, prazos)) return 'expired';
  // RN-503 (RE-D45): só a própria página do aviso abre (sem pedir o 2FA: não há o que proteger nela)
  if (desativada) return path === ACESSO_DESATIVADO_PATH && allowed.includes(role) ? 'ok' : 'desativada';
  if (tenantStatus === 'suspensa') return 'suspended';
  // RE-D20 (Plano 26): a recepção tem o 2FA obrigatório, como o admin
  if ((role === 'admin' || role === 'recepcao') && !user.twoFactorEnabled && path !== SECURITY_PATH) return 'setup-2fa';
  return 'ok';
}
