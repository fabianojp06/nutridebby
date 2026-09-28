import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { account, tenants, user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { normalizeEmail } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { criarConvite, linkDoConvite } from './convites';

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
export type ContaErrorCode = 'validacao' | 'sem_nutri' | 'ja_tem_senha';

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
};

/** Lista para o admin: só `tenants`, `user`, `account` e `invites` — nenhuma tabela 🔒. */
export async function listarContas(db: Db = getDb(), now: Date = new Date()): Promise<ContaResumo[]> {
  const r = await db.execute<{
    tenant_id: string; slug: string; nome_exibicao: string; status: 'ativa' | 'suspensa'; crn: string | null;
    created_at: Date; email: string | null; tem_senha: boolean; convite_expira: Date | null;
  }>(sql`
    select t.id as tenant_id, t.slug, t.nome_exibicao, t.status, t.crn, t.created_at, u.email,
           exists (select 1 from account a where a.user_id = u.id and a.provider_id = 'credential') as tem_senha,
           (select max(i.expira_em) from invites i where i.user_id = u.id and i.usado_em is null) as convite_expira
      from tenants t
      left join "user" u on u.tenant_id = t.id and u.app_role = 'nutri'
     order by t.created_at desc`);
  return r.rows.map((row) => {
    const expira = row.convite_expira ? new Date(row.convite_expira) : null;
    const convite = row.tem_senha ? 'aceito' : !expira ? 'sem_convite' : expira.getTime() > now.getTime() ? 'pendente' : 'expirado';
    return {
      tenantId: row.tenant_id, slug: row.slug, nomeExibicao: row.nome_exibicao, status: row.status, crn: row.crn,
      email: row.email, convite, conviteExpiraEm: expira, criadaEm: new Date(row.created_at),
    };
  });
}
