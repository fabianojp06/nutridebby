import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from './db';
import { tenants } from '@/db/schema';
import { listTenantTables, PACIENTE_ESCREVE, PUBLICO_LIBERADO, RLS_EXCEPTIONS, STAFF_ONLY } from '@/db/rls-guard';
import { withConta, withTenant } from '@/db/tenant';

let seqConsulta = 0;
/** Cada chamada ganha um horário próprio de 1 h (EXCLUDE appointments_sem_sobreposicao). */
const horaIso = () => sql`'2030-01-01T00:00:00Z'::timestamptz + ${++seqConsulta} * interval '2 hours'`;

/**
 * RNF-07: "tenta ler, alterar e excluir dados de outro tenant e de outro paciente do mesmo tenant
 * em todas as tabelas 🔒". Cada tabela nova com tenant_id PRECISA de uma fábrica aqui.
 *
 * PF-F3: as fábricas semeiam os DOIS tenants (A e B), cada um com os seus dois pacientes, para que o
 * teste falhe tanto se uma política negar tudo quanto se liberar tudo.
 * P03: as tabelas filhas têm FK composta (tenant_id, patient_id) → patients, então cada tenant tem os
 * próprios pacientes (PAC) e `patients` é semeada primeiro e apagada por último (ULTIMAS).
 * Fábrica que precisa de uma linha-mãe (etiqueta, atendimento) cria a mãe no mesmo comando (CTE).
 */
