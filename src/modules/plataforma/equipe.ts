import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { account, equipeMembros, invites, session, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { logger } from '@/lib/logger';
import { normalizeEmail } from '@/lib/text';
import { recordAudit } from './audit';
import { criarConvite, linkDoConvite } from './convites';
import { LIMITE_DA_EQUIPE, MSG_EQUIPE } from './equipe-textos';

/**
 * Plano 26 (RN-499, RN-502, RN-503, RN-516; spec §9.1): a Equipe do consultório — convidar, reenviar o convite, a permissão
 * do Financeiro, desativar e reativar a pessoa da recepção, e a lista da tela Equipe. Só a sessão `nutri` (conferida aqui,
 * antes da transação; o gatilho `equipe_membros_regras` recusa as outras). Tudo numa transação `withTenant` da nutricionista,
 * com o ator e o IP: `equipe_membros` pela RLS; `user`, `account`, `session` e `invites` (exceções de RLS, CLAUDE.md regra 1:
 * este arquivo está na lista) sempre pelo consultório da sessão. O limite de 3 ativas é daqui, sob a trava do consultório
 * (`pg_advisory_xact_lock(hashtext('equipe-tenant'), hashtext(tenantId))`): o gatilho não conta. Cada ação grava
 * `recordAudit` da entidade `equipe`, sem paciente (RN-516). O log leva só ids (regra 3, RNF-482): nunca nome nem e-mail.
 * Não olha `EQUIPE_LIGADA` (RE-D52): quem recusa com a Equipe desligada são a página e as actions.
 */

export type CampoDaEquipe = 'nome' | 'email' | 'geral';
export type CodigoDaEquipe = 'validacao' | 'email_em_uso' | 'limite' | 'conta_suspensa' | 'ja_tem_senha' | 'nao_encontrado';

export class EquipeError extends Error {
  override name = 'EquipeError';
  constructor(
    readonly code: CodigoDaEquipe,
    /** Mensagem por campo do formulário (a11y: `aria-describedby`); `geral` para o que não é de um campo. */
    readonly erros: Partial<Record<CampoDaEquipe, string>>,
  ) {
    super(Object.values(erros)[0] ?? 'Erro na equipe');
  }
}

const novoConviteSchema = z.object({
  nome: z.string().trim().min(3, MSG_EQUIPE.erros.nome).max(80, MSG_EQUIPE.erros.nome),
  email: z.string().transform(normalizeEmail).pipe(z.email({ message: MSG_EQUIPE.erros.email })),
  financeiro: z.boolean(),
});

type Deps = { db?: Db; appUrl?: string; now?: Date };

/** A sessão da nutricionista, com o ator (a auditoria e o gatilho usam a usuária da sessão). */
function exigirNutri(ctx: TenantContext): asserts ctx is TenantContext & { actorUserId: string } {
  if (ctx.role !== 'nutri' || !ctx.actorUserId) throw new Error('A equipe do consultório só muda pela sessão da nutricionista');
}

/** RN-499/RN-503: a trava do consultório, antes de contar as ativas (convite e reativação). */
const travarEquipe = (tx: Tx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('equipe-tenant'), hashtext(${tenantId}))`);

async function ativasDoConsultorio(tx: Tx, tenantId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(equipeMembros).where(and(eq(equipeMembros.tenantId, tenantId), isNull(equipeMembros.desativadaEm)));
  return Number(r?.n ?? 0);
}

/**
 * O consultório da sessão: o nome (e-mail do convite) e a suspensão (RN-15). No convite, `FOR SHARE` espera uma suspensão em
 * curso (M8 de `getTenantStatus`); no reenvio, a leitura simples, como `reenviarConvite` da nutricionista.
 */
async function consultorio(tx: Tx, tenantId: string, o: { aguardarSuspensao?: boolean } = {}): Promise<{ nome: string; suspensa: boolean }> {
  const q = tx.select({ nome: tenants.nomeExibicao, status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
  const [t] = o.aguardarSuspensao ? await q.for('share') : await q;
  if (!t) throw new EquipeError('nao_encontrado', { geral: 'Consultório não encontrado. Recarregue a página e tente de novo.' });
  return { nome: t.nome, suspensa: t.status === 'suspensa' };
}

const suspensa = () => new EquipeError('conta_suspensa', { geral: MSG_EQUIPE.erros.contaSuspensa });
const limite = () => new EquipeError('limite', { geral: MSG_EQUIPE.erros.limite });
const naoEncontrado = () => new EquipeError('nao_encontrado', { geral: 'Pessoa da equipe não encontrada. Recarregue a página e tente de novo.' });

/** O nome da nutricionista da sessão (o "{nome da nutricionista} convidou você" do e-mail). */
async function nomeDaNutricionista(tx: Tx, ctx: TenantContext & { actorUserId: string }): Promise<string> {
  const [n] = await tx.select({ nome: user.name }).from(user).where(and(eq(user.id, ctx.actorUserId), eq(user.tenantId, ctx.tenantId)));
  return n?.nome ?? 'A nutricionista';
}

/**
 * A linha da pessoa da recepção do consultório da sessão, travada (`FOR UPDATE` na linha e na conta, nesta ordem). A conta
 * travada antes do convite, como em `aceitarConvite` e `reenviarConvite` (T6-R1 do Plano 02): sem deadlock com o aceite.
 */
async function travarMembro(tx: Tx, tenantId: string, membroId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(membroId)) throw naoEncontrado();
  const [m] = await tx
    .select({ id: equipeMembros.id, userId: equipeMembros.userId, desativadaEm: equipeMembros.desativadaEm })
    .from(equipeMembros)
    .where(and(eq(equipeMembros.id, membroId), eq(equipeMembros.tenantId, tenantId)))
    .for('update');
  if (!m) throw naoEncontrado();
  const [u] = await tx
    .select({ email: user.email, nome: user.name })
    .from(user)
    .where(and(eq(user.id, m.userId), eq(user.tenantId, tenantId), eq(user.appRole, 'recepcao')))
    .for('update');
  if (!u) throw naoEncontrado();
  return { ...m, ...u };
}

const temSenha = async (tx: Tx, userId: string) =>
  (await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))).length > 0;

/**
 * RN-499 (US-488 "Convidar"): na transação, trava o consultório, confere a suspensão, o limite de 3 ativas e o e-mail (já
 * usado por qualquer conta → a mesma mensagem, sem dizer de quem), cria a conta `recepcao` sem senha, a linha da equipe, o
 * convite de 72 h e o e-mail `convite_recepcao`, e grava `criar` da entidade `equipe`.
 */
export async function convidarRecepcao(ctx: TenantContext, input: { nome: unknown; email: unknown; financeiro: boolean }, deps: Deps = {}): Promise<{ membroId: string }> {
  exigirNutri(ctx);
  const parsed = novoConviteSchema.safeParse({ nome: typeof input.nome === 'string' ? input.nome : '', email: typeof input.email === 'string' ? input.email : '', financeiro: input.financeiro });
  if (!parsed.success) {
    const erros: Partial<Record<CampoDaEquipe, string>> = {};
    for (const i of parsed.error.issues) {
      const campo = i.path[0];
      if ((campo === 'nome' || campo === 'email') && !erros[campo]) erros[campo] = i.message;
    }
    throw new EquipeError('validacao', erros);
  }
  const v = parsed.data;
  const db = deps.db ?? getDb();
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  const now = deps.now ?? new Date();
  try {
    const membroId = await withTenant(
      ctx,
      async (tx) => {
        await travarEquipe(tx, ctx.tenantId);
        const c = await consultorio(tx, ctx.tenantId, { aguardarSuspensao: true });
        if (c.suspensa) throw suspensa();
        if ((await ativasDoConsultorio(tx, ctx.tenantId)) >= LIMITE_DA_EQUIPE) throw limite();
        // Revisão da P26-07: a trava global do e-mail (depois da do consultório), antes da busca — dois consultórios convidando
        // o mesmo e-mail ao mesmo tempo não chegam ao 23505 (o erro do Postgres traria o e-mail ao log)
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('user-email'), hashtext(lower(${v.email})))`);
        // `email` é citext: a busca não depende de maiúsculas. Enumeração aceita (R-496): a mensagem não diz de quem é. A
        // busca é em todas as contas, de qualquer consultório e papel: o e-mail é único em `user` (RE-D34)
        if ((await tx.select({ id: user.id }).from(user).where(eq(user.email, v.email))).length) {
          throw new EquipeError('email_em_uso', { email: MSG_EQUIPE.erros.emailEmUso });
        }
        const userId = randomUUID();
        await tx.insert(user).values({ id: userId, name: v.nome, email: v.email, emailVerified: false, appRole: 'recepcao', tenantId: ctx.tenantId, createdAt: now, updatedAt: now });
        const [m] = await tx
          .insert(equipeMembros)
          .values({ tenantId: ctx.tenantId, userId, papel: 'recepcao', financeiro: v.financeiro, convidadaPor: ctx.actorUserId })
          .returning({ id: equipeMembros.id });
        const { token } = await criarConvite(tx, userId, now, { tipo: 'recepcao', tenantId: ctx.tenantId });
        await enqueueEmail(
          { tipo: 'convite_recepcao', para: v.email, nome: v.nome, nutricionista: await nomeDaNutricionista(tx, ctx), consultorio: c.nome, link: linkDoConvite(appUrl, token) },
          { tenantId: ctx.tenantId, tx },
        );
        await recordAudit(tx, { acao: 'criar', entidade: 'equipe', entidadeId: m.id, patientId: null });
        logger.info({ tenantId: ctx.tenantId, membroId: m.id, userId }, 'equipe: convite da recepção enviado');
        return m.id;
      },
      db,
    );
    return { membroId };
  } catch (err) {
    // a conta criada com o mesmo e-mail entre a checagem e o INSERT (outra aba, outro consultório)
    if (uniqueViolation(err) === 'user_email_unique') throw new EquipeError('email_em_uso', { email: MSG_EQUIPE.erros.emailEmUso });
    throw err;
  }
}

