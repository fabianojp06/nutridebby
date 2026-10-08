import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { account, adminActions, tenants, user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import { emProducao, getEnv } from '@/env';
import { logger } from '@/lib/logger';
import { AVISO_IA_VERSAO, IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import { normalizeEmail } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { criarConvite, linkDoConvite } from './convites';
import { ContaNaoEncontradaError, getTenantStatus } from './tenant-status';

export const CRN_REGEX = /^CRN-?\d{1,2}\s?\d{3,6}$/i;

export const MSG = {
  nome: 'Informe o nome (3 a 80 caracteres)',
  emailInvalido: 'Informe um e-mail válido',
  emailDuplicado: 'E-mail já cadastrado',
  crn: 'CRN inválido. Ex.: CRN-3 12345',
  slugFormato: 'Use de 3 a 40 letras minúsculas, números ou hífen',
  slugDuplicado: 'Endereço já em uso',
  jaTemSenha: 'A nutricionista já definiu a senha. Se ela esqueceu, use "Esqueci minha senha".',
  semNutri: 'Conta sem nutricionista.',
  contaSuspensa: 'Conta suspensa: reative antes de reenviar o convite.',
} as const;

export const nomeExibicaoSchema = z.string().trim().min(3, MSG.nome).max(80, MSG.nome);
export const crnSchema = z.string().trim().regex(CRN_REGEX, MSG.crn).transform((v) => v.toUpperCase());

export const novaContaSchema = z.object({
  nomeExibicao: nomeExibicaoSchema,
  email: z.string().transform(normalizeEmail).pipe(z.email({ message: MSG.emailInvalido })),
  crn: crnSchema,
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, MSG.slugFormato),
});

export type ErrosDeCampo = Partial<Record<'nomeExibicao' | 'email' | 'crn' | 'slug' | 'geral', string>>;

/**
 * T5-R2: código estável para quem chama decidir o aviso sem reinterpretar `erros` (a Tarefa 7
 * acrescenta um código de "conta suspensa"; novos códigos só precisam de uma entrada em AVISOS).
 */
export type ContaErrorCode = 'validacao' | 'sem_nutri' | 'ja_tem_senha' | 'conta_suspensa';

export class ContaError extends Error {
  override name = 'ContaError';
  constructor(
    readonly erros: ErrosDeCampo,
    readonly code: ContaErrorCode = 'validacao',
  ) {
    super('Dados da conta inválidos');
  }
}

type Deps = { db?: Db; appUrl?: string; now?: Date };

/** US-001: tenant + nutri sem senha + convite de 72 h + e-mail, tudo na mesma transação. */
export async function criarContaNutri(input: Record<string, unknown>, deps: Deps = {}): Promise<{ tenantId: string; userId: string }> {
  const db = deps.db ?? getDb();
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  const parsed = novaContaSchema.safeParse(input);
  if (!parsed.success) throw new ContaError(primeiroErroPorCampo(parsed.error));
  const v = parsed.data;

  // Pré-checagem para mensagens amigáveis; em corrida quem decide é a constraint UNIQUE (abaixo)
  const erros: ErrosDeCampo = {};
  if ((await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, v.slug))).length) erros.slug = MSG.slugDuplicado;
  if ((await db.select({ id: user.id }).from(user).where(eq(user.email, v.email))).length) erros.email = MSG.emailDuplicado;
  if (Object.keys(erros).length) throw new ContaError(erros);

  try {
    return await db.transaction(async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: v.slug, nomeExibicao: v.nomeExibicao, crn: v.crn }).returning({ id: tenants.id });
      const userId = randomUUID();
      await tx.insert(user).values({ id: userId, name: v.nomeExibicao, email: v.email, emailVerified: false, appRole: 'nutri', tenantId: t.id });
      const { token } = await criarConvite(tx, userId, deps.now);
      await enqueueEmail({ tipo: 'convite_nutri', para: v.email, nome: v.nomeExibicao, link: linkDoConvite(appUrl, token) }, { tenantId: t.id, tx });
      return { tenantId: t.id, userId };
    });
  } catch (err) {
    const c = uniqueViolation(err);
    if (c === 'tenants_slug_unique') throw new ContaError({ slug: MSG.slugDuplicado });
    if (c === 'user_email_unique') throw new ContaError({ email: MSG.emailDuplicado });
    throw err;
  }
}