const FABRICAS: Record<string, (tenantId: string, patientId: string) => SQL> = {
  audit_log: (t, p) => sql`insert into audit_log (tenant_id, acao, entidade, patient_id) values (${t}, 'ler', 'isolamento', ${p})`,
  data_exports: (t, p) => sql`insert into data_exports (tenant_id, patient_id) values (${t}, ${p})`,
  exams: (t, p) => sql`insert into exams (tenant_id, patient_id, data, titulo) values (${t}, ${p}, '2026-01-01', 'Iso')`,
  privacy_requests: (t, p) => sql`insert into privacy_requests (tenant_id, patient_id, tipo, prazo) values (${t}, ${p}, 'exclusao', '2026-01-16')`,
  stored_files: (t, p) =>
    sql`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values (${t}, ${p}, 'exame', ${`${t}/exame/${randomUUID()}.png`}, 1, 'image/png')`,
  rls_fixture_patient_items: (t, p) => sql`insert into rls_fixture_patient_items (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
  audit_fixture_registros: (t, p) => sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
  patients: (t, p) =>
    sql`insert into patients (id, tenant_id, nome, data_nascimento, sexo, email) values (${p}, ${t}, 'Iso', '1990-01-01', 'F', ${`iso-${p}@teste.dev`})`,
  anthropometry: (t, p) => sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${t}, ${p}, '2026-01-01', 70, 175)`,
  energy_calcs: (t, p) =>
    sql`insert into energy_calcs (tenant_id, patient_id, formula, peso_kg, altura_cm, idade, sexo, fator_atividade, tmb, get)
        values (${t}, ${p}, 'mifflin', 60, 165, 35, 'F', 1.55, 1295.25, 2007.64)`,
  anamnesis_templates: (t) => sql`insert into anamnesis_templates (tenant_id, nome, schema) values (${t}, 'Iso', '{"perguntas":[]}')`,
  consultations: (t, p) => sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${t}, ${p}, '2026-01-01', 'x')`,
  consultation_notes: (t, p) => sql`with c as (insert into consultations (tenant_id, patient_id, data) values (${t}, ${p}, '2026-01-01') returning id)
    insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) select ${t}, ${p}, c.id, 'x' from c`,
  anamneses: (t, p) =>
    sql`insert into anamneses (tenant_id, patient_id, template_snapshot, data) values (${t}, ${p}, '{"nome":"Iso","perguntas":[]}', '2026-01-01')`,
  patient_tags: (t) => sql`insert into patient_tags (tenant_id, nome) values (${t}, ${`iso-${randomUUID().slice(0, 8)}`})`,
  patient_tag_links: (t, p) => sql`with e as (insert into patient_tags (tenant_id, nome) values (${t}, ${`iso-${randomUUID().slice(0, 8)}`}) returning id)
    insert into patient_tag_links (tenant_id, patient_id, tag_id) select ${t}, ${p}, e.id from e`,
  foods: (t) =>
    sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
        values (${t}, 'Iso', 'Miscelâneas', 100, 1, 1, 1, 1)`,
  food_measures: (t) =>
    sql`insert into food_measures (tenant_id, food_id, nome, plural, gramas)
        values (${t}, '00000000-0000-4000-8000-000000000003', ${`Iso ${randomUUID().slice(0, 8)}`}, 'Isos', 10)`,
  meal_plans: (t, p) => sql`insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'publicado')`,
  meals: (t, p) =>
    sql`with pl as (insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'arquivado') returning id)
        insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem) select gen_random_uuid(), ${t}, ${p}, pl.id, 'Café', 0 from pl`,
  meal_items: (t, p) =>
    sql`with pl as (insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'arquivado') returning id),
             ml as (insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem) select gen_random_uuid(), ${t}, ${p}, pl.id, 'Café', 0 from pl returning id, plan_id)
        insert into meal_items (id, tenant_id, patient_id, plan_id, meal_id, food_id, quantidade_g, ordem)
        select gen_random_uuid(), ${t}, ${p}, ml.plan_id, ml.id, '00000000-0000-4000-8000-000000000003', 100, 0 from ml`,
  availability_rules: (t) =>
    sql`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade) values (${t}, 2, '08:00', '12:00', 60, 'presencial')`,
  availability_blocks: (t) =>
    sql`insert into availability_blocks (tenant_id, inicio, fim, motivo) values (${t}, '2030-01-01T03:00:00Z', '2030-01-02T03:00:00Z', 'Iso')`,
  appointments: (t, p) => {
    const h = horaIso();
    return sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values (${t}, ${p}, ${h}, ${h} + interval '1 hour', 'presencial', 'nutri')`;
  },
  notifications: (t, p) => {
    const h = horaIso();
    return sql`with c as (insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem)
        values (${t}, ${p}, ${h}, ${h} + interval '1 hour', 'presencial', 'nutri') returning id, inicio)
      insert into notifications (tenant_id, patient_id, appointment_id, inicio_consulta, canal, tipo, agendada_para) select ${t}, ${p}, c.id, c.inicio, 'email', 'lembrete_24h', now() from c`;
  },
  public_booking_requests: (t) =>
    sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, modalidade, termo_versao, expira_em)
        values (gen_random_uuid(), ${t}, ${randomUUID()}, 'x', ${`iso-${randomUUID().slice(0, 8)}@teste.dev`}, 'Iso', '2030-01-01T12:00:00Z', 'presencial', 't', now() + interval '10 minutes')`,
  access_events: (t, p) => sql`insert into access_events (tenant_id, patient_id, dia) values (${t}, ${p}, ${`2030-01-${String((++seqConsulta % 28) + 1).padStart(2, '0')}`})`,
  push_subscriptions: (t, p) =>
    sql`insert into push_subscriptions (tenant_id, patient_id, endpoint, p256dh, auth) values (${t}, ${p}, ${`https://push.example.test/${randomUUID()}`}, ${'a'.repeat(87)}, ${'b'.repeat(22)})`,
  diary_entries: (t, p) => sql`insert into diary_entries (tenant_id, patient_id, refeicao, texto) values (${t}, ${p}, 'Almoço', 'arroz e feijão')`,
  // uma linha por tenant (tenant_id UNIQUE): a fábrica roda duas vezes por tenant
  whatsapp_conexoes: (t) =>
    sql`insert into whatsapp_conexoes (tenant_id, instancia) select ${t}, ${`nd-${t}`} where not exists (select 1 from whatsapp_conexoes where tenant_id = ${t})`,
};
/** Tabelas append-only: UPDATE/DELETE já são negados por permissão. */
const SO_INSERE = new Set(['audit_log']);
/** Apagadas por último no teste de DELETE (as filhas têm FK NO ACTION/RESTRICT para elas: os itens de plano, Tarefa 6, referenciam `foods`). */
const ULTIMAS = ['meals', 'meal_plans', 'anamnesis_templates', 'foods', 'appointments', 'patients'];

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let A: string;
let B: string;
let PAC: Record<string, [string, string]> = {};
let P1: string;
let P2: string;
let tabelas: string[] = [];
let soEquipe = new Set<string>();

