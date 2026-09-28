import 'server-only';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { requestIp } from './request-ip';
import { requireUser, type SessionData } from './session';

export const DPA_PATH = '/painel/dpa';

export type NutriAccess = { data: SessionData; tenant: TenantRow; ctx: TenantContext };

/**
 * Entrada de toda página e Server Action da nutricionista: sessão válida (requireUser),
 * DPA da versão atual aceito e o contexto do tenant pronto para withTenant (com ator e IP).
 */
export async function requireNutri(path: string, opts: { permitirDpaPendente?: boolean } = {}): Promise<NutriAccess> {
  const data = await requireUser(['nutri'], path);
  const tenantId = data.user.tenantId;
  if (!tenantId) throw new Error('Conta de nutricionista sem tenant');
  const tenant = await buscarTenant(getDb(), tenantId);
  if (!tenant) throw new Error('Tenant da nutricionista não encontrado');
  if (!opts.permitirDpaPendente && tenant.dpaVersao !== DPA_VERSAO) redirect(DPA_PATH);
  return { data, tenant, ctx: { tenantId, role: 'nutri', actorUserId: data.user.id, ip: await requestIp() } };
}
