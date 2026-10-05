import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { encryptionKey } from '@/lib/crypto';
import { urlDoApp } from '@/lib/url-do-app';
import { normalizarEmailDoLink } from '@/modules/agenda/link-consulta';

/**
 * RN-158 / D3 b: link de uso único SEM ESTADO (como link-consulta.ts): versão + tenant + paciente + documento + emissão
 * (segundos), MAC de 128 bits com o e-mail ATUAL do paciente (corrigido o e-mail, o link morre). Válido por 30 dias (D6 ★)
 * e só enquanto o documento estiver assinado (conferido por quem lê). A T12 acrescenta o código e a sessão (e põe este
 * arquivo em SEM_CONTA_PERMITIDOS, R6).
 */
const VERSAO = 1;
export const VALIDADE_LINK_MS = 30 * 86_400_000;
let chave: Buffer | undefined;
export const chaveDoLinkDocumento = () => (chave ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:link-documento:v1', 32)));
const uuidBytes = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex');
const bytesUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const mac = (corpo: Buffer, email: string) =>
  createHmac('sha256', chaveDoLinkDocumento()).update(corpo).update(createHash('sha256').update(normalizarEmailDoLink(email), 'utf8').digest()).digest().subarray(0, 16);

export type IdsDoLink = { tenantId: string; patientId: string; documentoId: string };

export function assinarLinkDocumento(l: IdsDoLink & { emitidoEm: Date; email: string }): string {
  const corpo = Buffer.alloc(53);
  corpo.writeUInt8(VERSAO, 0);
  uuidBytes(l.tenantId).copy(corpo, 1);
  uuidBytes(l.patientId).copy(corpo, 17);
  uuidBytes(l.documentoId).copy(corpo, 33);
  corpo.writeUInt32BE(Math.floor(l.emitidoEm.getTime() / 1000), 49);
  return Buffer.concat([corpo, mac(corpo, l.email)]).toString('base64url');
}

/** null = formato, versão ou MAC inválidos (inclusive e-mail corrigido). `carregar` recebe ids AINDA NÃO autenticados. */
export async function lerLinkDocumento<T extends { email: string }>(
  token: unknown,
  agora: Date,
  carregar: (ids: IdsDoLink) => Promise<T | null>,
): Promise<{ ids: IdsDoLink; emitidoEm: Date; expirado: boolean; dados: T } | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{92}$/.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  if (b.length !== 69 || b.toString('base64url') !== token || b.readUInt8(0) !== VERSAO) return null;
  const corpo = b.subarray(0, 53);
  const ids = { tenantId: bytesUuid(corpo.subarray(1, 17)), patientId: bytesUuid(corpo.subarray(17, 33)), documentoId: bytesUuid(corpo.subarray(33, 49)) };
  const dados = await carregar(ids);
  // Minor 8 (revisão de segurança): sem e-mail no cadastro, o link não abre (nunca normalizarEmailDoLink(null) → 500)
  if (!dados || !dados.email || !timingSafeEqual(mac(corpo, dados.email), b.subarray(53))) return null;
  const emitidoEm = new Date(corpo.readUInt32BE(49) * 1000);
  return { ids, emitidoEm, expirado: agora.getTime() - emitidoEm.getTime() > VALIDADE_LINK_MS, dados };
}

export const urlDoLinkDocumento = (appUrl: string, token: string) => urlDoApp(appUrl, `/documento/${token}`);
