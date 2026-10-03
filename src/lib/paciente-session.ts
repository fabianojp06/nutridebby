import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { MSG_TERMO_NAO_ACEITO } from '@/modules/pacientes/termo-paciente';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { termoAceito } from '@/modules/portal/termo';
import { escolherVinculo, vinculosDaConta, type Vinculo } from '@/modules/portal/vinculos';
import { recusaApi, requireApiUser } from './api-auth';
import { clientIp } from './ip';
import { requestIp } from './request-ip';
import { CURRENT_PATH_HEADER, safeReturnPath } from './safe-return';
import { requireUserComTenant, type SessionData } from './session';
import { SUSPENDED_PATH } from './session-rules';

/** D3: o vínculo (consultório) escolhido. Só o tenantId; reconferido contra vinculosDaConta a cada requisição. */
export const COOKIE_VINCULO = 'nd_vinculo';
export const ESCOLHER_PATH = '/p/escolher';
export const SEM_ACESSO_PATH = '/p/sem-acesso';
/** US-011 "Nova versão do termo": antes de usar o portal, aceitar a versão atual. */
export const TERMO_PATH = '/p/termo';
const TRINTA_DIAS_S = 30 * 24 * 60 * 60;

export type PacienteAccess = { data: SessionData; tenant: TenantRow; vinculo: Vinculo; vinculos: Vinculo[]; ctx: TenantContext };

export function cookieDoVinculo(tenantId: string, secure: boolean): string {
  return `${COOKIE_VINCULO}=${tenantId}; Path=/; Max-Age=${TRINTA_DIAS_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function lerCookie(header: string | null, nome: string): string | undefined {
  for (const parte of (header ?? '').split(';')) {
    const [n, ...v] = parte.trim().split('=');
    if (n === nome) return v.join('=');
  }
  return undefined;
}

type Acesso =
  | { ok: true; tenant: TenantRow; vinculo: Vinculo; vinculos: Vinculo[] }
  | { ok: false; motivo: 'sem_acesso' | 'escolher' | 'suspensa' | 'termo' };

/**
 * A regra única do portal, comum à página e à API: vínculo ativo escolhido (D3, RN-08), consultório não suspenso
 * (RN-15) e termo da versão atual aceito neste consultório (US-011), nessa ordem.
 */
async function acessoDaConta(userId: string, cookie: string | undefined, exigirTermo: boolean): Promise<Acesso> {
  const vinculos = await vinculosDaConta(userId);
  const r = escolherVinculo(vinculos, cookie);
  if (r.tipo !== 'ok') return { ok: false, motivo: r.tipo };
  const tenant = await buscarTenant(getDb(), r.vinculo.tenantId);
  if (!tenant) return { ok: false, motivo: 'sem_acesso' };
  if (tenant.status === 'suspensa') return { ok: false, motivo: 'suspensa' };
  if (exigirTermo && !(await termoAceito(userId, tenant.id))) return { ok: false, motivo: 'termo' };
  return { ok: true, tenant, vinculo: r.vinculo, vinculos };
}

/**
 * Entrada de toda página e Server Action do portal (o par do requireNutri): sessão de paciente válida (requireUser),
 * vínculo ativo escolhido (D3, RN-08), consultório não suspenso (RN-15), termo atual aceito (US-011; a própria tela
 * do termo passa `permitirTermoPendente`) e o contexto pronto para withTenant.
 */
export async function requirePaciente(path: string, o: { permitirTermoPendente?: boolean } = {}): Promise<PacienteAccess> {
  const { data } = await requireUserComTenant(['paciente'], path);
  const a = await acessoDaConta(data.user.id, (await cookies()).get(COOKIE_VINCULO)?.value, !o.permitirTermoPendente);
  if (!a.ok) {
    switch (a.motivo) {
      case 'sem_acesso':
        redirect(SEM_ACESSO_PATH);
      case 'escolher': {
        const volta = safeReturnPath((await headers()).get(CURRENT_PATH_HEADER)) ?? path;
        redirect(`${ESCOLHER_PATH}?volta=${encodeURIComponent(volta)}`);
      }
      case 'suspensa':
        redirect(SUSPENDED_PATH);
      case 'termo':
        redirect(TERMO_PATH);
      default: {
        const nunca: never = a.motivo;
        throw new Error(`Motivo de acesso desconhecido: ${String(nunca)}`);
      }
    }
  }
  return {
    data,
    tenant: a.tenant,
    vinculo: a.vinculo,
    vinculos: a.vinculos,
    ctx: { tenantId: a.tenant.id, role: 'paciente', patientId: a.vinculo.patientId, actorUserId: data.user.id, ip: await requestIp() },
  };
}

export type ApiPaciente = ({ ok: true } & PacienteAccess) | { ok: false; response: Response };

const RECUSA_API = {
  sem_acesso: 'Acesso negado',
  escolher: 'Acesso negado',
  suspensa: 'Conta temporariamente indisponível',
  termo: MSG_TERMO_NAO_ACEITO,
} as const;

/** requirePaciente para Route Handlers: 401/403 (requireApiUser); 403 sem vínculo escolhido, com consultório suspenso ou termo pendente. */
export async function requireApiPaciente(req: Request): Promise<ApiPaciente> {
  const auth = await requireApiUser(req, ['paciente']);
  if (!auth.ok) return auth;
  const a = await acessoDaConta(auth.data.user.id, lerCookie(req.headers.get('cookie'), COOKIE_VINCULO), true);
  if (!a.ok) return recusaApi(403, RECUSA_API[a.motivo]);
  return {
    ok: true,
    data: auth.data,
    tenant: a.tenant,
    vinculo: a.vinculo,
    vinculos: a.vinculos,
    ctx: {
      tenantId: a.tenant.id,
      role: 'paciente',
      patientId: a.vinculo.patientId,
      actorUserId: auth.data.user.id,
      ip: clientIp(req.headers, getEnv().TRUSTED_PROXIES),
    },
  };
}
