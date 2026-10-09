import { eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaAutorizacoes, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { chaveDoLimite, consumirLimite } from '@/modules/agenda/limite-ip';
import { autorizacaoDoPaciente, enfileirarConfirmacao } from './autorizacao';
import { emailHmac, lerLinkAutorizacao } from './autorizacao-token';
import { MSG_AUTORIZACAO, VALIDADE_PEDIDO_MS } from './constantes';
import { estadoIaDoTenant, type ConfigIA } from './modo';
import { AUTORIZACAO_IA_USOS, AUTORIZACAO_IA_VERSAO, responsavelDoTenant, textoDaAutorizacao, type TextoLegal } from './textos-legais';

/**
 * US-107 / US-109 (Plano 14A, RN-107): a autorização e a retirada pelo link do e-mail, SEM login — contexto de paciente
 * sem conta (`semConta`, N7; este arquivo está em SEM_CONTA_PERMITIDOS). O GET da página não grava nada (leitores de link
 * dos provedores de e-mail fazem GET); os POSTs passam por Turnstile e limite por IP. A página não mostra dado de saúde:
 * só o consultório e o texto. Sem o código de 6 dígitos (decisão do dono, 08/10/2026).
 */
export type EstadoLinkIa =
  | { tipo: 'invalido' }
  | { tipo: 'expirado' }
  | { tipo: 'nao_vigente' }
  | { tipo: 'decidir'; consultorio: string; texto: TextoLegal }
  | { tipo: 'ja_autorizou'; consultorio: string; em: Date }
  | { tipo: 'retirar'; consultorio: string; em: Date };

export class LinkIaError extends Error {
  override name = 'LinkIaError';
  constructor(
    readonly status: number,
    readonly mensagem: string,
  ) {
    super(mensagem);
  }
}

export type DepsLinkIa = {
  ia: ConfigIA;
  appUrl: string;
  ip: string | null;
  ipDoLimite: string | null;
  userAgent: string | null;
  verificarTurnstile: (t: string | null) => Promise<'ok' | 'invalido' | 'indisponivel'>;
  db?: Db;
  agora?: Date;
  boss?: PgBoss;
};

const POR_HORA_IP = 20;
const ctxDo = (l: { tenantId: string; patientId: string }, ip: string | null): TenantContext => ({ tenantId: l.tenantId, role: 'paciente', patientId: l.patientId, semConta: true, ip });

type Link = NonNullable<ReturnType<typeof lerLinkAutorizacao>>;

/** O paciente do token (a RLS limita ao paciente e ao tenant do token) e o MAC; `travar` nas escritas (FOR UPDATE, como a retirada). */
async function lerNoContexto(tx: Tx, l: Link, ia: ConfigIA, travar: boolean) {
  const consulta = tx.select({ id: patients.id, email: patients.email, status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, l.patientId));
  const [p] = travar ? await consulta.for('update') : await consulta;
  if (!p || !l.confere(p.email)) return null;
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, l.tenantId));
  if (!t) return null;
  return { p, t, situacao: await autorizacaoDoPaciente(tx, p.id, ia.destino) };
}

/** US-107 "Link inválido": paciente que não está ativo, IA que não está ativa no consultório, sem provedor ou sem o perfil (D10). */
function pedidoUtilizavel(c: NonNullable<Awaited<ReturnType<typeof lerNoContexto>>>, ia: ConfigIA) {
  const resp = responsavelDoTenant(c.t);
  const ok = c.p.status === 'ativo' && !c.p.anonimizadoEm && estadoIaDoTenant(c.t, ia.modo) === 'ativa' && !!ia.destino && !!resp;
  return ok ? { resp: resp!, destino: ia.destino! } : null;
}
const vencido = (l: Link, agora: Date) => l.tipo === 'pedido' && agora.getTime() - l.emitidoEm.getTime() > VALIDADE_PEDIDO_MS;
/** Há uma autorização a retirar (vigente, de versão antiga ou de outro destino: o último evento é `autorizou`). */
const autorizacaoAtual = (s: Awaited<ReturnType<typeof autorizacaoDoPaciente>>) => (s.tipo === 'nunca' || s.tipo === 'retirada' ? null : s);

export async function estadoDoLinkIa(token: unknown, deps: DepsLinkIa): Promise<EstadoLinkIa> {
  const l = lerLinkAutorizacao(token);
  if (!l) return { tipo: 'invalido' };
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctxDo(l, deps.ip),
    async (tx): Promise<EstadoLinkIa> => {
      const c = await lerNoContexto(tx, l, deps.ia, false);
      if (!c) return { tipo: 'invalido' };
      const consultorio = c.t.nomeExibicao;
      const atual = autorizacaoAtual(c.situacao);
      if (l.tipo === 'retirada') {
        // D11: não vence; vale enquanto aquela autorização for a decisão mais recente (com a IA desativada, inclusive)
        if (c.p.anonimizadoEm || !atual || atual.id !== l.autorizacaoId) return { tipo: 'nao_vigente' };
        return { tipo: 'retirar', consultorio, em: atual.em };
      }
      const u = pedidoUtilizavel(c, deps.ia);
      if (!u) return { tipo: 'invalido' };
      if (vencido(l, agora)) return { tipo: 'expirado' };
      if (c.situacao.tipo === 'vigente') return { tipo: 'ja_autorizou', consultorio, em: c.situacao.em };
      return { tipo: 'decidir', consultorio, texto: textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...u.resp, destino: u.destino, canal: 'link' })! };
    },
    deps.db ?? getDb(),
  );
}