/**
 * RN-499 ("Reenviar convite"): só sem senha criada, como `reenviarConvite` da nutricionista; o convite anterior deixa de
 * valer (`criarConvite`). Pessoa desativada não recebe convite (reative antes). Grava `alterar` da entidade `equipe`.
 */
export async function reenviarConviteRecepcao(ctx: TenantContext, membroId: string, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  const db = deps.db ?? getDb();
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  const now = deps.now ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const m = await travarMembro(tx, ctx.tenantId, membroId);
      if (m.desativadaEm) throw naoEncontrado();
      const c = await consultorio(tx, ctx.tenantId);
      if (c.suspensa) throw suspensa();
      if (await temSenha(tx, m.userId)) throw new EquipeError('ja_tem_senha', { geral: MSG_EQUIPE.erros.jaTemSenha });
      const { token } = await criarConvite(tx, m.userId, now, { tipo: 'recepcao', tenantId: ctx.tenantId });
      await enqueueEmail(
        { tipo: 'convite_recepcao', para: m.email, nome: m.nome, nutricionista: await nomeDaNutricionista(tx, ctx), consultorio: c.nome, link: linkDoConvite(appUrl, token) },
        { tenantId: ctx.tenantId, tx },
      );
      await recordAudit(tx, { acao: 'alterar', entidade: 'equipe', entidadeId: m.id, patientId: null });
      logger.info({ tenantId: ctx.tenantId, membroId: m.id }, 'equipe: convite da recepção reenviado');
    },
    db,
  );
}

