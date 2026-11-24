import { createHash, createHmac, hkdfSync, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { documentAccessCodes, patients, signedDocumentReceipts, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { encryptionKey, safeEqual, sha256 } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { urlDoApp } from '@/lib/url-do-app';
import { chaveDoLimite, consumirLimite } from '@/modules/agenda/limite-ip';
import { normalizarEmailDoLink } from '@/modules/agenda/link-consulta';
import { auditRead } from '@/modules/plataforma/audit';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import type { TipoDocumento } from './constantes';
import { registrarRecibo } from './recebimento';
import { rotuloDoTipo } from './tipos-de-documento';

/**
 * RN-158 / D3 b: link de uso único SEM ESTADO (como link-consulta.ts): versão + tenant + paciente + documento + emissão
 * (segundos), MAC de 128 bits com o e-mail ATUAL do paciente (corrigido o e-mail, o link morre). Válido por 30 dias (D6 ★)
 * e só enquanto o documento estiver assinado (conferido por quem lê). Para abrir: um código de 6 dígitos no e-mail
 * (pedido com Turnstile) e, com ele, uma sessão de 15 min presa ao documento (cookie `nd_doc`); tudo no contexto de
 * paciente SEM LOGIN (`semConta`, SEM_CONTA_PERMITIDOS).
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

/** RN-158 (textos novos deste plano, tabela de desvios). */
export const MSG_LINK = {
  invalido: 'Este documento não está mais disponível. Fale com sua nutricionista.',
  expirado: 'Este link expirou. Peça um novo à sua nutricionista.',
  aguarde: 'Aguarde 1 minuto para pedir outro código.',
  limite: 'Muitas tentativas. Tente de novo em alguns minutos.',
  codigoInvalido: 'Código inválido.',
  codigoVencido: 'Código vencido. Peça outro.',
  turnstile: 'Confirme que você não é um robô.',
  turnstileFora: 'Tente novamente em alguns minutos',
} as const;
export const NOME_COOKIE_LINK = 'nd_doc';
export const SESSAO_LINK_S = 15 * 60;
const CODIGO_VALIDADE_MS = 10 * 60_000;
const MAX_ERROS = 5;
const INTERVALO_MS = 60_000;
const POR_HORA_DOCUMENTO = 5;
const POR_HORA_IP = 20;
const CONFIRMACOES_POR_HORA_IP = 30;

export class LinkError extends Error {
  override name = 'LinkError';
  constructor(
    readonly status: number,
    readonly mensagem: string,
  ) {
    super(mensagem);
  }
}
export type DepsLink = { db?: Db; agora?: Date; ip: string | null; ipDoLimite: string | null; verificarTurnstile: (t: string | null) => Promise<'ok' | 'invalido' | 'indisponivel'>; appUrl: string };
export type EstadoLink = { tipo: 'invalido' | 'expirado' | 'indisponivel' } | { tipo: 'pedir_codigo' } | { tipo: 'aberto'; titulo: string; versao: number; data: Date; recebidoEm: Date | null; tipoDoc: TipoDocumento };

/** HMAC do código amarrado ao id do pedido (o mesmo código em outro pedido não confere); chave derivada do link. */
const hashDoCodigo = (pedido: string, codigo: string) => createHmac('sha256', chaveDoLinkDocumento()).update(`codigo:${pedido}:${codigo}`).digest('base64url');
const ctxDo = (ids: IdsDoLink, ip: string | null): TenantContext => ({ tenantId: ids.tenantId, role: 'paciente', patientId: ids.patientId, semConta: true, ip });

/**
 * Lê o token no contexto do paciente SEM LOGIN (a RLS limita ao paciente do token e aos emitidos) e confere tudo.
 * Ids que não existem (ou de outro tenant) só devolvem zero linhas → null (token inválido). Sem `try/catch` (revisão
 * da T12): uma falha de banco sobe como erro (500 e Sentry), nunca como "documento não está mais disponível".
 */
async function abrirLink(token: unknown, deps: DepsLink) {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  return lerLinkDocumento(token, agora, (ids) =>
    withTenant(
      ctxDo(ids, deps.ip),
      async (tx) => {
        const [t] = await tx.select({ status: tenants.status, liberado: tenants.documentosLiberados }).from(tenants).where(eq(tenants.id, ids.tenantId));
        const [p] = await tx.select({ email: patients.email, status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, ids.patientId));
        const [d] = await tx
          .select({ status: signedDocuments.status, assinadoEm: signedDocuments.assinadoEm, pdf: signedDocuments.pdfPath, tipoDoc: signedDocuments.tipo, versao: signedDocuments.versao })
          .from(signedDocuments)
          .where(eq(signedDocuments.id, ids.documentoId));
        if (!p) return null;
        // D20 (correção do /code-review high do PR #18): o interruptor do admin vale também aqui — desligado, o link fica
        // indisponível, nenhum código é enviado (linkUtilizavel) e a sessão já aberta não abre o PDF nem confirma
        // Plano 22 (DEP-E7): sem a linha do documento, o tipo é nulo (nunca "receita" por falta) e o link fica indisponível
        const tipoDoc = d ? (d.tipoDoc as TipoDocumento) : null;
        const disponivel = t?.status === 'ativa' && !!t.liberado && p.status === 'ativo' && !p.anonimizadoEm && d?.status === 'assinado' && !!d.pdf && !!tipoDoc;
        return {
          email: p.email, disponivel, assinadoEm: d?.assinadoEm ?? null, pdf: d?.pdf ?? null,
          tipoDoc, versao: d?.versao ?? 1,
        };
      },
      db,
    ),
  );
}

async function sessaoValida(ids: IdsDoLink, sessao: string | undefined, deps: DepsLink): Promise<boolean> {
  if (!sessao || !/^[A-Za-z0-9_-]{43}$/.test(sessao)) return false;
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctxDo(ids, deps.ip),
    async (tx) => {
      const [c] = await tx
        .select({ id: documentAccessCodes.id })
        .from(documentAccessCodes)
        .where(and(eq(documentAccessCodes.documentoId, ids.documentoId), eq(documentAccessCodes.sessaoHash, sha256(sessao)), gt(documentAccessCodes.sessaoExpiraEm, agora)))
        .limit(1);
      return !!c;
    },
    deps.db ?? getDb(),
  );
}

const recebidoEm = async (tx: Tx, documentoId: string) =>
  (await tx.select({ em: signedDocumentReceipts.em }).from(signedDocumentReceipts).where(and(eq(signedDocumentReceipts.documentoId, documentoId), eq(signedDocumentReceipts.evento, 'recebido'))))[0]?.em ?? null;

/** A página: GET não consome nada (leitores de link dos provedores de e-mail fazem GET). */
export async function estadoDoLink(token: unknown, sessao: string | undefined, deps: DepsLink): Promise<EstadoLink> {
  const l = await abrirLink(token, deps);
  if (!l) return { tipo: 'invalido' };
  const tipoDoc = l.dados.tipoDoc;
  if (!l.dados.disponivel || !tipoDoc) return { tipo: 'indisponivel' };
  if (l.expirado) return { tipo: 'expirado' };
  if (!(await sessaoValida(l.ids, sessao, deps))) return { tipo: 'pedir_codigo' };
  const recebido = await withTenant(ctxDo(l.ids, deps.ip), (tx) => recebidoEm(tx, l.ids.documentoId), deps.db ?? getDb());
  // Plano 22 (T11, RN-396): `tipoDoc` para o texto por tipo do "Compartilhar" na página do link
  return { tipo: 'aberto', titulo: rotuloDoTipo(tipoDoc), versao: l.dados.versao, data: l.dados.assinadoEm!, recebidoEm: recebido, tipoDoc };
}

async function linkUtilizavel(token: unknown, deps: DepsLink) {
  const l = await abrirLink(token, deps);
  if (!l || !l.dados.disponivel) throw new LinkError(410, MSG_LINK.invalido);
  if (l.expirado) throw new LinkError(410, MSG_LINK.expirado);
  return l;
}

/** Turnstile → limite por IP → 1/min e 5/h por documento → código novo (HMAC amarrado ao pedido) → e-mail. */
export async function pedirCodigoDocumento(token: unknown, input: { turnstile?: unknown }, deps: DepsLink): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const ts = await deps.verificarTurnstile(typeof input.turnstile === 'string' ? input.turnstile : null);
  if (ts === 'indisponivel') throw new LinkError(503, MSG_LINK.turnstileFora);
  if (ts !== 'ok') throw new LinkError(403, MSG_LINK.turnstile);
  if (!(await consumirLimite(db, chaveDoLimite('documento-ip', deps.ipDoLimite ?? 'sem-ip'), POR_HORA_IP, 3600, agora))) throw new LinkError(429, MSG_LINK.limite);
  const l = await linkUtilizavel(token, deps);
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await withTenant(
    ctxDo(l.ids, deps.ip),
    async (tx) => {
      // um pedido por vez por documento: dois cliques ao mesmo tempo não passam juntos pelo "1 por minuto"
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('documento-codigo'), hashtext(${l.ids.documentoId}))`);
      const [ultimo] = await tx.select({ em: documentAccessCodes.createdAt }).from(documentAccessCodes).where(eq(documentAccessCodes.documentoId, l.ids.documentoId)).orderBy(desc(documentAccessCodes.createdAt)).limit(1);
      if (ultimo && agora.getTime() - ultimo.em.getTime() < INTERVALO_MS) throw new LinkError(429, MSG_LINK.aguarde);
      if (!(await consumirLimite(tx, chaveDoLimite('documento-envio', l.ids.documentoId), POR_HORA_DOCUMENTO, 3600, agora))) throw new LinkError(429, MSG_LINK.limite);
      const id = randomUUID();
      await tx.insert(documentAccessCodes).values({ id, tenantId: l.ids.tenantId, patientId: l.ids.patientId, documentoId: l.ids.documentoId, codigoHash: hashDoCodigo(id, codigo), expiraEm: new Date(agora.getTime() + CODIGO_VALIDADE_MS), createdAt: agora });
      const [t] = await tx.select({ nome: tenants.nomeExibicao }).from(tenants).where(eq(tenants.id, l.ids.tenantId));
      await enqueueEmail({ tipo: 'codigo_documento', para: l.dados.email, codigo, consultorio: t?.nome ?? '' }, { tenantId: l.ids.tenantId, tx });
    },
    db,
  );
}

/**
 * O código do pedido mais recente; 5 erros invalidam; acerto → "usado" + sessão de 15 min (só o hash no banco).
 * O erro volta como RESULTADO do callback e só é lançado FORA do withTenant: um throw lá dentro desfaria (rollback) o
 * "tentativas + 1", e o código de 6 dígitos ficaria aberto a tentativas ilimitadas (revisão do rascunho, Critical).
 * Limite por IP também na confirmação (30/h), além do limite do pedido.
 */
export async function confirmarCodigoDocumento(token: unknown, input: { codigo?: unknown }, deps: DepsLink): Promise<{ sessao: string; expira: Date }> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (!(await consumirLimite(db, chaveDoLimite('documento-codigo-ip', deps.ipDoLimite ?? 'sem-ip'), CONFIRMACOES_POR_HORA_IP, 3600, agora))) throw new LinkError(429, MSG_LINK.limite);
  const l = await linkUtilizavel(token, deps);
  const codigo = typeof input.codigo === 'string' ? input.codigo.replace(/\s/g, '') : '';
  const r = await withTenant(
    ctxDo(l.ids, deps.ip),
    async (tx) => {
      const [c] = await tx.select().from(documentAccessCodes).where(eq(documentAccessCodes.documentoId, l.ids.documentoId)).orderBy(desc(documentAccessCodes.createdAt)).limit(1).for('update');
      if (!c || c.usadoEm || c.tentativas >= MAX_ERROS || c.expiraEm <= agora) return { erro: 'vencido' } as const;
      if (!/^\d{6}$/.test(codigo) || !safeEqual(hashDoCodigo(c.id, codigo), c.codigoHash)) {
        await tx.update(documentAccessCodes).set({ tentativas: c.tentativas + 1 }).where(eq(documentAccessCodes.id, c.id));
        return { erro: 'invalido' } as const; // a transação faz COMMIT do incremento
      }
      const sessao = randomBytes(32).toString('base64url');
      const expira = new Date(agora.getTime() + SESSAO_LINK_S * 1000);
      await tx.update(documentAccessCodes).set({ usadoEm: agora, sessaoHash: sha256(sessao), sessaoExpiraEm: expira }).where(and(eq(documentAccessCodes.id, c.id), isNull(documentAccessCodes.usadoEm)));
      return { sessao, expira };
    },
    db,
  );
  if ('erro' in r) throw r.erro === 'vencido' ? new LinkError(410, MSG_LINK.codigoVencido) : new LinkError(400, MSG_LINK.codigoInvalido);
  return r;
}

/** "Abrir PDF" pela página do link: sessão do PRÓPRIO link; audita sem ator (D20 do Plano 05) e grava "aberto" (link_email). */
export async function pdfDoLink(token: unknown, sessao: string | undefined, deps: DepsLink): Promise<string | null> {
  const l = await abrirLink(token, deps);
  if (!l || !l.dados.disponivel || l.expirado || !(await sessaoValida(l.ids, sessao, deps))) return null;
  return withTenant(
    ctxDo(l.ids, deps.ip),
    async (tx) => {
      await auditRead(tx, { entidade: 'documentos', entidadeId: l.ids.documentoId, patientId: l.ids.patientId });
      await registrarRecibo(tx, { ...l.ids, evento: 'aberto', via: 'link_email' });
      return l.dados.pdf;
    },
    deps.db ?? getDb(),
  );
}

/** "Confirmo que recebi este documento" (D4 da spec): uma vez por documento; devolve quando foi confirmado. */
export async function confirmarRecebimentoPeloLink(token: unknown, sessao: string | undefined, deps: DepsLink): Promise<Date | null> {
  const l = await abrirLink(token, deps);
  if (!l || !l.dados.disponivel || l.expirado || !(await sessaoValida(l.ids, sessao, deps))) return null;
  return withTenant(
    ctxDo(l.ids, deps.ip),
    async (tx) => {
      await registrarRecibo(tx, { ...l.ids, evento: 'recebido', via: 'link_email' });
      return recebidoEm(tx, l.ids.documentoId);
    },
    deps.db ?? getDb(),
  );
}

/**
 * §10 da spec ("limpeza diária dos vencidos"), Minor da revisão de cobertura: códigos vencidos há mais de 1 dia cuja
 * sessão também já venceu (ou nunca existiu) saem do banco — o HMAC do código e o hash da sessão não ficam para sempre.
 * Roda no worker (contexto `worker` de cada tenant), na `agenda-limpeza` das 04:30. Um tenant com erro não para os outros.
 */
export async function limparCodigosDeDocumentoVencidos(db: Db, agora: Date, o: { tenantId?: string } = {}): Promise<number> {
  const limite = new Date(agora.getTime() - 86_400_000);
  let n = 0;
  // `o.tenantId`: só os testes (banco compartilhado), como as varreduras da T7
  for (const t of o.tenantId ? [{ id: o.tenantId }] : await listarTenantsParaVarredura(db)) {
    try {
      const r = await withTenant(
        { tenantId: t.id, role: 'worker' },
        (tx) =>
          tx
            .delete(documentAccessCodes)
            .where(and(lt(documentAccessCodes.expiraEm, limite), or(isNull(documentAccessCodes.sessaoExpiraEm), lt(documentAccessCodes.sessaoExpiraEm, limite))))
            .returning({ id: documentAccessCodes.id }),
        db,
      );
      n += r.length;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao limpar códigos de documento vencidos');
    }
  }
  return n;
}
