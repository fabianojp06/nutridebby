import type { Pool, PoolClient } from 'pg';

export type RlsViolation = { table: string; problem: string };

/**
 * Tabelas com tenant_id que seguem outra regra, com a justificativa.
 * Ex. futuro (Plano 04): foods: 'tenant_id nulo = TACO; política própria de leitura'.
 */
export const RLS_EXCEPTIONS: Record<string, string> = {
  user: 'identidade global do Better Auth: login ocorre antes do contexto de tenant; acesso só via services do M1 (spec §4.1)',
  consents:
    'prova de aceite (termo do paciente, DPA) gravada fora do contexto de tenant, append-only; tenant_id só identifica o vínculo aceito; acesso só por src/modules/plataforma/dpa.ts e src/modules/pacientes/convite-paciente.ts',
  invites:
    'lido pelo token antes de existir sessão (o paciente ainda nem tem conta); acesso só por src/modules/plataforma/convites.ts, src/modules/pacientes/convite-paciente.ts e src/modules/plataforma/contas.ts (validade do convite da nutricionista na lista do admin)',
};

/** Tabelas com patient_id que não precisam da política de paciente, com a justificativa. */
export const PATIENT_POLICY_EXCEPTIONS: Record<string, string> = {};

interface TenantTableRow {
  table: string;
  rls: boolean;
  forced: boolean;
  has_tenant_policy: boolean;
  has_patient_col: boolean;
  has_patient_policy: boolean;
}

/**
 * Shared table selection for all tenant_id queries.
 * Selects regular and partitioned tables in public schema with a tenant_id column.
 */
const TENANT_TABLES_SELECTION = `
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
 where c.relkind in ('r', 'p')
   and exists (select 1 from information_schema.columns k where k.table_schema = 'public'
               and k.table_name = c.relname and k.column_name = 'tenant_id')
`;

/**
 * Retorna a lista de tabelas (regulares e particionadas) com coluna tenant_id.
 */
export async function listTenantTables(db: Pool | PoolClient): Promise<string[]> {
  const { rows } = await db.query<{ table: string }>(`
    select c.relname as table
    ${TENANT_TABLES_SELECTION}
     order by 1`);
  return rows.map(r => r.table);
}

export async function findRlsViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<TenantTableRow>(`
    select c.relname as table,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as forced,
           exists (select 1 from pg_policies p where p.schemaname = 'public'
                   and p.tablename = c.relname and p.policyname = 'tenant_isolation') as has_tenant_policy,
           (c.relname = 'patients' or exists (select 1 from information_schema.columns k where k.table_schema = 'public'
                   and k.table_name = c.relname and k.column_name = 'patient_id')) as has_patient_col,
           exists (select 1 from pg_policies p where p.schemaname = 'public'
                   and p.tablename = c.relname and p.policyname = 'patient_isolation') as has_patient_policy
    ${TENANT_TABLES_SELECTION}
     order by 1`);

  const out: RlsViolation[] = [];
  for (const r of rows) {
    if (RLS_EXCEPTIONS[r.table]) continue;
    if (!r.rls) out.push({ table: r.table, problem: 'RLS não habilitada' });
    else if (!r.forced) out.push({ table: r.table, problem: 'RLS não forçada' });
    else if (!r.has_tenant_policy) out.push({ table: r.table, problem: 'sem política tenant_isolation' });
    if (r.has_patient_col && !r.has_patient_policy && !PATIENT_POLICY_EXCEPTIONS[r.table]) {
      out.push({ table: r.table, problem: 'sem política patient_isolation' });
    }
  }
  return out;
}

/** Nomes citados nas listas de exceção que não existem no banco (lista esquecida após renomear/remover). */
export async function findStaleExceptions(
  db: Pool | PoolClient,
  maps: Record<string, Record<string, string>>,
): Promise<string[]> {
  const nomes = [...new Set(Object.values(maps).flatMap((m) => Object.keys(m)))];
  if (!nomes.length) return [];
  const { rows } = await db.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relname = any($1)`,
    [nomes],
  );
  const existentes = new Set(rows.map((r) => r.t));
  return Object.entries(maps).flatMap(([mapa, m]) =>
    Object.keys(m)
      .filter((t) => !existentes.has(t))
      .map((t) => `${mapa}: ${t}`),
  );
}
