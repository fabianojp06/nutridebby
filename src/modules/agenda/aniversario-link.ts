import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { encryptionKey } from '@/lib/crypto';

/**
 * Plano 23 (RN-434, AG-D50): o token do link "Não quero mais receber mensagens de aniversário" — SEM ESTADO, no molde de
 * `src/modules/ia/autorizacao-token.ts`. Versão + tenant + paciente e um MAC de 128 bits com chave derivada própria e a
 * finalidade `aniversario_sair` na entrada: o token não serve para outra ação, e o de outra finalidade (link da consulta,
 * autorização de IA) não abre aqui (outra chave, outro formato). Sem validade curta (a retirada tem de ser fácil, LGPD
 * art. 8º, § 5º) e sem o e-mail na assinatura: vale para o titular, não para um endereço. No banco, só o HMAC do token
 * (`chaveDoLimite`), nunca o token. Puro: só `aniversarios.ts` (em SEM_CONTA_PERMITIDOS) fala com o banco.
 */
export const FINALIDADE_ANIVERSARIO = 'aniversario_sair';
const VERSAO = 1;
const CORPO = 33; // versão (1) + tenant (16) + paciente (16)
const MAC = 16;
/** 49 bytes em base64url sem preenchimento. */
const TOKEN = /^[A-Za-z0-9_-]{66}$/;

let chave: Buffer | undefined;
const chaveDoLink = () => (chave ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:link-aniversario-sair:v1', 32)));
const uuidBytes = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex');
const bytesUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const mac = (corpo: Buffer) => createHmac('sha256', chaveDoLink()).update(FINALIDADE_ANIVERSARIO).update(corpo).digest().subarray(0, MAC);

export function assinarLinkDeSaida(l: { tenantId: string; patientId: string }): string {
  const corpo = Buffer.alloc(CORPO);
  corpo.writeUInt8(VERSAO, 0);
  uuidBytes(l.tenantId).copy(corpo, 1);
  uuidBytes(l.patientId).copy(corpo, 17);
  return Buffer.concat([corpo, mac(corpo)]).toString('base64url');
}

/** O tenant e o paciente de um token emitido por `assinarLinkDeSaida`; qualquer outra coisa (o cliente manda o que quiser) → null. */
export function lerLinkDeSaida(token: unknown): { tenantId: string; patientId: string } | null {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  if (b.length !== CORPO + MAC || b.toString('base64url') !== token || b.readUInt8(0) !== VERSAO) return null;
  const corpo = b.subarray(0, CORPO);
  if (!timingSafeEqual(mac(corpo), b.subarray(CORPO))) return null;
  return { tenantId: bytesUuid(corpo.subarray(1, 17)), patientId: bytesUuid(corpo.subarray(17, 33)) };
}

/** O formato do token na URL (a rota e a página conferem antes de usar o valor num Location). */
export const formatoDoLinkDeSaida = (t: unknown): t is string => typeof t === 'string' && TOKEN.test(t);
