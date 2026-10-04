import { getEnv } from '@/env';
import { requireApiUser, type ApiAuth } from '@/lib/api-auth';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { clientIp } from '@/lib/ip';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiPaciente, type PacienteAccess } from '@/lib/paciente-session';
import { cancelarAparelho, InscricaoInvalidaError, inscreverAparelho, MSG_PUSH } from '@/modules/portal/push-inscricao';

export const dynamic = 'force-dynamic';

/** A inscrição do navegador (`PushSubscription.toJSON()`) tem poucas centenas de bytes. */
const CORPO_MAX = 4096;

const resposta = (status: number, corpo?: unknown) =>
  corpo === undefined ? new Response(null, { status, headers: { 'cache-control': 'no-store' } }) : Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });

async function json(req: Request): Promise<unknown> {
  const corpo = await lerCorpoLimitado(req, CORPO_MAX);
  return JSON.parse(new TextDecoder().decode(corpo));
}

/** Mesma origem (ou sem Origin) e o corpo em JSON; `autorizar` decide a sessão exigida (antes de ler o corpo). */
async function entrada<T>(
  req: Request,
  autorizar: (req: Request) => Promise<({ ok: true } & T) | { ok: false; response: Response }>,
): Promise<{ ok: false; erro: Response } | { ok: true; acesso: T; corpo: unknown }> {
  if (!mesmaOrigem(req)) return { ok: false, erro: resposta(403) };
  const acesso = await autorizar(req);
  if (!acesso.ok) return { ok: false, erro: acesso.response };
  try {
    return { ok: true, acesso, corpo: await json(req) };
  } catch (e) {
    return { ok: false, erro: resposta(e instanceof CorpoGrandeError ? 413 : 400, { erro: MSG_PUSH.falhou }) };
  }
}

/**
 * US-040 "Ativar notificações": grava a inscrição do aparelho (todos os vínculos) e pede o push de teste.
 * `?sincronizar=1` (abertura do portal com inscrição no navegador, Review Focus 4): reatribui sem push de teste;
 * 409 = a inscrição era de outra conta (ou de ninguém) — o cliente a descarta e mostra "Ativar notificações".
 */
export async function POST(req: Request): Promise<Response> {
  if (!getEnv().VAPID_PUBLIC_KEY) return resposta(503, { erro: MSG_PUSH.indisponivel });
  const e = await entrada<PacienteAccess>(req, requireApiPaciente);
  if (!e.ok) return e.erro;
  const sincronizar = new URL(req.url).searchParams.get('sincronizar') === '1';
  try {
    const r = await inscreverAparelho(e.acesso, e.corpo, req.headers.get('user-agent'), { sincronizar });
    return resposta(r === 'inscrito' ? 204 : 409);
  } catch (err) {
    if (err instanceof InscricaoInvalidaError) return resposta(400, { erro: MSG_PUSH.falhou });
    throw err;
  }
}

/**
 * "Sair" e desativar: o endpoint deste aparelho sai de todos os vínculos da conta. Basta a sessão de paciente (S-2): o
 * "Sair" de /p/termo, /p/escolher, /p/sem-acesso e /indisponivel não tem termo aceito nem vínculo escolhido.
 */
export async function DELETE(req: Request): Promise<Response> {
  const e = await entrada<ApiAuth & { ok: true }>(req, (r) => requireApiUser(r, ['paciente']));
  if (!e.ok) return e.erro;
  const conta = { userId: e.acesso.data.user.id, ip: clientIp(req.headers, getEnv().TRUSTED_PROXIES) };
  await cancelarAparelho(conta, (e.corpo as { endpoint?: unknown } | null)?.endpoint);
  return resposta(204);
}
