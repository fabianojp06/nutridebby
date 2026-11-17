import 'server-only';
import { redirect } from 'next/navigation';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { recusaApi, requireApiUser } from './api-auth';
import { clientIp } from './ip';
import { requestIp } from './request-ip';
import { requireUserComTenant, type SessionData } from './session';

export const DPA_PATH = '/painel/dpa';
export const MSG_DPA_PENDENTE = 'Aceite o contrato de tratamento de dados para continuar.';

export type NutriAccess = { data: SessionData; tenant: TenantRow; ctx: TenantContext };

/**
 * Entrada de toda página e Server Action da nutricionista: sessão válida (requireUser),
 * DPA da versão atual aceito e o contexto do tenant pronto para withTenant (com ator e IP).
 * F8: a linha do tenant vem da mesma leitura que o requireUser fez para o RN-15.
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
 * qualquer outro 403 (papel errado, conta suspensa, 2FA do admin, conta sem consultório).
 */
export type MotivoDaRecusa = 'sem_sessao' | 'dpa_pendente' | 'papel';

export type ApiNutri = ({ ok: true } & NutriAccess) | { ok: false; response: Response; motivo: MotivoDaRecusa };

/**
 * F7: requireNutri para Route Handlers — mesma regra de sessão (requireApiUser: 401/403) e do
 * DPA da versão atual (403 com MSG_DPA_PENDENTE), devolvendo o tenant e o contexto com ator e IP.
 * `renovar: false` (P12-14): rota que só devolve estado para o polling da tela — confere, mas não conta como uso.
 * Recusa: a resposta de sempre (status e corpo não mudam) e o `motivo`, para quem precisa responder de outro jeito.
 */
export async function requireApiNutri(req: Request, opts: { renovar?: boolean } = {}): Promise<ApiNutri> {
  const auth = await requireApiUser(req, ['nutri'], opts);
  if (!auth.ok) return { ...auth, motivo: auth.response.status === 401 ? 'sem_sessao' : 'papel' };
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
