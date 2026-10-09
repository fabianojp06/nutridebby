import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { encryptionKey } from '@/lib/crypto';
import { urlDoApp } from '@/lib/url-do-app';
import { normalizarEmailDoLink } from '@/modules/agenda/link-consulta';
import type { DestinoIA } from './constantes';

/**
 * RN-107 / D11 / D12 (Plano 14A): os links da autorização de IA, SEM ESTADO, no molde de link-documento.ts.
 * Pedido (tipo 1): versão + tipo + tenant + paciente + emissão (segundos) e MAC com o e-mail ATUAL do paciente (corrigido o
 * e-mail, o link morre); vale 7 dias (quem lê confere). Retirada (tipo 2): versão + tipo + tenant + paciente + id da
 * autorização e MAC só com a chave — não vence e não depende do e-mail (D11): deixa de valer quando aquela autorização deixa
 * de ser a decisão mais recente (quem lê confere). MAC de 128 bits, chave derivada própria. Sem o código de 6 dígitos do link
 * de documentos (decisão do dono, 08/10/2026): a página não mostra dado de saúde e o código iria ao mesmo e-mail.
 */
const VERSAO = 1;
const TIPO_PEDIDO = 1;
const TIPO_RETIRADA = 2;
let chaveLink: Buffer | undefined;
let chaveEmail: Buffer | undefined;
const chaveDoLink = () => (chaveLink ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:link-autorizacao-ia:v1', 32)));
const chaveDoEmail = () => (chaveEmail ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:email-autorizacao-ia:v1', 32)));
const uuidBytes = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex');
const bytesUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const mac = (corpo: Buffer, email: string | null) => {
  const h = createHmac('sha256', chaveDoLink()).update(corpo);
  if (email !== null) h.update(createHash('sha256').update(normalizarEmailDoLink(email), 'utf8').digest());
  return h.digest().subarray(0, 16);
};

/** RN-107: o HMAC do e-mail para onde o link foi (nunca o e-mail em claro) — 43 caracteres base64url. */
export const emailHmac = (email: string): string => createHmac('sha256', chaveDoEmail()).update(normalizarEmailDoLink(email), 'utf8').digest('base64url');

export function assinarLinkPedido(l: { tenantId: string; patientId: string; emitidoEm: Date; email: string }): string {
  const corpo = Buffer.alloc(38);
  corpo.writeUInt8(VERSAO, 0);
  corpo.writeUInt8(TIPO_PEDIDO, 1);
  uuidBytes(l.tenantId).copy(corpo, 2);
  uuidBytes(l.patientId).copy(corpo, 18);
  corpo.writeUInt32BE(Math.floor(l.emitidoEm.getTime() / 1000), 34);
  return Buffer.concat([corpo, mac(corpo, l.email)]).toString('base64url'); // 54 bytes → 72 caracteres
}

export function assinarLinkRetirada(l: { tenantId: string; patientId: string; autorizacaoId: string }): string {
  const corpo = Buffer.alloc(50);
  corpo.writeUInt8(VERSAO, 0);
  corpo.writeUInt8(TIPO_RETIRADA, 1);
  uuidBytes(l.tenantId).copy(corpo, 2);
  uuidBytes(l.patientId).copy(corpo, 18);
  uuidBytes(l.autorizacaoId).copy(corpo, 34);
  return Buffer.concat([corpo, mac(corpo, null)]).toString('base64url'); // 66 bytes → 88 caracteres
}

export type LinkDecodificado =
  | { tipo: 'pedido'; tenantId: string; patientId: string; emitidoEm: Date }
  | { tipo: 'retirada'; tenantId: string; patientId: string; autorizacaoId: string };

/**
 * Formato, versão e tipo; os ids devolvidos AINDA NÃO estão autenticados: quem lê carrega o paciente (no contexto dele) e
 * chama `confere(email atual)` — no pedido, o MAC com o e-mail; na retirada, o e-mail é ignorado.
 */
export function lerLinkAutorizacao(token: unknown): (LinkDecodificado & { confere: (email: string | null) => boolean }) | null {
  if (typeof token !== 'string' || !/^(?:[A-Za-z0-9_-]{72}|[A-Za-z0-9_-]{88})$/.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  if (b.toString('base64url') !== token || b.readUInt8(0) !== VERSAO) return null;
  const tipo = b.readUInt8(1);
  const tenantId = bytesUuid(b.subarray(2, 18));
  const patientId = bytesUuid(b.subarray(18, 34));
  if (tipo === TIPO_PEDIDO && b.length === 54) {
    const corpo = b.subarray(0, 38);
    return { tipo: 'pedido', tenantId, patientId, emitidoEm: new Date(corpo.readUInt32BE(34) * 1000), confere: (email) => !!email && timingSafeEqual(mac(corpo, email), b.subarray(38)) };
  }
  if (tipo === TIPO_RETIRADA && b.length === 66) {
    const corpo = b.subarray(0, 50);
    return { tipo: 'retirada', tenantId, patientId, autorizacaoId: bytesUuid(corpo.subarray(34, 50)), confere: () => timingSafeEqual(mac(corpo, null), b.subarray(50)) };
  }
  return null;
}

export const urlDoLinkAutorizacao = (appUrl: string, token: string) => urlDoApp(appUrl, `/autorizacao-ia/${token}`);

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const [QUATRO, CINCO, MASCARA] = [BigInt(4), BigInt(5), BigInt(31)];
/**
 * US-108 / RN-107: o código de referência do termo impresso — HMAC curto de tenant, paciente, versão e destino, 12
 * caracteres em base32 Crockford (o alfabeto do código dos documentos), "XXXX-XXXX-XXXX". RN-109 (revisão final): com o
 * destino na entrada, trocado o provedor entre a impressão e o registro, o código do papel deixa de bater com o de agora;
 * a nutricionista digita o código lido no papel e `registrarTermoEmPapel` recusa o que não bate.
 */
export function codigoDeReferencia(tenantId: string, patientId: string, versao: string, destino: DestinoIA): string {
  let n = createHmac('sha256', chaveDoLink()).update(`referencia:${tenantId}:${patientId}:${versao}:${destino}`).digest().readBigUInt64BE() >> QUATRO;
  let s = '';
  for (let i = 0; i < 12; i++) {
    s = ALFABETO[Number(n & MASCARA)] + s;
    n >>= CINCO;
  }
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
