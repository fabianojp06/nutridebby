import 'server-only';
import { redirect } from 'next/navigation';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import type { MembroDaEquipe } from '@/modules/plataforma/membro-da-equipe';
import { podeVerSecao } from '@/modules/relatorios/acesso';
import type { Secao } from '@/modules/relatorios/constantes';
import { recusaApi, requireApiUser, type MotivoDaSessaoRecusada } from './api-auth';
import { clientIp } from './ip';
import { requestIp } from './request-ip';
import { requireUserComTenant, type SessionData } from './session';
import { CONTRATO_PENDENTE_PATH, semPermissaoPath, type MotivoSemPermissao } from './session-rules';

export const DPA_PATH = '/painel/dpa';
export const MSG_DPA_PENDENTE = 'Aceite o contrato de tratamento de dados para continuar.';

export type NutriAccess = { data: SessionData; tenant: TenantRow; ctx: TenantContext };

/**
 * Entrada de toda página e Server Action da nutricionista: sessão válida (requireUser),
 * DPA da versão atual aceito e o contexto do tenant pronto para withTenant (com ator e IP).
 * F8: a linha do tenant vem da mesma leitura que o requireUser fez para o RN-15.
 * Plano 26 (RN-504, RE-D16): o contrato não muda — só a nutricionista entra; a recepção vai a "Sem permissão"
 * (`?motivo=nutri`, em requireUserComTenant) e a recepção desativada a /conta/acesso-desativado.
 */
export async function requireNutri(path: string, opts: { permitirDpaPendente?: boolean } = {}): Promise<NutriAccess> {
  const { data, tenant } = await requireUserComTenant(['nutri'], path);
  const tenantId = data.user.tenantId;
  if (!tenantId) throw new Error('Conta de nutricionista sem tenant');
  if (!tenant) throw new Error('Tenant da nutricionista não encontrado');
  if (!opts.permitirDpaPendente && tenant.dpaVersao !== DPA_VERSAO) redirect(DPA_PATH);
  return { data, tenant, ctx: { tenantId, role: 'nutri', actorUserId: data.user.id, ip: await requestIp() } };
}

/**
 * Por que `requireApiNutri` recusou (Plano 20, T8): a rota que é navegação (o download do CSV) troca a resposta JSON por
 * um redirect sem ler o corpo. `sem_sessao`: o 401 (sem sessão ou expirada); `dpa_pendente`: o 403 do DPA; `papel`:
 * qualquer outro 403 (papel errado, conta suspensa, 2FA do admin, conta sem consultório). Os da sessão vêm de
 * `requireApiUser` (o `motivo` que a decisão da sessão já conhece), nunca do status da resposta.
 */
export type MotivoDaRecusa = MotivoDaSessaoRecusada | 'dpa_pendente';

export type ApiNutri = ({ ok: true } & NutriAccess) | { ok: false; response: Response; motivo: MotivoDaRecusa };

/**
 * F7: requireNutri para Route Handlers — mesma regra de sessão (requireApiUser: 401/403) e do
 * DPA da versão atual (403 com MSG_DPA_PENDENTE), devolvendo o tenant e o contexto com ator e IP.
 * `renovar: false` (P12-14): rota que só devolve estado para o polling da tela — confere, mas não conta como uso.
 * Recusa: a resposta de sempre (status e corpo não mudam) e o `motivo`, para quem precisa responder de outro jeito.
 */
export async function requireApiNutri(req: Request, opts: { renovar?: boolean } = {}): Promise<ApiNutri> {
  const auth = await requireApiUser(req, ['nutri'], opts);
  if (!auth.ok) return auth;
  const tenantId = auth.data.user.tenantId;
  if (!tenantId || !auth.tenant) return { ...recusaApi(403, 'Acesso negado'), motivo: 'papel' };
  if (auth.tenant.dpaVersao !== DPA_VERSAO) return { ...recusaApi(403, MSG_DPA_PENDENTE), motivo: 'dpa_pendente' };
  return {
    ok: true,
    data: auth.data,
    tenant: auth.tenant,
    ctx: { tenantId, role: 'nutri', actorUserId: auth.data.user.id, ip: clientIp(req.headers, getEnv().TRUSTED_PROXIES) },
  };
}

/** Plano 26: os papéis da equipe do consultório que entram no painel (RN-498). */
export type PapelDaEquipe = 'nutri' | 'recepcao';

/**
 * `financeiro`: a nutricionista sempre; a recepção com a permissão (RN-502). `papel`: o da sessão (o `ctx.role` é o mesmo).
 */
export type EquipeAccess = NutriAccess & { papel: PapelDaEquipe; financeiro: boolean };

export type OpcoesDaEquipe = {
  /** A seção dos Relatórios da página (RN-480): sem acesso a ela, "Sem permissão" (`financeiro` ou `nutri`). */
  secao?: Secao;
  /** A tela exige a permissão do Financeiro (RN-502, RE-D47). */
  financeiro?: boolean;
  /** Como em requireNutri: o layout e a própria tela do aviso abrem com o DPA pendente. */
  permitirDpaPendente?: boolean;
};