/** RN-502: a permissão do Financeiro, só pela nutricionista; vale na próxima requisição da pessoa. Grava `alterar`. */
export async function definirPermissaoFinanceiro(ctx: TenantContext, membroId: string, financeiro: boolean, deps: Pick<Deps, 'db'> = {}): Promise<void> {
  exigirNutri(ctx);
  await withTenant(
    ctx,
    async (tx) => {
      const m = await travarMembro(tx, ctx.tenantId, membroId);
      await tx.update(equipeMembros).set({ financeiro, updatedAt: new Date() }).where(eq(equipeMembros.id, m.id));
      await recordAudit(tx, { acao: 'alterar', entidade: 'equipe', entidadeId: m.id, patientId: null });
    },
    deps.db ?? getDb(),
  );
}

/**
 * RN-503 ("Desativar"): na mesma transação, grava `desativada_em` e `desativada_por` (o gatilho usa o relógio do banco e a
 * usuária da sessão), apaga as sessões da conta e o convite pendente; a linha e a conta nunca são apagadas (RE-D28). Já
 * desativada: nada muda. Grava `alterar` da entidade `equipe`.
 */
export async function desativarRecepcao(ctx: TenantContext, membroId: string, deps: Pick<Deps, 'db'> = {}): Promise<void> {
  exigirNutri(ctx);
  await withTenant(
    ctx,
    async (tx) => {
      const m = await travarMembro(tx, ctx.tenantId, membroId);
      if (m.desativadaEm) return;
      await tx.update(equipeMembros).set({ desativadaEm: new Date(), desativadaPor: ctx.actorUserId, updatedAt: new Date() }).where(eq(equipeMembros.id, m.id));
      const sessoes = await tx.delete(session).where(eq(session.userId, m.userId)).returning({ id: session.id });
      await tx.delete(invites).where(and(eq(invites.userId, m.userId), isNull(invites.usadoEm)));
      await recordAudit(tx, { acao: 'alterar', entidade: 'equipe', entidadeId: m.id, patientId: null });
      logger.info({ tenantId: ctx.tenantId, membroId: m.id, sessoesEncerradas: sessoes.length }, 'equipe: acesso da recepção desativado');
    },
    deps.db ?? getDb(),
  );
}

