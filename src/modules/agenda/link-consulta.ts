import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
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

const mac = (corpo: Buffer, chave: Buffer) => createHmac('sha256', chave).update(corpo).digest().subarray(0, 16);

/** Versão + tenant + consulta + validade (início da consulta, em segundos) + HMAC truncado em 128 bits. */
export function assinarLinkConsulta(c: { tenantId: string; appointmentId: string; inicio: Date }, chave: Buffer): string {
  const corpo = Buffer.alloc(37);
  corpo.writeUInt8(VERSAO, 0);
  uuidParaBytes(c.tenantId).copy(corpo, 1);
  uuidParaBytes(c.appointmentId).copy(corpo, 17);
  corpo.writeUInt32BE(Math.floor(c.inicio.getTime() / 1000), 33);
  return Buffer.concat([corpo, mac(corpo, chave)]).toString('base64url');
}

/** null = formato, versão ou assinatura inválidos. `expirado` = a consulta já começou. */
export function lerLinkConsulta(token: string, chave: Buffer, agora: Date): (LinkConsulta & { expirado: boolean }) | null {
  if (!/^[A-Za-z0-9_-]{71}$/.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  // forma canônica: o último caractere tem 2 bits que o decodificador ignora — um link, uma grafia só
  if (b.length !== 53 || b.toString('base64url') !== token || b.readUInt8(0) !== VERSAO) return null;
  const corpo = b.subarray(0, 37);
  if (!timingSafeEqual(mac(corpo, chave), b.subarray(37))) return null;
  const expiraEm = new Date(corpo.readUInt32BE(33) * 1000);
  return { tenantId: bytesParaUuid(corpo.subarray(1, 17)), appointmentId: bytesParaUuid(corpo.subarray(17, 33)), expiraEm, expirado: expiraEm.getTime() <= agora.getTime() };
}

/**
 * O token guarda o início da consulta (em segundos) de quando foi assinado. Revisão da T5: a consulta que a nutricionista
 * moveu depois tem outro início — o link antigo não vale mais para ela (nem até o início antigo, nem depois).
 */
export const noInicioDoLink = (inicio: Date, inicioDoLink: Date) => Math.floor(inicio.getTime() / 1000) === Math.floor(inicioDoLink.getTime() / 1000);

export const urlDaConsulta = (appUrl: string, token: string) => urlDoApp(appUrl, `/consulta/${token}`);