const naOrdemDeCriacao = (ts: string[]) => [...ts.filter((t) => t === 'patients'), ...ts.filter((t) => t !== 'patients')];
const naOrdemDeExclusao = (ts: string[]) => [...ts.filter((t) => !ULTIMAS.includes(t)), ...ULTIMAS.filter((t) => ts.includes(t))];

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `iso-a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso A' },
      { slug: `iso-b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  PAC = { [A]: [randomUUID(), randomUUID()], [B]: [randomUUID(), randomUUID()] };
  [P1, P2] = PAC[A];
  tabelas = naOrdemDeCriacao((await listTenantTables(owner.pool)).filter((t) => !RLS_EXCEPTIONS[t]));
  soEquipe = new Set(
    (await owner.pool.query<{ t: string }>(`select tablename as t from pg_policies where schemaname = 'public' and policyname = 'staff_only'`)).rows.map((r) => r.t),
  );
  for (const t of tabelas) {
    if (!FABRICAS[t]) continue;
    for (const tenantId of [A, B]) {
      for (const p of PAC[tenantId]) await withTenant({ tenantId, role: 'nutri' }, (tx) => tx.execute(FABRICAS[t](tenantId, p)), app.db);
    }
  }
});
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

/** Coluna do titular por tabela: em `patients` é o próprio `id` (app_enable_patient_rls('patients', 'id')). */
const COLUNA_TITULAR: Record<string, string> = { patients: 'id' };
/** O paciente nunca é apagado (arquiva, bloqueia, anonimiza), e as filhas `staff_only`, invisíveis para P2, seguram a FK. */
const SEM_DELETE_DO_PACIENTE = new Set(['patients']);

