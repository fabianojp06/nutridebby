import type { Pool, PoolClient } from 'pg';

export type RlsViolation = { table: string; problem: string };

/**
 * Tabelas com tenant_id que seguem outra regra, com a justificativa.
 * foods não é exceção: tem tenant_isolation e, além dela, a política taco_leitura (só SELECT) para as linhas da TACO (Plano 04, D1).
 */
export const RLS_EXCEPTIONS: Record<string, string> = {
  user: 'identidade global do Better Auth: login ocorre antes do contexto de tenant; acesso só via services do M1 (spec §4.1)',
  consents:
    'prova de aceite (termo do paciente, DPA) gravada fora do contexto de tenant, append-only; tenant_id só identifica o vínculo aceito; acesso só por src/modules/plataforma/dpa.ts, src/modules/pacientes/convite-paciente.ts, src/modules/agenda/agendamento-publico.ts (aceite da página pública, D13), src/modules/pacientes/exportacao-job.ts (leitura dos aceites do titular no dados.json), src/modules/portal/termo.ts (novo aceite do termo no portal, US-011), test/portal.ts (helper de testes que grava o aceite do termo do paciente) e scripts/e2e-seed.ts (aceites da conta de paciente de vários consultórios do E2E); a anonimização (src/modules/pacientes/lgpd.ts) só pela função app_anonimizar_aceites (0065)',
  invites:
    'lido pelo token antes de existir sessão (o paciente ainda nem tem conta); acesso só por src/modules/plataforma/convites.ts, src/modules/pacientes/convite-paciente.ts e src/modules/plataforma/contas.ts (validade do convite da nutricionista na lista do admin)',
};

/** Tabelas com patient_id que não precisam da política de paciente, com a justificativa. */
export const PATIENT_POLICY_EXCEPTIONS: Record<string, string> = {
  stored_files:
    'D4: política própria paciente_arquivos — o paciente vê os próprios arquivos e os do consultório (logo, capa, patient_id nulo)',
};

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
  maps: Record<string, Record<string, unknown>>,
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

/** Tabelas que a sessão de paciente nunca vê (política RESTRICTIVE staff_only), com o motivo. */
export const STAFF_ONLY: Record<string, string> = {
  patient_tags: 'US-019: o paciente não vê etiquetas, nem no JSON da API',
  patient_tag_links: 'US-019: o paciente não vê etiquetas, nem no JSON da API',
  consultation_notes: 'US-016: o paciente nunca vê as notas privadas, nem no JSON da API',
  availability_rules: 'US-030 / D11: o paciente só recebe horários livres já calculados, nunca as regras',
  availability_blocks: 'US-030 / D11: o motivo do bloqueio pode ser pessoal ("Médico")',
  public_booking_requests: 'RN-16: pedido da página pública (código, contato) — só o contexto publico e a equipe',
  whatsapp_conexoes: 'D2: número e estado do WhatsApp do consultório — só a equipe',
};

export async function findStaffOnlyViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string }>(
    `select tablename as t from pg_policies
      where schemaname = 'public' and policyname = 'staff_only' and permissive = 'RESTRICTIVE'`,
  );
  const com = new Set(rows.map((r) => r.t));
  return Object.keys(STAFF_ONLY)
    .filter((t) => !com.has(t))
    .map((table) => ({ table, problem: 'sem política staff_only (app_enable_staff_only)' }));
}

export type ComandoPublico = 'select' | 'insert' | 'update' | 'delete';
const COMANDOS: readonly ComandoPublico[] = ['select', 'insert', 'update', 'delete'];

/**
 * D11: tabelas que o contexto `publico` (páginas sem login) pode tocar, só com estes comandos. Toda outra tabela
 * com tenant_id tem `publico_negado` (app_enable_tenant_rls). Liberar = `SELECT app_allow_publico(...)` + entrada aqui.
 */
export const PUBLICO_LIBERADO: Record<string, { comandos: readonly ComandoPublico[]; motivo: string }> = {
  availability_rules: { comandos: ['select'], motivo: 'horários livres (horariosLivres)' },
  availability_blocks: { comandos: ['select'], motivo: 'horários livres (horariosLivres)' },
  appointments: { comandos: ['select', 'insert'], motivo: 'início/fim nos horários livres, dono do link da consulta e a consulta marcada pela página pública' },
  patients: { comandos: ['select', 'insert'], motivo: 'situação do dono do link; paciente da página pública (procura pelo e-mail e cria)' },
  audit_log: { comandos: ['insert'], motivo: 'o gatilho de auditoria roda com o papel de quem grava (patients, appointments da página pública)' },
  notifications: { comandos: ['select', 'insert'], motivo: 'lembretes da consulta marcada pela página pública (INSERT … ON CONFLICT lê a linha nova)' },
  public_booking_requests: { comandos: ['select', 'insert', 'update'], motivo: 'pedido da página pública: cria, confere o código (FOR UPDATE) e conclui' },
};

