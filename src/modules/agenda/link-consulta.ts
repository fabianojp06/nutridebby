import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { urlDoApp } from '@/lib/url-do-app';

const VERSAO = 1;
const uuidParaBytes = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex');
const bytesParaUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export type LinkConsulta = { tenantId: string; appointmentId: string; expiraEm: Date };

/** D20: chave só dos links, derivada (HKDF) de ENCRYPTION_KEY — app e worker já têm; nenhuma variável nova. */
export function chaveDosLinks(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, Buffer.alloc(0), 'nutridebby:link-consulta:v1', 32));
}

/** O e-mail como entra na assinatura: `patients.email` é citext — maiúsculas e espaços nas pontas não mudam o endereço. */
export const normalizarEmailDoLink = (email: string) => email.trim().toLowerCase();
const emailDoLink = (email: string) => createHash('sha256').update(normalizarEmailDoLink(email), 'utf8').digest();

/**
 * Decisão do dono (fechamento do Plano 05): o e-mail atual do paciente entra no MAC (não no token). Corrigido o e-mail,
 * todo link emitido antes deixa de conferir — sem estado novo (como o início da consulta, que já está no token).
 */
const mac = (corpo: Buffer, email: string, chave: Buffer) => createHmac('sha256', chave).update(corpo).update(emailDoLink(email)).digest().subarray(0, 16);

/** Versão + tenant + consulta + validade (início da consulta, em segundos) + HMAC truncado em 128 bits (com o e-mail do paciente). */
export function assinarLinkConsulta(c: { tenantId: string; appointmentId: string; inicio: Date; email: string }, chave: Buffer): string {
  const corpo = Buffer.alloc(37);
  corpo.writeUInt8(VERSAO, 0);
  uuidParaBytes(c.tenantId).copy(corpo, 1);
  uuidParaBytes(c.appointmentId).copy(corpo, 17);
  corpo.writeUInt32BE(Math.floor(c.inicio.getTime() / 1000), 33);
  return Buffer.concat([corpo, mac(corpo, c.email, chave)]).toString('base64url');
}

/**
 * Lê o token e confere a assinatura com o e-mail ATUAL do paciente. `carregar` recebe os ids do token — ainda NÃO
 * autenticados — e lê, no contexto que quem chama já usa, o e-mail do paciente da consulta (com o que mais precisar);
 * nada do que ele devolve sai daqui sem a assinatura conferir (comparação em tempo constante). null = formato, versão,
 * consulta inexistente ou assinatura inválidos (inclusive e-mail corrigido depois do link). `expirado` = a consulta já
 * começou (no início do token).
 */
export async function lerLinkConsulta<T extends { email: string }>(
  token: unknown,
  chave: Buffer,
  agora: Date,
  carregar: (ids: { tenantId: string; appointmentId: string }) => Promise<T | null>,
): Promise<{ link: LinkConsulta & { expirado: boolean }; dados: T } | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{71}$/.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  // forma canônica: o último caractere tem 2 bits que o decodificador ignora — um link, uma grafia só
  if (b.length !== 53 || b.toString('base64url') !== token || b.readUInt8(0) !== VERSAO) return null;
  const corpo = b.subarray(0, 37);
  const ids = { tenantId: bytesParaUuid(corpo.subarray(1, 17)), appointmentId: bytesParaUuid(corpo.subarray(17, 33)) };
  const dados = await carregar(ids);
  if (!dados || !timingSafeEqual(mac(corpo, dados.email, chave), b.subarray(37))) return null;
  const expiraEm = new Date(corpo.readUInt32BE(33) * 1000);
  return { link: { ...ids, expiraEm, expirado: expiraEm.getTime() <= agora.getTime() }, dados };
}

/**
 * O token guarda o início da consulta (em segundos) de quando foi assinado. Revisão da T5: a consulta que a nutricionista
 * moveu depois tem outro início — o link antigo não vale mais para ela (nem até o início antigo, nem depois).
 */
export const noInicioDoLink = (inicio: Date, inicioDoLink: Date) => Math.floor(inicio.getTime() / 1000) === Math.floor(inicioDoLink.getTime() / 1000);

export const urlDaConsulta = (appUrl: string, token: string) => urlDoApp(appUrl, `/consulta/${token}`);
