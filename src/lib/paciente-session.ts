import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { MSG_TERMO_NAO_ACEITO } from '@/modules/pacientes/termo-paciente';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { PARAM_VINCULO } from '@/modules/portal/link-portal';
import { termoAceito } from '@/modules/portal/termo';
import { escolherVinculo, vinculosDaConta, type Vinculo } from '@/modules/portal/vinculos';
import { recusaApi, requireApiUser } from './api-auth';
import { clientIp } from './ip';
import { lerCookie } from './ler-cookie';
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
/** Grava o `nd_vinculo` pedido por um link (`?v=`) e volta para a página (Server Component não grava cookie). */
export const TROCAR_VINCULO_PATH = '/api/p/vinculo';
const TRINTA_DIAS_S = 30 * 24 * 60 * 60;

export type PacienteAccess = { data: SessionData; tenant: TenantRow; vinculo: Vinculo; vinculos: Vinculo[]; ctx: TenantContext };

/** Atributos do `nd_vinculo` num lugar só (escolha, renovação e "Sair"); `Secure` só quando o app é servido em https. */
export const OPCOES_COOKIE_VINCULO = { path: '/', maxAge: TRINTA_DIAS_S, httpOnly: true, sameSite: 'lax' } as const;

export function cookieVinculoSeguro(): boolean {
  return getEnv().APP_URL.startsWith('https://');
}