/**
 * RN-503 ("Reativar"): sob a trava do consultório da RN-499, respeitando o limite de 3 ativas; a senha e o 2FA continuam.
 * Já ativa: nada muda. Grava `alterar` da entidade `equipe`.
 */
export async function reativarRecepcao(ctx: TenantContext, membroId: string, deps: Pick<Deps, 'db'> = {}): Promise<void> {
  exigirNutri(ctx);
  await withTenant(
    ctx,
    async (tx) => {
      await travarEquipe(tx, ctx.tenantId);
      const m = await travarMembro(tx, ctx.tenantId, membroId);
      if (!m.desativadaEm) return;
      if ((await ativasDoConsultorio(tx, ctx.tenantId)) >= LIMITE_DA_EQUIPE) throw limite();
      await tx.update(equipeMembros).set({ desativadaEm: null, desativadaPor: null, updatedAt: new Date() }).where(eq(equipeMembros.id, m.id));
      await recordAudit(tx, { acao: 'alterar', entidade: 'equipe', entidadeId: m.id, patientId: null });
      logger.info({ tenantId: ctx.tenantId, membroId: m.id }, 'equipe: acesso da recepção reativado');
    },
    deps.db ?? getDb(),
  );
}

export type SituacaoNaEquipe = 'convite_enviado' | 'convite_vencido' | 'ativo' | 'desativado';
export type MembroNaLista = {
  id: string;
  nome: string;
  email: string;
  financeiro: boolean;
  situacao: SituacaoNaEquipe;
  /** Só em `convite_enviado`: até quando o convite vale. */
  conviteValeAte: Date | null;
  desativadaEm: Date | null;
  /** RN-516 (RE-D43): o último login da conta; `null` = "Ainda não entrou". */
  ultimoAcessoEm: Date | null;
};
export type Equipe = { membros: MembroNaLista[]; ativas: number; limiteAtingido: boolean };

/**
 * A tela Equipe (§7.2): cada pessoa da recepção do consultório, na ordem do convite, com a situação — "Acesso desativado"
 * (linha desativada), "Ativo" (senha criada), "Convite enviado" (convite pendente dentro do prazo) ou "Convite vencido" —,
 * a permissão do Financeiro e o último acesso. Sem auditoria de leitura (não é dado de paciente).
 */
export async function listarEquipe(ctx: TenantContext, deps: { db?: Db; now?: Date } = {}): Promise<Equipe> {
  exigirNutri(ctx);
  const now = deps.now ?? new Date();
  const linhas = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({
          id: equipeMembros.id,
          nome: user.name,
          email: user.email,
          financeiro: equipeMembros.financeiro,
          desativadaEm: equipeMembros.desativadaEm,
          ultimoAcessoEm: user.ultimoAcessoEm,
          temSenha: sql<boolean>`exists (select 1 from ${account} a where a.user_id = ${user.id} and a.provider_id = 'credential')`,
          conviteValeAte: sql<Date | string | null>`(select max(i.expira_em) from ${invites} i where i.user_id = ${user.id} and i.usado_em is null)`,
        })
        .from(equipeMembros)
        .innerJoin(user, and(eq(user.id, equipeMembros.userId), eq(user.tenantId, ctx.tenantId)))
        .where(eq(equipeMembros.tenantId, ctx.tenantId))
        .orderBy(asc(equipeMembros.createdAt), asc(equipeMembros.id)),
    deps.db ?? getDb(),
  );
  const membros = linhas.map((l): MembroNaLista => {
    const vale = l.conviteValeAte ? new Date(l.conviteValeAte) : null;
    const situacao: SituacaoNaEquipe = l.desativadaEm ? 'desativado' : l.temSenha ? 'ativo' : vale && vale.getTime() > now.getTime() ? 'convite_enviado' : 'convite_vencido';
    return {
      id: l.id,
      nome: l.nome,
      email: l.email,
      financeiro: l.financeiro,
      situacao,
      conviteValeAte: situacao === 'convite_enviado' ? vale : null,
      desativadaEm: l.desativadaEm,
      ultimoAcessoEm: l.ultimoAcessoEm,
    };
  });
  const ativas = membros.filter((m) => m.situacao !== 'desativado').length;
  return { membros, ativas, limiteAtingido: ativas >= LIMITE_DA_EQUIPE };
}