const colunaTitular = async (t: string): Promise<string | null> => {
  if (COLUNA_TITULAR[t]) return COLUNA_TITULAR[t];
  const r = await owner.pool.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'patient_id'`,
    [t],
  );
  return r.rowCount! > 0 ? 'patient_id' : null;
};

const contarTenant = async (t: string, tenantId: string) =>
  Number((await owner.pool.query(`select count(*)::int as n from "${t}" where tenant_id = $1`, [tenantId])).rows[0].n);

/** Recusa pela política da RLS (WITH CHECK), não por outro motivo qualquer. */
const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
  return c.code === '42501' && /row-level security/.test(c.message ?? '');
};

const contarPaciente = async (t: string, col: string, tenantId: string, patientId: string) =>
  Number(
    (await owner.pool.query(`select count(*)::int as n from "${t}" where tenant_id = $1 and "${col}" = $2`, [tenantId, patientId]))
      .rows[0].n,
  );

describe('isolamento em todas as tabelas 🔒 (RNF-07, US-006)', () => {
  it('toda tabela com tenant_id tem fábrica neste teste', () => {
    expect(tabelas.filter((t) => !FABRICAS[t])).toEqual([]);
  });

  // M12: roda antes dos testes que apagam as linhas de B/P2 (o UPDATE precisa de linhas visíveis)
  it('WITH CHECK: o tenant B não grava linha com o tenant_id de A nem move a própria linha para A', async () => {
    for (const t of tabelas) {
      const antesA = await contarTenant(t, A);
      const comoB = (q: SQL) => withTenant({ tenantId: B, role: 'nutri' }, (tx) => tx.execute(q), app.db);
      await expect(comoB(FABRICAS[t](A, P1)), t).rejects.toSatisfy(violaRls);
      if (!SO_INSERE.has(t)) {
        expect(await contarTenant(t, B), t).toBeGreaterThan(0); // há linha de B para tentar mover
        await expect(comoB(sql`update ${sql.identifier(t)} set tenant_id = ${A}`), t).rejects.toSatisfy(violaRls);
      }
      expect(await contarTenant(t, A), t).toBe(antesA);
    }
  });

  it('WITH CHECK: a paciente P2 não grava linha de P1 nem move a própria linha para P1 (inclusive em patients)', async () => {
    for (const t of tabelas) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t)) continue;
      const antesP1 = await contarPaciente(t, col, A, P1);
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2 }, (tx) => tx.execute(q), app.db);
      // a RLS (42501) é conferida antes da PK/UNIQUE e da FK: em patients o INSERT com id = P1 cai na política
      await expect(comoP2(FABRICAS[t](A, P1)), t).rejects.toSatisfy(violaRls);
      if (!SO_INSERE.has(t)) {
        expect(await contarPaciente(t, col, A, P2), t).toBeGreaterThan(0);
        const mover = sql`update ${sql.identifier(t)} set ${sql.identifier(col)} = ${P1}`;
        // D1 (R1): sem `update` em PACIENTE_ESCREVE, paciente_sem_update (USING) esconde a linha do UPDATE: 0 linhas, sem erro
        if ((PACIENTE_ESCREVE[t]?.comandos ?? []).includes('update')) await expect(comoP2(mover), t).rejects.toSatisfy(violaRls);
        else expect((await comoP2(mover)).rowCount, t).toBe(0);
      }
      expect(await contarPaciente(t, col, A, P1), t).toBe(antesP1);
    }
  });

  it('D1: fora de PACIENTE_ESCREVE, a paciente P2 não cria nem a própria linha (tabelas com titular)', async () => {
    for (const t of tabelas) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t) || (PACIENTE_ESCREVE[t]?.comandos ?? []).includes('insert')) continue;
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2 }, (tx) => tx.execute(q), app.db);
      await expect(comoP2(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRls);
    }
  });

  it('staff_only: a sessão de paciente não vê nem grava nada nessas tabelas, nem as próprias linhas (US-016, US-019)', async () => {
    // itera a lista declarada (não o que o banco tem): tabela que perdeu a política não pode ser pulada em silêncio
    for (const t of Object.keys(STAFF_ONLY)) {
      expect(tabelas, t).toContain(t);
      expect(soEquipe.has(t), t).toBe(true);
      expect(await contarTenant(t, A), t).toBeGreaterThan(0); // as linhas existem: é a política que esconde
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2 }, (tx) => tx.execute(q), app.db);
      const vistas = await comoP2(sql`select 1 from ${sql.identifier(t)}`);
      expect(vistas.rows.length, t).toBe(0);
      await expect(comoP2(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRls);
    }
  });

  it('publico (D11): só lê e grava o que PUBLICO_LIBERADO declara; o resto — notas, anamnese… — dá 0 linhas e recusa a escrita', async () => {
    const comoPublico = (q: SQL) => withTenant({ tenantId: A, role: 'publico' }, (tx) => tx.execute(q), app.db);
    for (const t of tabelas) {
      expect(await contarTenant(t, A), t).toBeGreaterThan(0); // as linhas existem: é a política que esconde
      const pode = PUBLICO_LIBERADO[t]?.comandos ?? [];
      const vistas = (await comoPublico(sql`select tenant_id from ${sql.identifier(t)}`)).rows;
      if (pode.includes('select')) {
        expect(vistas.length, t).toBeGreaterThan(0);
        for (const row of vistas) expect(row.tenant_id, t).toBe(A); // nem o publico atravessa tenants
      } else expect(vistas.length, t).toBe(0);
      if (pode.includes('insert')) await expect(comoPublico(FABRICAS[t](B, PAC[B][0])), t).rejects.toSatisfy(violaRls);
      else await expect(comoPublico(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRls);
      if (SO_INSERE.has(t)) continue; // UPDATE/DELETE já negados por permissão
      if (!pode.includes('update')) expect((await comoPublico(sql`update ${sql.identifier(t)} set tenant_id = tenant_id`)).rowCount, t).toBe(0);
      if (!pode.includes('delete')) expect((await comoPublico(sql`delete from ${sql.identifier(t)}`)).rowCount, t).toBe(0);
    }
    expect((await comoPublico(sql`select 1 from consultation_notes`)).rows).toEqual([]);
    expect((await comoPublico(sql`select 1 from anamneses`)).rows).toEqual([]);
  });

  it('conta (D2): sem tenant, não vê nem grava nada em nenhuma tabela 🔒 (patients só pela política da própria conta)', async () => {
    const outra = randomUUID(); // conta sem vínculo nenhum: a política compara com app.user_id, sem FK para `user`
    for (const t of tabelas) {
      expect(await contarTenant(t, A), t).toBeGreaterThan(0); // as linhas existem: é a política que esconde
      // R4: a TACO (foods com tenant_id nulo, taco_leitura) é dado público de referência, legível por qualquer sessão
      const vistas = await withConta(outra, (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)} where tenant_id is not null`), app.db);
      expect(vistas.rows.length, t).toBe(0);
      await expect(withConta(outra, (tx) => tx.execute(FABRICAS[t](A, P1)), app.db), t).rejects.toSatisfy(violaRls);
    }
  });

  it('o tenant B só vê e só altera as próprias linhas; as de A ficam intactas', async () => {
    for (const t of naOrdemDeExclusao(tabelas)) {
      const id = sql.identifier(t);
      const antesA = await contarTenant(t, A);
      await withTenant(
        { tenantId: B, role: 'nutri' },
        async (tx) => {
          // SELECT sem filtro: RLS precisa devolver só (e todas) as linhas de B — não zero (política que nega
          // tudo) nem inclui A (política que libera tudo).
          const vistas = await tx.execute(sql`select tenant_id from ${id}`);
          // D1: em foods, B também lê a TACO (tenant_id nulo), mas só altera e apaga as próprias linhas
          const proprias = vistas.rows.filter((row) => row.tenant_id === B);
          expect(proprias.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.tenant_id === B || (t === 'foods' && row.tenant_id === null), t).toBe(true);
          if (SO_INSERE.has(t)) return;
          // UPDATE e DELETE sem filtro: só podem afetar as linhas próprias que a RLS mostrou
          const alteradas = await tx.execute(sql`update ${id} set tenant_id = tenant_id`);
          expect(alteradas.rowCount, t).toBe(proprias.length);
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(proprias.length);
        },
        app.db,
      );
      if (!SO_INSERE.has(t)) {
        expect(await contarTenant(t, A), t).toBe(antesA); // owner confirma: A não foi tocado
        expect(await contarTenant(t, B), t).toBe(0); // e o DELETE de B de fato aconteceu
      }
    }
  });

  it('a paciente P2 só vê e só altera as próprias linhas; as de P1 (mesmo tenant) ficam intactas (inclusive em patients)', async () => {
    for (const t of naOrdemDeExclusao(tabelas)) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t)) continue;
      const id = sql.identifier(t);
      const c = sql.identifier(col);
      const antesP1 = await contarPaciente(t, col, A, P1);
      const apaga = !SO_INSERE.has(t) && !SEM_DELETE_DO_PACIENTE.has(t);
      await withTenant(
        { tenantId: A, role: 'paciente', patientId: P2 },
        async (tx) => {
          const vistas = await tx.execute(sql`select ${c} as titular from ${id}`);
          expect(vistas.rows.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.titular, t).toBe(P2);
          if (SO_INSERE.has(t)) return;
          const pode = PACIENTE_ESCREVE[t]?.comandos ?? [];
          const alteradas = await tx.execute(sql`update ${id} set ${c} = ${c}`);
          // D1: sem `update` em PACIENTE_ESCREVE, o UPDATE da própria linha também dá 0 (paciente_sem_update)
          expect(alteradas.rowCount, t).toBe(pode.includes('update') ? vistas.rows.length : 0);
          if (!apaga) return;
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(pode.includes('delete') ? vistas.rows.length : 0);
        },
        app.db,
      );
      expect(await contarPaciente(t, col, A, P1), t).toBe(antesP1); // owner confirma: as linhas de P1 seguem intactas
      if (apaga && (PACIENTE_ESCREVE[t]?.comandos ?? []).includes('delete')) expect(await contarPaciente(t, col, A, P2), t).toBe(0);
    }
  });
});