/** O que falta para a tela (null = entra): a permissão do Financeiro ou a seção dos Relatórios. */
function semPermissaoPara(papel: PapelDaEquipe, financeiro: boolean, o: OpcoesDaEquipe): MotivoSemPermissao | null {
  if (o.financeiro && !financeiro) return 'financeiro';
  if (o.secao && !podeVerSecao({ papel, financeiro }, o.secao)) return o.secao === 'financeiro' ? 'financeiro' : 'nutri';
  return null;
}

function papelEPermissao(appRole: string, membro: MembroDaEquipe | null): { papel: PapelDaEquipe; financeiro: boolean } {
  // a recepção só chega aqui ativa (evaluateSession recusa a desativada e a sem linha); falha fechada mesmo assim
  return appRole === 'nutri' ? { papel: 'nutri', financeiro: true } : { papel: 'recepcao', financeiro: membro?.financeiro === true };
}

/**
 * Plano 26 (RN-504, RN-513): entrada das páginas e Server Actions de `ROTAS_DA_RECEPCAO` (src/app/painel/rotas-da-recepcao.ts;
 * só elas chamam, guarda em rotas-da-recepcao.test.ts). Aceita a nutricionista e a recepção ativa (com 2FA; a desativada
 * vai a /conta/acesso-desativado, a sem 2FA à Segurança — evaluateSession). A linha de `equipe_membros` vem da mesma
 * leitura da sessão (uma por requisição). DPA do consultório pendente: a nutricionista vai ao aceite (/painel/dpa), a
 * recepção a /painel/contrato-pendente (quem aceita é a controladora, RE-D29). Sem a permissão da tela (`financeiro`,
 * `secao`): /painel/sem-permissao com o motivo (RE-D47). O contexto leva o papel da sessão, o ator e o IP.
 */
export async function requireEquipe(path: string, opts: OpcoesDaEquipe = {}): Promise<EquipeAccess> {
  const { data, tenant, membro } = await requireUserComTenant(['nutri', 'recepcao'], path);
  const tenantId = data.user.tenantId;
  if (!tenantId) throw new Error('Conta da equipe sem tenant');
  if (!tenant) throw new Error('Tenant da equipe não encontrado');
  const { papel, financeiro } = papelEPermissao(data.user.appRole, membro);
  if (!opts.permitirDpaPendente && tenant.dpaVersao !== DPA_VERSAO) redirect(papel === 'nutri' ? DPA_PATH : CONTRATO_PENDENTE_PATH);
  const falta = semPermissaoPara(papel, financeiro, opts);
  if (falta) redirect(semPermissaoPath(falta));
  return { data, tenant, papel, financeiro, ctx: { tenantId, role: papel, actorUserId: data.user.id, ip: await requestIp() } };
}

/** `sem_permissao` (Plano 26): a recepção sem a permissão da rota (Financeiro ou a seção dos Relatórios). */
export type MotivoDaRecusaDaEquipe = MotivoDaRecusa | 'sem_permissao';
export type ApiEquipe = ({ ok: true } & EquipeAccess) | { ok: false; response: Response; motivo: MotivoDaRecusaDaEquipe };

/**
 * Plano 26 (RN-504): requireEquipe para Route Handlers de `ROTAS_DA_RECEPCAO` — a mesma regra da sessão (requireApiUser:
 * 401/403, a recepção desativada recebe 403), o DPA (403 com MSG_DPA_PENDENTE, `dpa_pendente`) e a permissão da rota (403,
 * `sem_permissao`: quem é navegação troca por /painel/sem-permissao, como o CSV dos Relatórios).
 */
export async function requireApiEquipe(req: Request, opts: Omit<OpcoesDaEquipe, 'permitirDpaPendente'> & { renovar?: boolean } = {}): Promise<ApiEquipe> {
  const auth = await requireApiUser(req, ['nutri', 'recepcao'], { renovar: opts.renovar });
  if (!auth.ok) return auth;
  const tenantId = auth.data.user.tenantId;
  if (!tenantId || !auth.tenant) return { ...recusaApi(403, 'Acesso negado'), motivo: 'papel' };
  if (auth.tenant.dpaVersao !== DPA_VERSAO) return { ...recusaApi(403, MSG_DPA_PENDENTE), motivo: 'dpa_pendente' };
  const { papel, financeiro } = papelEPermissao(auth.data.user.appRole, auth.membro);
  if (semPermissaoPara(papel, financeiro, opts)) return { ...recusaApi(403, 'Acesso negado'), motivo: 'sem_permissao' };
  return {
    ok: true,
    data: auth.data,
    tenant: auth.tenant,
    papel,
    financeiro,
    ctx: { tenantId, role: papel, actorUserId: auth.data.user.id, ip: clientIp(req.headers, getEnv().TRUSTED_PROXIES) },
  };
}