/** O cookie do vínculo escolhido; regravado a cada abertura do portal (POST /api/p/acesso) para deslizar os 30 dias. */
export function cookieDoVinculo(tenantId: string, secure: boolean): string {
  return `${COOKIE_VINCULO}=${tenantId}; Path=/; Max-Age=${OPCOES_COOKIE_VINCULO.maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** "Sair" (D3): o vínculo escolhido sai com a sessão — senão a próxima conta no aparelho herda a escolha. */
export function cookieDoVinculoApagado(secure: boolean): string {
  return `${COOKIE_VINCULO}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export { lerCookie } from './ler-cookie';

/**
 * Destino de volta dentro do portal (escolha do consultório, troca pelo link): só uma página do portal que não seja a
 * própria escolha, sem o `?v=` (senão o link venceria a escolha feita depois); senão, o Início.
 */
export function voltaDoPortal(volta: string | null | undefined): string {
  const destino = safeReturnPath(volta);
  if (!destino?.startsWith('/p/') || destino.startsWith(ESCOLHER_PATH)) return '/p/inicio';
  const u = new URL(destino, 'http://interno.invalid');
  u.searchParams.delete(PARAM_VINCULO);
  return `${u.pathname}${u.search}`;
}

/** S-1: depois do aceite do termo, o destino que levou ao termo (voltaDoPortal), nunca a própria tela do termo. */
export function voltaDoTermo(volta: string | null | undefined): string {
  const destino = voltaDoPortal(volta);
  return destino.split('?')[0] === TERMO_PATH ? '/p/inicio' : destino;
}

/** O consultório pedido pelo link (`?v=` da página atual, que o proxy repassa); só uma preferência, reconferida. */
function vinculoDoLink(caminho: string | null): string | undefined {
  const atual = safeReturnPath(caminho);
  return atual ? (new URL(atual, 'http://interno.invalid').searchParams.get(PARAM_VINCULO) ?? undefined) : undefined;
}

type Acesso =
  | { ok: true; tenant: TenantRow; vinculo: Vinculo; vinculos: Vinculo[] }
  | { ok: false; motivo: 'sem_acesso' | 'escolher' | 'suspensa' | 'termo' }
  | { ok: false; motivo: 'trocar'; tenantId: string };

/**
 * A regra única do portal, comum à página e à API: vínculo ativo escolhido (D3, RN-08), consultório não suspenso
 * (RN-15) e termo da versão atual aceito neste consultório (US-011), nessa ordem. `pedido` (o `?v=` do link) vale antes
 * do cookie só se for vínculo ativo da conta (escolherVinculo). `regravar` (páginas): pedido válido diferente do cookie →
 * `trocar`, para gravar o cookie ANTES de seguir — as próximas telas (menu, sem `?v=`) e o termo ficam no mesmo consultório.
 */
async function acessoDaConta(userId: string, o: { cookie: string | undefined; pedido?: string; exigirTermo: boolean; regravar: boolean }): Promise<Acesso> {
  const vinculos = await vinculosDaConta(userId);
  const r = escolherVinculo(vinculos, o.cookie, o.pedido);
  if (r.tipo !== 'ok') return { ok: false, motivo: r.tipo };
  if (o.regravar && vinculos.length > 1 && r.vinculo.tenantId === o.pedido && o.pedido !== o.cookie) {
    return { ok: false, motivo: 'trocar', tenantId: r.vinculo.tenantId };
  }
  const tenant = await buscarTenant(getDb(), r.vinculo.tenantId);
  if (!tenant) return { ok: false, motivo: 'sem_acesso' };
  if (tenant.status === 'suspensa') return { ok: false, motivo: 'suspensa' };
  if (o.exigirTermo && !(await termoAceito(userId, tenant.id))) return { ok: false, motivo: 'termo' };
  return { ok: true, tenant, vinculo: r.vinculo, vinculos };
}

/**
 * Entrada de toda página e Server Action do portal (o par do requireNutri): sessão de paciente válida (requireUser),
 * vínculo ativo escolhido (D3, RN-08), consultório não suspenso (RN-15), termo atual aceito (US-011; a própria tela
 * do termo passa `permitirTermoPendente`) e o contexto pronto para withTenant.
 */
export async function requirePaciente(path: string, o: { permitirTermoPendente?: boolean } = {}): Promise<PacienteAccess> {
  const { data } = await requireUserComTenant(['paciente'], path);
  const atual = (await headers()).get(CURRENT_PATH_HEADER);
  const a = await acessoDaConta(data.user.id, {
    cookie: (await cookies()).get(COOKIE_VINCULO)?.value,
    pedido: vinculoDoLink(atual),
    exigirTermo: !o.permitirTermoPendente,
    regravar: true,
  });
  if (!a.ok) {
    switch (a.motivo) {
      case 'sem_acesso':
        redirect(SEM_ACESSO_PATH);
      case 'escolher':
        redirect(`${ESCOLHER_PATH}?volta=${encodeURIComponent(voltaDoPortal(safeReturnPath(atual) ?? path))}`);
      case 'trocar':
        // link de outro consultório (e-mail, push): a rota confere de novo, grava o nd_vinculo e volta sem o `?v=`
        redirect(`${TROCAR_VINCULO_PATH}?${PARAM_VINCULO}=${encodeURIComponent(a.tenantId)}&volta=${encodeURIComponent(voltaDoPortal(safeReturnPath(atual) ?? path))}`);
      case 'suspensa':
        redirect(SUSPENDED_PATH);
      case 'termo': {
        // S-1: o destino (link da exportação, push) segue em ?volta= e o aceite volta para ele; o Início é o padrão
        const volta = voltaDoTermo(safeReturnPath(atual) ?? path);
        redirect(volta === '/p/inicio' ? TERMO_PATH : `${TERMO_PATH}?volta=${encodeURIComponent(volta)}`);
      }
      default: {
        const nunca: never = a;
        throw new Error(`Motivo de acesso desconhecido: ${String((nunca as { motivo?: unknown }).motivo)}`);
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

/**
 * requirePaciente para Route Handlers: 401/403 (requireApiUser); 403 sem vínculo escolhido (com `motivo: 'escolher'`), com
 * consultório suspenso ou termo pendente. O `?v=` da própria URL vale como na página (só vínculo ativo da conta); quem
 * regrava o cookie é a resposta (POST /api/p/acesso grava o do consultório usado).
 */
export async function requireApiPaciente(req: Request): Promise<ApiPaciente> {
  const auth = await requireApiUser(req, ['paciente']);
  if (!auth.ok) return auth;
  const a = await acessoDaConta(auth.data.user.id, {
    cookie: lerCookie(req.headers.get('cookie'), COOKIE_VINCULO),
    pedido: new URL(req.url).searchParams.get(PARAM_VINCULO) ?? undefined,
    exigirTermo: true,
    regravar: false,
  });
  if (!a.ok) {
    // S-4: vínculo a escolher leva o motivo, para a tela oferecer o link da escolha (o texto continua "Acesso negado")
    if (a.motivo === 'escolher') return recusaApi(403, RECUSA_API.escolher, { motivo: 'escolher' });
    return recusaApi(403, a.motivo === 'trocar' ? 'Acesso negado' : RECUSA_API[a.motivo]);
  }
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