export async function reenviarConvite(tenantId: string, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  await db.transaction(async (tx) => {
    // T5-R3: tranca a linha da nutricionista (SELECT ... FOR UPDATE) — duas chamadas concorrentes
    // (duplo clique, duas abas) serializam aqui; a segunda só continua depois que a primeira
    // confirma ou desfaz, e então já vê o estado atualizado antes de decidir o que fazer. Some
    // com a corrida em que ambas passariam pela checagem e cada uma criaria um convite válido
    // (a `invites_user_pendente_idx`, parcial e única, seria a última rede de segurança).
    const [u] = await tx
      .select({ id: user.id, email: user.email, nome: user.name })
      .from(user)
      .where(and(eq(user.tenantId, tenantId), eq(user.appRole, 'nutri')))
      .for('update');
    if (!u) throw new ContaError({ geral: MSG.semNutri }, 'sem_nutri');
    // PF-N6: conta suspensa não reenvia convite (RN-15); checa depois da trava do usuário.
    if ((await getTenantStatus(tx, tenantId)) === 'suspensa') {
      throw new ContaError({ geral: MSG.contaSuspensa }, 'conta_suspensa');
    }
    const comSenha = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, u.id), eq(account.providerId, 'credential')));
    if (comSenha.length) throw new ContaError({ geral: MSG.jaTemSenha }, 'ja_tem_senha');
    const { token } = await criarConvite(tx, u.id, deps.now);
    await enqueueEmail({ tipo: 'convite_nutri', para: u.email, nome: u.nome, link: linkDoConvite(appUrl, token) }, { tenantId, tx });
  });
}

export type ContaResumo = {
  tenantId: string;
  slug: string;
  nomeExibicao: string;
  status: 'ativa' | 'suspensa';
  crn: string | null;
  email: string | null;
  convite: 'aceito' | 'pendente' | 'expirado' | 'sem_convite';
  conviteExpiraEm: Date | null;
  criadaEm: Date;
  waCotaMensal: number;
  /** D15: base do CS-03 (%) e início do uso (CS-01, 'AAAA-MM-DD'), informados pelo admin. */
  taxaFaltasBase: number | null;
  goLiveEm: string | null;
  /** D20 (Plano 10A): documentos assinados liberados pelo admin. */
  documentosLiberados: boolean;
  /** Plano 11: IA liberada (admin), ativada (nutricionista) e cota (US$/mês). */
  iaLiberada: boolean;
  iaAtivada: boolean;
  iaCotaMensalUsd: number;
};

/** P09-07: 50 consultórios por página; a busca vai até 100 caracteres. */
export const CONTAS_POR_PAGINA = 50;
export const BUSCA_CONTAS_MAX = 100;
/** `depois`/`antes`: o id do último/primeiro consultório da página vista ("Próxima"/"Anterior"); `limite` só nos testes. */
export type FiltroContas = { busca?: unknown; depois?: unknown; antes?: unknown; limite?: number };
export type PaginaDeContas = { contas: ContaResumo[]; anterior: string | null; proxima: string | null; busca: string };

