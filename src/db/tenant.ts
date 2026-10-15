import { isIP } from 'node:net';
import { sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from './client';
import { sanitizarErroDeBanco } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `publico` (Plano 05, D11): contexto de sistema das páginas sem login (/n/<slug>, link da consulta) e do
 * cálculo de horários livres. No banco, toda tabela com tenant_id nega o `publico` (RESTRICTIVE `publico_negado`),
 * menos as de `PUBLICO_LIBERADO` (src/db/rls-guard.ts), só nos comandos listados. A RLS não restringe colunas:
 * por isso o `publico` só é usado dentro de funções fechadas de src/modules/agenda que devolvem o mínimo (intervalos, ids).
 */
export type TenantRole = 'nutri' | 'paciente' | 'worker' | 'publico';
const ROLES: readonly TenantRole[] = ['nutri', 'paciente', 'worker', 'publico'];

export type TenantContext = {
  tenantId: string;
  role: TenantRole;
  patientId?: string;
  /** Quem age (auditoria, RNF-08). Obrigatório para `nutri`; para `paciente`, salvo com `semConta`. Ausente em jobs do worker. */
  actorUserId?: string;
  /**
   * N7 (Plano 08): paciente agindo **sem sessão de login** (link assinado da consulta, resposta pelo WhatsApp, leitura do
   * convite antes da conta existir) e a leitura do contexto da IA Nutri no worker, sem escrita (Plano 15, §4.2). Mantém a
   * RLS por paciente; o `audit_log` sai sem ator, como a D20 do Plano 05 define.
   * Só os arquivos de `SEM_CONTA_PERMITIDOS` usam (guarda em sem-conta-guarda.test.ts).
   */
  semConta?: true;
  /** IP de quem fez a requisição (auditoria). */
  ip?: string | null;
};

/** N7: lista fechada dos fluxos de paciente sem sessão de login (sem-conta-guarda.test.ts). */
export const SEM_CONTA_PERMITIDOS: readonly string[] = [
  'src/modules/agenda/acoes-link.ts',
  'src/modules/documentos/link-documento.ts',
  'src/modules/ia/autorizacao-link.ts',
  'src/modules/ia/nutri-paciente/contexto.ts',
  'src/modules/notificacoes/whatsapp/webhook.ts',
  'src/modules/pacientes/convite-paciente.ts',
];

export class TenantContextError extends Error {
  override name = 'TenantContextError';
}

function assertContext(ctx: TenantContext): void {
  if (!UUID.test(ctx.tenantId)) throw new TenantContextError('tenantId inválido');
  // Lista em tempo de execução: o tipo não protege chamadas vindas de `as` ou de JS
  if (!ROLES.includes(ctx.role)) throw new TenantContextError('papel inválido para withTenant (o admin nunca consulta tabelas 🔒)');
  if (ctx.role === 'paciente') {
    if (!ctx.patientId || !UUID.test(ctx.patientId)) {
      throw new TenantContextError('patientId obrigatório para sessão de paciente');
    }
  } else if (ctx.patientId !== undefined) {
    throw new TenantContextError('patientId só é permitido para sessão de paciente');
  }
  // N7 (Plano 03): toda escrita com sessão de login vai para o audit_log com o ator — sem ele, a linha sai anônima.
  // Paciente sem login (link, WhatsApp, convite) declara isso com semConta: true (lista fechada em SEM_CONTA_PERMITIDOS).
  if (ctx.semConta !== undefined && (ctx.semConta !== true || ctx.role !== 'paciente' || ctx.actorUserId !== undefined)) {
    throw new TenantContextError('semConta só é permitido para paciente sem ator');
  }
  if ((ctx.role === 'nutri' || (ctx.role === 'paciente' && !ctx.semConta)) && !ctx.actorUserId) {
    throw new TenantContextError('actorUserId obrigatório para sessão de nutricionista ou paciente');
  }
  if (ctx.actorUserId !== undefined && !UUID.test(ctx.actorUserId)) throw new TenantContextError('actorUserId inválido');
  if (ctx.ip && isIP(ctx.ip) === 0) throw new TenantContextError('ip inválido');
}

/**
 * Executa `fn` numa transação com o contexto do tenant aplicado à RLS e à auditoria.
 * Toda consulta a tabela com tenant_id DEVE passar por aqui.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  assertContext(ctx);
  try {
    return await db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${ctx.tenantId}, true),
      set_config('app.role', ${ctx.role}, true),
      set_config('app.patient_id', ${ctx.patientId ?? ''}, true),
      set_config('app.user_id', ${ctx.actorUserId ?? ''}, true),
      set_config('app.ip', ${ctx.ip ?? ''}, true)`);
    return fn(tx);
    });
  } catch (err) {
    // DrizzleQueryError leva SQL + parâmetros na message; nada disso pode chegar a log/Sentry (RNF-11)
    throw sanitizarErroDeBanco(err) ?? err;
  }
}

/**
 * D2 (Plano 06): contexto `conta` — a conta de paciente (sem tenant) procurando os próprios vínculos. No banco, só a
 * política `paciente_por_conta` (patients, SELECT, user_id = app.user_id) libera linhas; toda outra tabela dá 0 linhas
 * (menos a TACO, `foods` com tenant_id nulo, legível por qualquer sessão) e nada é gravado. Só
 * src/modules/portal/vinculos.ts usa.
 */
export async function withConta<T>(userId: string, fn: (tx: Tx) => Promise<T>, db: Db = getDb()): Promise<T> {
  if (!UUID.test(userId)) throw new TenantContextError('userId inválido');
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select
        set_config('app.tenant_id', '', true),
        set_config('app.role', 'conta', true),
        set_config('app.patient_id', '', true),
        set_config('app.user_id', ${userId}, true),
        set_config('app.ip', '', true)`);
      return fn(tx);
    });
  } catch (err) {
    throw sanitizarErroDeBanco(err) ?? err;
  }
}