/** Turnstile → limite por IP (20/h, como o link de documentos) — antes de abrir o token. */
async function conferirRobo(input: { turnstile?: unknown }, deps: DepsLinkIa): Promise<void> {
  const ts = await deps.verificarTurnstile(typeof input.turnstile === 'string' ? input.turnstile : null);
  if (ts === 'indisponivel') throw new LinkIaError(503, MSG_AUTORIZACAO.turnstileFora);
  if (ts !== 'ok') throw new LinkIaError(403, MSG_AUTORIZACAO.robo);
  if (!(await consumirLimite(deps.db ?? getDb(), chaveDoLimite('autorizacao-ia-ip', deps.ipDoLimite ?? 'sem-ip'), POR_HORA_IP, 3600, deps.agora ?? new Date()))) {
    throw new LinkIaError(429, MSG_AUTORIZACAO.muitasTentativas);
  }
}

/**
 * US-107 "Autorizo o envio para fora do Brasil" pelo link: o evento `autorizou` (canal link, sem conta, IP, user-agent e o
 * HMAC do e-mail para onde o link foi) com o paciente travado, e a confirmação com o link de retirada. Já vigente → nada.
 */
export async function autorizarPeloLink(token: unknown, input: { turnstile?: unknown }, deps: DepsLinkIa): Promise<void> {
  await conferirRobo(input, deps);
  const l = lerLinkAutorizacao(token);
  if (!l || l.tipo !== 'pedido') throw new LinkIaError(410, MSG_AUTORIZACAO.linkInvalido);
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctxDo(l, deps.ip),
    async (tx) => {
      const c = await lerNoContexto(tx, l, deps.ia, true);
      const u = c && pedidoUtilizavel(c, deps.ia);
      if (!c || !u) throw new LinkIaError(410, MSG_AUTORIZACAO.linkInvalido);
      if (vencido(l, agora)) throw new LinkIaError(410, MSG_AUTORIZACAO.linkExpirado);
      if (c.situacao.tipo === 'vigente') return;
      const [a] = await tx
        .insert(iaAutorizacoes)
        .values({ tenantId: l.tenantId, patientId: c.p.id, evento: 'autorizou', versao: AUTORIZACAO_IA_VERSAO, usos: [...AUTORIZACAO_IA_USOS], destino: u.destino, canal: 'link', emailHmac: emailHmac(c.p.email!), ip: deps.ip, userAgent: deps.userAgent?.slice(0, 300) ?? null })
        .returning({ id: iaAutorizacoes.id });
      await enfileirarConfirmacao(tx, { tenantId: l.tenantId, patientId: c.p.id, autorizacaoId: a.id, para: c.p.email, consultorio: c.t.nomeExibicao, destino: u.destino, appUrl: deps.appUrl });
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-109 "Retirar autorização" pelo link — o de retirada (D11: não vence, vale só para a autorização daquele link, com a IA
 * desativada inclusive) ou o do pedido ainda válido (retira a autorização atual). O evento `retirou` (canal link) e o job
 * `ia-retirada` na mesma transação, com o paciente travado. Paciente anonimizado → link inválido.
 */
export async function retirarPeloLink(token: unknown, input: { turnstile?: unknown }, deps: DepsLinkIa): Promise<void> {
  await conferirRobo(input, deps);
  const l = lerLinkAutorizacao(token);
  if (!l) throw new LinkIaError(410, MSG_AUTORIZACAO.linkInvalido);
  const agora = deps.agora ?? new Date();
  const boss = deps.boss ?? (await getBoss());
  await withTenant(
    ctxDo(l, deps.ip),
    async (tx) => {
      const c = await lerNoContexto(tx, l, deps.ia, true);
      if (!c || c.p.anonimizadoEm) throw new LinkIaError(410, MSG_AUTORIZACAO.linkInvalido);
      if (vencido(l, agora)) throw new LinkIaError(410, MSG_AUTORIZACAO.linkExpirado);
      const atual = autorizacaoAtual(c.situacao);
      if (!atual || (l.tipo === 'retirada' && atual.id !== l.autorizacaoId)) throw new LinkIaError(410, MSG_AUTORIZACAO.naoVigente);
      const [r] = await tx
        .insert(iaAutorizacoes)
        .values({ tenantId: l.tenantId, patientId: c.p.id, evento: 'retirou', canal: 'link', emailHmac: c.p.email ? emailHmac(c.p.email) : null, ip: deps.ip, userAgent: deps.userAgent?.slice(0, 300) ?? null })
        .returning({ id: iaAutorizacoes.id });
      const job = await boss.send('ia-retirada', { tenantId: l.tenantId, patientId: c.p.id, retiradaId: r.id }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou a retirada da autorização de IA');
    },
    deps.db ?? getDb(),
  );
}
