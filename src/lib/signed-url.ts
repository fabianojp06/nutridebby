import { createHmac } from 'node:crypto';
import { getEnv } from '@/env';
import { safeEqual } from './crypto';

export const FILE_URL_TTL_S = 300; // §4: TTL 5 min

/** <tenant>/<tipo>/<arquivo>.<ext> — o único formato servido (sem SVG, sem "..", sem caminho absoluto). */
export const CAMINHO_ARQUIVO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z_]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|heic|pdf|zip)$/;

const assinar = (caminho: string, exp: number, secret: string) =>
  createHmac('sha256', secret).update(`${caminho}\n${exp}`).digest('base64url');

type Opts = { now?: Date; secret?: string };

export function signFileUrl(caminho: string, opts: Opts = {}): string {
  if (!CAMINHO_ARQUIVO.test(caminho)) throw new Error('caminho de arquivo inválido');
  const secret = opts.secret ?? getEnv().FILE_URL_SECRET;
  const exp = Math.floor((opts.now ?? new Date()).getTime() / 1000) + FILE_URL_TTL_S;
  return `/api/arquivos?${new URLSearchParams({ c: caminho, e: String(exp), s: assinar(caminho, exp, secret) })}`;
}

export type VerificacaoUrl =
  | { ok: true; caminho: string; exp: number }
  | { ok: false; motivo: 'assinatura' | 'expirado' | 'caminho' };

export function verifyFileUrl(params: URLSearchParams, opts: Opts = {}): VerificacaoUrl {
  const caminho = params.get('c') ?? '';
  const exp = Number(params.get('e'));
  if (!CAMINHO_ARQUIVO.test(caminho)) return { ok: false, motivo: 'caminho' };
  if (!Number.isSafeInteger(exp)) return { ok: false, motivo: 'assinatura' };
  const secret = opts.secret ?? getEnv().FILE_URL_SECRET;
  if (!safeEqual(params.get('s') ?? '', assinar(caminho, exp, secret))) return { ok: false, motivo: 'assinatura' };
  if (exp * 1000 < (opts.now ?? new Date()).getTime()) return { ok: false, motivo: 'expirado' };
  return { ok: true, caminho, exp };
}