type LinhaConta = {
  tenant_id: string; slug: string; nome_exibicao: string; status: 'ativa' | 'suspensa'; crn: string | null;
  created_at: Date; email: string | null; tem_senha: boolean; convite_expira: Date | null; wa_cota_mensal: number;
  taxa_faltas_base: string | null; go_live_em: string | null; documentos_liberados: boolean;
  ia_liberada: boolean; ia_ativada: boolean; ia_cota_mensal_usd: string;
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursor = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

/**
 * Lista para o admin: só `tenants`, `user`, `account` e `invites` — nenhuma tabela 🔒. P09-07 (Plano 13): por páginas de
 * 50, com cursor = o id de um consultório (a comparação `(created_at, id)` usa a linha dele no banco, sem perder os
 * microssegundos do `created_at` no JavaScript) e busca por nome de exibição, slug ou e-mail da nutricionista, sem
 * diferenciar maiúsculas — por `position()`, então `%` e `_` são literais (sem LIKE). Cursor inválido ou de consultório
 * que não existe = primeira página.
 */
export async function listarContas(db: Db = getDb(), now: Date = new Date(), f: FiltroContas = {}): Promise<PaginaDeContas> {
  const busca = typeof f.busca === 'string' ? f.busca.trim().slice(0, BUSCA_CONTAS_MAX) : '';
  const antes = cursor(f.antes);
  const depois = antes ? null : cursor(f.depois);
  const limite = f.limite ?? CONTAS_POR_PAGINA;
  // o e-mail de QUALQUER nutricionista do consultório entra na busca (exists), sem repetir o consultório
  const filtroBusca = busca
    ? sql`and (position(lower(${busca}) in lower(t.nome_exibicao || ' ' || t.slug)) > 0
           or exists (select 1 from "user" ub where ub.tenant_id = t.id and ub.app_role = 'nutri' and position(lower(${busca}) in lower(ub.email::text)) > 0))`
    : sql``;
  const filtroCursor = depois
    ? sql`and (t.created_at, t.id) < (select c.created_at, c.id from tenants c where c.id = ${depois}::uuid)`
    : antes
      ? sql`and (t.created_at, t.id) > (select c.created_at, c.id from tenants c where c.id = ${antes}::uuid)`
      : sql``;
  const ordem = antes ? sql`order by t.created_at asc, t.id asc` : sql`order by t.created_at desc, t.id desc`;
  const r = await db.execute<LinhaConta>(sql`
    select t.id as tenant_id, t.slug, t.nome_exibicao, t.status, t.crn, t.created_at, t.wa_cota_mensal, u.email,
           t.taxa_faltas_base, to_char(t.go_live_em, 'YYYY-MM-DD') as go_live_em, t.documentos_liberados,
           t.ia_liberada, t.ia_ativada_em is not null as ia_ativada, t.ia_cota_mensal_usd,
           exists (select 1 from account a where a.user_id = u.id and a.provider_id = 'credential') as tem_senha,
           (select max(i.expira_em) from invites i where i.user_id = u.id and i.usado_em is null) as convite_expira
      from tenants t
      -- uma linha por consultório (revisão do plano): com duas usuárias 'nutri' no mesmo tenant, o join simples repetiria o
      -- consultório, o limit contaria linhas e o cursor (created_at, id) pularia as outras linhas dele na "Próxima"
      left join lateral (select u1.id, u1.email from "user" u1 where u1.tenant_id = t.id and u1.app_role = 'nutri'
                          order by u1.created_at, u1.id limit 1) u on true
     where true ${filtroBusca} ${filtroCursor}
     ${ordem}
     limit ${limite + 1}`);
  if ((depois || antes) && !r.rows.length) return listarContas(db, now, { busca, limite: f.limite });
  const temMais = r.rows.length > limite;
  const linhas = r.rows.slice(0, limite);
  if (antes) linhas.reverse();
  const contas = linhas.map((row): ContaResumo => {
    const expira = row.convite_expira ? new Date(row.convite_expira) : null;
    const convite = row.tem_senha ? 'aceito' : !expira ? 'sem_convite' : expira.getTime() > now.getTime() ? 'pendente' : 'expirado';
    return {
      tenantId: row.tenant_id, slug: row.slug, nomeExibicao: row.nome_exibicao, status: row.status, crn: row.crn,
      email: row.email, convite, conviteExpiraEm: expira, criadaEm: new Date(row.created_at), waCotaMensal: row.wa_cota_mensal,
      taxaFaltasBase: row.taxa_faltas_base === null ? null : Number(row.taxa_faltas_base), goLiveEm: row.go_live_em,
      documentosLiberados: row.documentos_liberados,
      iaLiberada: row.ia_liberada, iaAtivada: row.ia_ativada, iaCotaMensalUsd: Number(row.ia_cota_mensal_usd),
    };
  });
  const primeira = contas[0]?.tenantId ?? null;
  const ultima = contas.at(-1)?.tenantId ?? null;
  return {
    contas,
    busca,
    // voltando ("Anterior"), há sempre a página de onde se veio; indo, há anterior se chegou por um cursor
    anterior: antes ? (temMais ? primeira : null) : depois ? primeira : null,
    proxima: antes ? ultima : temMais ? ultima : null,
  };
}

/** D20 (Plano 10A): o admin libera os documentos assinados do consultório só depois da liberação para uso real. */
export async function definirDocumentosLiberados(db: Db, tenantId: string, liberar: boolean, adminId: string): Promise<void> {
  const r = await db.update(tenants).set({ documentosLiberados: liberar, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
  if (!r.length) throw new ContaNaoEncontradaError();
  logger.info({ tenantId, adminId, documentosLiberados: liberar }, 'documentos assinados liberados/bloqueados pelo admin');
}

/**
 * Plano 11 (US-100, A-06, D6): a admin libera a IA do consultório só depois da ZDR, do parecer do advogado, da avaliação e
 * dos textos finais (runbook). Trilha em admin_actions (NGS1.07.03); só tenants e admin_actions (nenhuma tabela 🔒).
 */
export class IaProvisoriaError extends Error {
  override name = 'IaProvisoriaError';
  constructor() {
    super('Os textos legais da IA ainda são provisórios. Publique o aviso e o aditivo finais antes de liberar.');
  }
}

export async function definirIaLiberada(db: Db, tenantId: string, liberar: boolean, adminId: string, o: { producao?: boolean } = {}): Promise<void> {
  // D22 (A-06 também no código): em produção, só com o aviso e o aditivo finais (versões sem "-provisorio"). Sem `producao`,
  // vale o ambiente (Minor 7 da revisão final: quem esquecer de informar não abre a guarda)
  const producao = o.producao ?? emProducao(getEnv());
  if (liberar && producao && [AVISO_IA_VERSAO, IA_ADITIVO_VERSAO].some((v) => v.endsWith('-provisorio'))) throw new IaProvisoriaError();
  await db.transaction(async (tx) => {
    const r = await tx.update(tenants).set({ iaLiberada: liberar, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
    if (!r.length) throw new ContaNaoEncontradaError();
    await tx.insert(adminActions).values({ adminUserId: adminId, acao: liberar ? 'liberar_ia' : 'bloquear_ia', alvoTenantId: tenantId, origem: 'admin' });
  });
  logger.info({ tenantId, adminId, iaLiberada: liberar }, 'IA liberada/bloqueada pelo admin');
}
