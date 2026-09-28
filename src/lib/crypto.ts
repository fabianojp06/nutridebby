import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { encryptionKeySchema } from '@/env';

export class SealError extends Error {
  override name = 'SealError';
}

/** Token aleatório de `bytes` bytes em base64url (padrão: 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 em base64url — para guardar tokens de alta entropia sem guardá-los em claro. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

let cachedKey: Buffer | undefined;
/** Chave de ENCRYPTION_KEY (validada), usada pelo app e pelo worker. */
export function encryptionKey(): Buffer {
  return (cachedKey ??= Buffer.from(encryptionKeySchema.parse(process.env.ENCRYPTION_KEY), 'base64'));
}

/**
 * AES-256-GCM. A `finalidade` entra como AAD: um segredo selado para a fila de e-mail
 * não abre em outro uso. Formato: v1.<iv>.<cifrado>.<tag> (base64url).
 */
export function sealSecret(plain: string, finalidade: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(finalidade, 'utf8'));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

export function openSecret(sealed: string, finalidade: string, key: Buffer = encryptionKey()): string {
  const [v, iv, ct, tag, ...resto] = sealed.split('.');
  if (v !== 'v1' || !iv || ct === undefined || !tag || resto.length) throw new SealError('formato inválido');
  const ivBuf = Buffer.from(iv, 'base64url');
  const tagBuf = Buffer.from(tag, 'base64url');
  // Sem isso, o Node aceita (com só um aviso DEP0182) uma tag GCM truncada — ex.: 4 bytes em
  // vez de 16 — o que facilita forjar autenticação; exigir authTagLength e checar antes recusa
  // o selo sem sequer chamar o decipher.
  if (ivBuf.length !== 12) throw new SealError('IV de tamanho inválido');
  if (tagBuf.length !== 16) throw new SealError('tag de autenticação de tamanho inválido');
  try {
    const d = createDecipheriv('aes-256-gcm', key, ivBuf, { authTagLength: 16 });
    d.setAAD(Buffer.from(finalidade, 'utf8'));
    d.setAuthTag(tagBuf);
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    throw new SealError('não foi possível abrir o segredo');
  }
}