/** Toda tabela com tenant_id (fora de RLS_EXCEPTIONS) nega o `publico`, ou bate exatamente com PUBLICO_LIBERADO. */
export async function findPublicoViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string }>(
    `select tablename as t, policyname as pol, cmd, permissive from pg_policies
      where schemaname = 'public' and policyname like 'publico%'`,
  );
  const out: RlsViolation[] = [];
  for (const table of await listTenantTables(db)) {
    if (RLS_EXCEPTIONS[table]) continue;
    const pols = rows.filter((r) => r.t === table);
    const liberado = PUBLICO_LIBERADO[table];
    if (!liberado) {
      if (pols.length !== 1 || pols[0].pol !== 'publico_negado' || pols[0].cmd !== 'ALL' || pols[0].permissive !== 'RESTRICTIVE') {
        out.push({ table, problem: pols.some((p) => p.pol !== 'publico_negado') ? 'liberada ao publico sem entrada em PUBLICO_LIBERADO' : 'sem política publico_negado (app_enable_tenant_rls/app_deny_publico)' });
      }
      continue;
    }
    const negados = COMANDOS.filter((c) => !liberado.comandos.includes(c));
    const esperadas = negados.map((c) => `publico_sem_${c}`).sort();
    // nome, comando e RESTRICTIVE: um `publico_sem_update` criado FOR SELECT (ou PERMISSIVE) não nega o UPDATE
    const certas = pols.filter((p) => p.permissive === 'RESTRICTIVE' && negados.some((c) => p.pol === `publico_sem_${c}` && p.cmd === c.toUpperCase()));
    const atuais = certas.map((p) => p.pol).sort();
    if (pols.length !== certas.length || JSON.stringify(atuais) !== JSON.stringify(esperadas)) {
      out.push({ table, problem: `políticas do publico diferentes de PUBLICO_LIBERADO (esperado ${esperadas.join(', ') || 'nenhuma'})` });
    }
  }
  return out;
}

export type ComandoEscrita = 'insert' | 'update' | 'delete';
const ESCRITAS: readonly ComandoEscrita[] = ['insert', 'update', 'delete'];

/**
 * D1 (Plano 06, P-16 a): o que a sessão de paciente pode gravar, só com estes comandos. Toda outra tabela com tenant_id
 * tem `paciente_sem_insert/update/delete` (app_enable_tenant_rls). Liberar = `SELECT app_allow_paciente_escrita(...)` +
 * entrada aqui. Sem `update`, SELECT … FOR UPDATE/SHARE de paciente não enxerga a linha.
 */
export const PACIENTE_ESCREVE: Record<string, { comandos: readonly ComandoEscrita[]; motivo: string }> = {
  patients: { comandos: ['update'], motivo: 'aceite do convite (US-011), opt-in/opt-out do WhatsApp e a trava FOR UPDATE das ações do paciente' },
  appointments: { comandos: ['insert', 'update'], motivo: 'agendar, confirmar, cancelar e remarcar pelo link, pelo WhatsApp e pelo portal (US-032, US-033, US-035)' },
  notifications: { comandos: ['insert', 'update'], motivo: 'lembretes da consulta marcada pelo paciente, respostas "1"/"2" e lembretes cancelados' },
  audit_log: { comandos: ['insert'], motivo: 'o gatilho de auditoria e o auditRead rodam com o papel de quem age' },
  stored_files: { comandos: ['insert'], motivo: 'foto do diário (US-042): salvarArquivo com a sessão do paciente — só o tipo diario_foto_original (0080)' },
  access_events: { comandos: ['insert'], motivo: 'CS-02: o paciente registra o acesso do dia (D9)' },
  push_subscriptions: { comandos: ['insert', 'delete'], motivo: 'INT-03 / P06-02: ativar e cancelar notificações no aparelho' },
  diary_entries: { comandos: ['insert'], motivo: 'US-042: o paciente registra a refeição (não edita nem apaga, D11); sem foto convertida, comentário nem "visto" (0080)' },
  privacy_requests: { comandos: ['insert'], motivo: 'US-046: o titular pede a exclusão' },
  data_exports: { comandos: ['insert', 'update'], motivo: 'US-046: o titular pede os próprios dados (solicitarExportacao marca o pendente esquecido como falhou); só escopo titular (0080)' },
};

/** Toda tabela com tenant_id (fora de RLS_EXCEPTIONS) nega a escrita do paciente, ou bate exatamente com PACIENTE_ESCREVE. */
export async function findPacienteEscritaViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string }>(
    `select tablename as t, policyname as pol, cmd, permissive from pg_policies
      where schemaname = 'public' and policyname like 'paciente\\_sem\\_%'`,
  );
  const out: RlsViolation[] = [];
  for (const table of await listTenantTables(db)) {
    if (RLS_EXCEPTIONS[table]) continue;
    const pode = PACIENTE_ESCREVE[table]?.comandos ?? [];
    for (const c of ESCRITAS) {
      // nome, comando e RESTRICTIVE: um `paciente_sem_delete` criado FOR SELECT (ou PERMISSIVE) não nega o DELETE
      const negada = rows.some((r) => r.t === table && r.pol === `paciente_sem_${c}` && r.cmd === c.toUpperCase() && r.permissive === 'RESTRICTIVE');
      if (!pode.includes(c) && !negada) out.push({ table, problem: `a sessão de paciente pode ${c} sem entrada em PACIENTE_ESCREVE` });
      if (pode.includes(c) && rows.some((r) => r.t === table && r.pol === `paciente_sem_${c}`)) {
        out.push({ table, problem: `PACIENTE_ESCREVE libera ${c}, mas o banco nega (paciente_sem_${c})` });
      }
    }
  }
  return out;
}
