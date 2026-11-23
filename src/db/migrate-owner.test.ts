import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { runMigrations } from './migrate';
import { novoPostgres, uriDoPostgres } from '../../test/postgres-teste';

// Tarefa 13 (Ruling R49): em produção o migrator é um role dono do banco SEM superusuário.
// Cluster próprio, montado como no runbook, para provar que as migrations rodam assim.
let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let appUrl: string;
let owner: Pool;
let app: Pool;

beforeAll(async () => {
  container = await novoPostgres().start();
  const su = new Pool({ connectionString: uriDoPostgres(container), max: 1 });
  // mesmos comandos do runbook (Tarefa 13, Step 1b), rodados uma vez como postgres
  await su.query(`CREATE ROLE nutri_owner LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD 'owner-pw'`);
  await su.query('CREATE DATABASE nutri OWNER nutri_owner');
  await su.end();
  const url = (user: string, password: string) => {
    const u = new URL(uriDoPostgres(container));
    u.username = user;
    u.password = password;
    u.pathname = '/nutri';
    return u.toString();
  };
  ownerUrl = url('nutri_owner', 'owner-pw');
  appUrl = url('nutri_app', 'app-pw');
  await runMigrations({ migratorUrl: ownerUrl, appUrl });
  owner = new Pool({ connectionString: ownerUrl, max: 1 });
  app = new Pool({ connectionString: appUrl, max: 1 });
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await container?.stop();
});

describe('migrations com migrator sem superusuário (runbook da Tarefa 13)', () => {
  it('o migrator não é superusuário e é dono do banco', async () => {
    const { rows } = await owner.query(
      `select r.rolsuper, pg_get_userbyid(d.datdba) as dono from pg_roles r, pg_database d
        where r.rolname = current_user and d.datname = current_database()`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, dono: 'nutri_owner' });
  });

  it('instala as extensões e cria o role da aplicação sem privilégios perigosos', async () => {
    const ext = await owner.query(
      `select extname from pg_extension where extname in ('citext','pg_trgm','unaccent','btree_gist') order by 1`,
    );
    expect(ext.rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext', 'pg_trgm', 'unaccent']);
    const { rows } = await owner.query(
      `select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'nutri_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  });

  it('a aplicação conecta, lê as tabelas e é dona do schema do pg-boss', async () => {
    const who = await app.query(`select current_user as u, pg_has_role(current_user, 'nutri_app_role', 'member') as m`);
    expect(who.rows[0]).toEqual({ u: 'nutri_app', m: true });
    await expect(app.query('select count(*) from "user"')).resolves.toBeTruthy();
    const schema = await owner.query(`select pg_get_userbyid(nspowner) as dono from pg_namespace where nspname = 'pgboss'`);
    expect(schema.rows[0]).toEqual({ dono: 'nutri_app' });
  });

  it('o role da aplicação não cria tabela temporária: TEMPORARY revogado de PUBLIC (M5)', async () => {
    const priv = await owner.query(`select has_database_privilege('nutri_app', current_database(), 'TEMPORARY') as temp`);
    expect(priv.rows[0]).toEqual({ temp: false });
    await expect(app.query('create temp table desvio (i int)')).rejects.toThrow(/permission denied/);
  });

  it('REVOKE TEMPORARY sem efeito (migrator deixou de ser dono do banco) falha com mensagem clara, sem segredo (G6)', async () => {
    const su = new Pool({ connectionString: uriDoPostgres(container), max: 1 });
    try {
      // Cenário do achado: outro role é dono do banco (o migrator só tem CREATE, que as migrations
      // exigem) e PUBLIC tem TEMP; o REVOKE do migrator só gera WARNING
      await su.query('ALTER DATABASE nutri OWNER TO CURRENT_USER');
      await su.query('GRANT CREATE ON DATABASE nutri TO nutri_owner');
      await su.query('GRANT TEMPORARY ON DATABASE nutri TO PUBLIC');
      const erro = await runMigrations({ migratorUrl: ownerUrl, appUrl }).then(
        () => null,
        (e: Error) => e,
      );
      expect(erro?.message).toMatch(/nutri_app ainda pode criar tabela temporária no banco nutri/);
      expect(erro?.message).toMatch(/pertencer ao migrator/);
      expect(erro?.message).not.toMatch(/app-pw|owner-pw/);
    } finally {
      await su.query('REVOKE TEMPORARY ON DATABASE nutri FROM PUBLIC');
      await su.query('REVOKE CREATE ON DATABASE nutri FROM nutri_owner');
      await su.query('ALTER DATABASE nutri OWNER TO nutri_owner');
      await su.end();
    }
    // de volta ao runbook: roda de novo sem erro e o role da aplicação segue sem TEMP
    await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).resolves.toBeUndefined();
    const priv = await owner.query(`select has_database_privilege('nutri_app', current_database(), 'TEMPORARY') as temp`);
    expect(priv.rows[0]).toEqual({ temp: false });
  });

  it('TEMPORARY concedido direto ao role da aplicação também faz a migração parar (G6)', async () => {
    const su = new Pool({ connectionString: uriDoPostgres(container), max: 1 });
    try {
      await su.query('GRANT TEMPORARY ON DATABASE nutri TO nutri_app');
      await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).rejects.toThrow(/nutri_app ainda pode criar tabela temporária/);
    } finally {
      await su.query('REVOKE TEMPORARY ON DATABASE nutri FROM nutri_app');
      await su.end();
    }
  });

  it('rodar de novo com o mesmo migrator é seguro (sincroniza a senha sem exigir superusuário)', async () => {
    await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).resolves.toBeUndefined();
  });

  it('recusa seguir se o role da aplicação ganhou atributo perigoso (o migrator não pode removê-lo)', async () => {
    const su = new Pool({ connectionString: uriDoPostgres(container), max: 1 });
    try {
      await su.query('ALTER ROLE nutri_app CREATEDB');
      await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).rejects.toThrow(/CREATEDB/);
    } finally {
      await su.query('ALTER ROLE nutri_app NOCREATEDB');
      await su.end();
    }
  });

  it('P09-02 (a): app_versao_do_schema() funciona com o migrator sem superusuário (dono do schema drizzle)', async () => {
    const { rows } = await app.query('select app_versao_do_schema() as v');
    const { rows: dono } = await owner.query('select max(created_at)::bigint as v from drizzle.__drizzle_migrations');
    expect(Number(rows[0].v)).toBe(Number(dono[0].v));
  });

  it('métricas do admin: a função SECURITY DEFINER conta por tenant sob FORCE RLS (dono sem superusuário)', async () => {
    const c = await app.connect();
    try {
      const a = (await c.query(`insert into tenants (slug, nome_exibicao) values ('met-a', 'A') returning id`)).rows[0].id as string;
      const b = (await c.query(`insert into tenants (slug, nome_exibicao) values ('met-b', 'B') returning id`)).rows[0].id as string;
      for (const [t, n] of [[a, 2], [b, 1]] as const) {
        await c.query('begin');
        await c.query(`select set_config('app.tenant_id', $1, true)`, [t]);
        for (let i = 0; i < n; i++) {
          await c.query(`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values ($1, 'logo', $2, 10, 'image/png')`, [t, `${t}/logo/${crypto.randomUUID()}.png`]);
        }
        if (t === a) {
          await c.query(`insert into patients (tenant_id, nome, data_nascimento, sexo, email, status) values ($1, 'Ativo', '1990-01-01', 'F', 'ativo@met.dev', 'ativo'), ($1, 'Arquivado', '1990-01-01', 'M', 'arq@met.dev', 'arquivado')`, [t]);
        }
        await c.query('commit');
      }
      const { rows } = await c.query(`select tenant_id, arquivos::int as arquivos, pacientes_ativos from admin_tenant_metrics() where tenant_id = any($1)`, [[a, b]]);
      expect(Object.fromEntries(rows.map((r) => [r.tenant_id, r.arquivos]))).toEqual({ [a]: 2, [b]: 1 });
      expect(Object.fromEntries(rows.map((r) => [r.tenant_id, Number(r.pacientes_ativos)]))).toEqual({ [a]: 1, [b]: 0 });
      // fora da função, sem contexto, o role da aplicação não vê nada
      expect((await c.query('select count(*)::int as n from stored_files')).rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it('métricas de sucesso do admin (0087, D15): a função SECURITY DEFINER conta por tenant sob FORCE RLS (dono sem superusuário)', async () => {
    const c = await app.connect();
    try {
      const a = (await c.query(`insert into tenants (slug, nome_exibicao) values ('cs-a', 'A') returning id`)).rows[0].id as string;
      const b = (await c.query(`insert into tenants (slug, nome_exibicao) values ('cs-b', 'B') returning id`)).rows[0].id as string;
      const conta = (await c.query(`insert into "user" (name, email, app_role) values ('Ana', 'ana@cs.dev', 'paciente') returning id`)).rows[0].id as string;
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [a]);
      const [comConta] = (
        await c.query(
          `insert into patients (tenant_id, nome, data_nascimento, sexo, email, status, user_id) values ($1, 'Com conta', '1990-01-01', 'F', 'ana@cs.dev', 'ativo', $2), ($1, 'Sem conta', '1990-01-01', 'M', 'sem@cs.dev', 'ativo', null) returning id`,
          [a, conta],
        )
      ).rows.map((r) => r.id as string);
      await c.query(`insert into access_events (tenant_id, patient_id, dia) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date)`, [a, comConta]);
      // já começou e é deste mês no fuso do tenant (no 1º minuto do mês, o próprio início do mês)
      await c.query(
        `insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status)
         select $1, $2, i, i + interval '30 minutes', 'presencial', 'nutri', 'faltou'
           from (select greatest(now() - interval '1 minute', date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as i) x`,
        [a, comConta],
      );
      await c.query('commit');
      const { rows } = await c.query(
        `select tenant_id, pacientes_com_conta::int as com_conta, abriram_7_dias::int as abriram, faltas_mes::int as faltas, iniciadas_mes::int as iniciadas
           from admin_metricas_sucesso() where tenant_id = any($1)`,
        [[a, b]],
      );
      expect(Object.fromEntries(rows.map(({ tenant_id, ...r }) => [tenant_id, r]))).toEqual({
        [a]: { com_conta: 1, abriram: 1, faltas: 1, iniciadas: 1 },
        [b]: { com_conta: 0, abriram: 0, faltas: 0, iniciadas: 0 },
      });
      // fora da função, sem contexto, o role da aplicação não vê nada
      expect((await c.query('select count(*)::int as n from access_events')).rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it('aceites na anonimização (0065): a função SECURITY DEFINER do migrator sem superusuário limpa o IP sob FORCE RLS; recusa paciente não bloqueado', async () => {
    const c = await app.connect();
    const emWorker = async (t: string) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [t]);
    };
    try {
      const t = (await c.query(`insert into tenants (slug, nome_exibicao) values ('anon-aceites', 'A') returning id`)).rows[0].id as string;
      await emWorker(t);
      const [bloqueada, ativa] = (
        await c.query(
          `insert into patients (tenant_id, nome, data_nascimento, sexo, email, status, bloqueado_em, anonimizar_apos)
           values ($1, 'Bloqueada', '1990-01-01', 'F', 'bloq@anon.dev', 'bloqueado', now(), '2026-01-01'),
                  ($1, 'Ativa', '1990-01-01', 'F', 'ativa@anon.dev', 'ativo', null, null) returning id`,
          [t],
        )
      ).rows.map((r) => r.id as string);
      await c.query('commit');
      await c.query(
        `insert into consents (tenant_id, patient_id, termo_versao, aceito_em, ip) values ($1, $2, 'termo-v1', '2026-01-01T12:00:00Z', '198.51.100.7'), ($1, $3, 'termo-v1', '2026-01-02T12:00:00Z', '198.51.100.8')`,
        [t, bloqueada, ativa],
      );
      await emWorker(t);
      await c.query('select app_anonimizar_aceites($1)', [bloqueada]);
      await c.query('commit');
      const { rows } = await c.query(`select patient_id, termo_versao, aceito_em, ip from consents where tenant_id = $1 order by aceito_em`, [t]);
      expect(rows.map((r) => [r.patient_id, r.termo_versao, (r.aceito_em as Date).toISOString(), r.ip])).toEqual([
        [bloqueada, 'termo-v1', '2026-01-01T12:00:00.000Z', null],
        [ativa, 'termo-v1', '2026-01-02T12:00:00.000Z', '198.51.100.8'],
      ]);
      await emWorker(t);
      await expect(c.query('select app_anonimizar_aceites($1)', [ativa])).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  // B-3: as duas SECURITY DEFINER do Plano 06 (e a da audiência por etiqueta do Plano 07, 0083) trocam o contexto
  // (set_config) para passar pela RLS FORCE. Com o dono superusuário da suíte principal a RLS nem vale para elas; só
  // aqui (dono sem superusuário, como em produção) uma troca de contexto errada aparece.
  describe('SECURITY DEFINER dos Planos 06 e 07 sob FORCE RLS (dono sem superusuário)', () => {
    const P256 = 'B'.repeat(87);
    const AUTH = 'a'.repeat(22);
    const contexto = async (c: PoolClient) =>
      (
        await c.query(
          `select current_setting('app.tenant_id', true) as tenant, current_setting('app.role', true) as role,
                  current_setting('app.patient_id', true) as patient, current_setting('app.user_id', true) as usuario`,
        )
      ).rows[0];
    const emWorker = async (c: PoolClient, t: string) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [t]);
    };
    const novoTenant = async (c: PoolClient, slug: string) =>
      (await c.query(`insert into tenants (slug, nome_exibicao) values ($1, 'X') returning id`, [slug])).rows[0].id as string;
    const novaConta = async (c: PoolClient, email: string) =>
      (await c.query(`insert into "user" (name, email, app_role) values ('Conta', $1, 'paciente') returning id`, [email])).rows[0].id as string;
    /** Prontuário (contexto worker do tenant) ligado à conta. */
    const novoPaciente = async (c: PoolClient, t: string, u: string, status = 'ativo') => {
      await emWorker(c, t);
      const id = (
        await c.query(
          `insert into patients (tenant_id, user_id, nome, data_nascimento, sexo, email, status) values ($1, $2, 'P', '1990-01-01', 'F', 'p@sd.dev', $3) returning id`,
          [t, u, status],
        )
      ).rows[0].id as string;
      await c.query('commit');
      return id;
    };

    it('app_soltar_endpoint_push tira o endpoint da outra conta em outro tenant, mantém o da própria e devolve o contexto', async () => {
      const c = await app.connect();
      try {
        const A = await novoTenant(c, 'push-a');
        const B = await novoTenant(c, 'push-b');
        const uA = await novaConta(c, 'push-a@sd.dev');
        const uB = await novaConta(c, 'push-b@sd.dev');
        const pA = await novoPaciente(c, A, uA);
        const pB = await novoPaciente(c, B, uB);
        const E = 'https://push.example/compartilhado';
        const F = 'https://push.example/outro-aparelho';
        const inscrever = async (t: string, p: string, endpoint: string) => {
          await emWorker(c, t);
          await c.query(`insert into push_subscriptions (tenant_id, patient_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)`, [t, p, endpoint, P256, AUTH]);
          await c.query('commit');
        };
        await inscrever(A, pA, E);
        await inscrever(B, pB, E);
        await inscrever(B, pB, F);

        await c.query('begin');
        await c.query(
          `select set_config('app.tenant_id', $1, true), set_config('app.role', 'paciente', true),
                  set_config('app.patient_id', $2, true), set_config('app.user_id', $3, true)`,
          [A, pA, uA],
        );
        expect((await c.query('select app_soltar_endpoint_push($1) as da_conta', [E])).rows[0].da_conta).toBe(true);
        expect((await c.query('select app_soltar_endpoint_push($1) as da_conta', ['https://push.example/nenhum'])).rows[0].da_conta).toBe(false);
        expect(await contexto(c)).toEqual({ tenant: A, role: 'paciente', patient: pA, usuario: uA });
        await c.query('commit');

        const endpoints = async (t: string) => {
          await emWorker(c, t);
          const r = (await c.query(`select endpoint from push_subscriptions where tenant_id = $1 order by endpoint`, [t])).rows.map((x) => x.endpoint);
          await c.query('commit');
          return r;
        };
        expect(await endpoints(A)).toEqual([E]);
        expect(await endpoints(B)).toEqual([F]);
      } finally {
        await c.query('rollback').catch(() => undefined);
        c.release();
      }
    });

    it('app_conta_sem_outro_vinculo enxerga o vínculo da conta em outro tenant (contexto conta) e devolve o contexto', async () => {
      const c = await app.connect();
      try {
        const A = await novoTenant(c, 'vinc-a');
        const B = await novoTenant(c, 'vinc-b');
        const u = await novaConta(c, 'vinc@sd.dev');
        const ator = await novaConta(c, 'ator-vinc@sd.dev');
        const pA = await novoPaciente(c, A, u, 'bloqueado');
        const pB = await novoPaciente(c, B, u);
        /** Como a anonimização: solta a conta do prontuário de A e confere, na mesma transação (contexto worker de A). */
        const sozinha = async () => {
          await emWorker(c, A);
          await c.query(`select set_config('app.user_id', $1, true)`, [ator]);
          await c.query(`update patients set user_id = null, anonimizado_em = now() where id = $1`, [pA]);
          const r = (await c.query('select app_conta_sem_outro_vinculo($1) as sozinha', [u])).rows[0].sozinha as boolean;
          expect(await contexto(c)).toEqual({ tenant: A, role: 'worker', patient: '', usuario: ator });
          await c.query('rollback');
          return r;
        };
        expect(await sozinha()).toBe(false); // o prontuário de B, ainda não anonimizado, segura a conta
        await emWorker(c, B);
        await c.query(`update patients set anonimizado_em = now() where id = $1`, [pB]);
        await c.query('commit');
        expect(await sozinha()).toBe(true);
      } finally {
        await c.query('rollback').catch(() => undefined);
        c.release();
      }
    });

    it('audiência por etiqueta (0083): a função SECURITY DEFINER do migrator sem superusuário enxerga patient_tag_links sob FORCE RLS e devolve o contexto do paciente', async () => {
      const c = await app.connect();
      const comoPaciente = async (t: string, p: string) => {
        await c.query('begin');
        await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'paciente', true), set_config('app.patient_id', $2, true)`, [t, p]);
      };
      try {
        const t = await novoTenant(c, 'aud-etiqueta');
        await emWorker(c, t);
        const [ana, bia] = (
          await c.query(
            `insert into patients (tenant_id, nome, data_nascimento, sexo, email, status)
             values ($1, 'Ana', '1990-01-01', 'F', 'ana@aud.dev', 'ativo'), ($1, 'Bia', '1990-01-01', 'F', 'bia@aud.dev', 'ativo') returning id`,
            [t],
          )
        ).rows.map((r) => r.id as string);
        const tag = (await c.query(`insert into patient_tags (tenant_id, nome) values ($1, 'gestante') returning id`, [t])).rows[0].id as string;
        await c.query(`insert into patient_tag_links (tenant_id, patient_id, tag_id) values ($1, $2, $3)`, [t, ana, tag]);
        const conteudo = (
          await c.query(
            `insert into contents (tenant_id, tipo, titulo, visibilidade, status, publicado_em) values ($1, 'orientacao', 'Para gestantes', 'etiquetas', 'publicado', now()) returning id`,
            [t],
          )
        ).rows[0].id as string;
        await c.query(`insert into content_audience (tenant_id, content_id, tag_id) values ($1, $2, $3)`, [t, conteudo, tag]);
        await c.query('commit');

        await comoPaciente(t, ana);
        expect((await c.query('select count(*)::int as n from contents')).rows[0].n).toBe(1);
        const ctxDepois = await c.query(`select current_setting('app.role') as papel, current_setting('app.patient_id') as paciente`);
        expect(ctxDepois.rows[0]).toEqual({ papel: 'paciente', paciente: ana });
        // a sessão de paciente continua sem ver a etiqueta (staff_only)
        expect((await c.query('select count(*)::int as n from patient_tag_links')).rows[0].n).toBe(0);
        await c.query('rollback');

        await comoPaciente(t, bia);
        expect((await c.query('select count(*)::int as n from contents')).rows[0].n).toBe(0);
        await c.query('rollback');
      } finally {
        await c.query('rollback').catch(() => undefined);
        c.release();
      }
    });
  });

  // Plano 15 (P15-02): as funções SECURITY DEFINER da 0117 trocam o papel para worker e passam pela RLS FORCE; só aqui
  // (dono sem superusuário, como em produção) uma troca de contexto errada aparece.
  it('Plano 15: a IA Nutri nasce NÃO pausada e as funções da 0117 rodam pelo app com o migrator sem superusuário', async () => {
    const pausa = await owner.query(`select pausada_em, pausada_por from ia_nutri_pausa`);
    expect(pausa.rows).toEqual([{ pausada_em: null, pausada_por: null }]); // DP-1 / ★ DO-1 = não: a pausa é só de emergência
    const { rows } = await owner.query(
      `select p.proname, pg_get_userbyid(p.proowner) as dono, p.prosecdef from pg_proc p
        where p.proname in ('app_ia_nutri_perguntar','app_ia_nutri_enviar_a_nutri','app_ia_nutri_revogar','app_anonimizar_consentimentos_ia_nutri','admin_metricas_ia_nutri') order by 1`,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.dono === 'nutri_owner' && r.prosecdef)).toBe(true);
    // a função de métricas roda pelo login do app (lê ia_uso e ia_nutri_mensagens com a RLS forçada)
    await expect(app.query('select * from admin_metricas_ia_nutri()')).resolves.toBeTruthy();
  });

  it('Plano 15: perguntar, enviar à nutricionista, revogar e anonimizar o consentimento sob FORCE RLS, com o dono sem superusuário', async () => {
    const c = await app.connect();
    const conta = '00000000-0000-4000-8000-0000000000c1';
    const nutri = '00000000-0000-4000-8000-0000000000a1';
    const ctx = async (t: string, role: string, o: { patient?: string; user?: string } = {}) => {
      await c.query('begin');
      await c.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.patient_id', $3, true), set_config('app.user_id', $4, true)`,
        [t, role, o.patient ?? '', o.user ?? ''],
      );
    };
    try {
      const t = (await c.query(`insert into tenants (slug, nome_exibicao) values ('ia-nutri-dono', 'N') returning id`)).rows[0].id as string;
      await ctx(t, 'worker');
      const p = (await c.query(`insert into patients (tenant_id, nome, data_nascimento, sexo, email) values ($1, 'Pac', '1990-01-01', 'F', 'pac@ia-nutri.dev') returning id`, [t])).rows[0].id as string;
      await c.query(`insert into ia_nutri_participacoes (tenant_id, patient_id, liberada_em, liberada_por) values ($1, $2, now(), $3)`, [t, p, nutri]);
      await c.query('commit');
      await ctx(t, 'paciente', { patient: p, user: conta });
      await c.query(`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, versao, destino, canal, registrado_por, ip) values ($1, $2, 'aceite', '1.0', 'teste', 'app', $3, '198.51.100.9')`, [t, p, conta]);
      // sem plano publicado: a função lê paciente, participação, consentimento, mensagens e meal_plans sob a RLS forçada
      expect((await c.query(`select codigo from app_ia_nutri_perguntar('oi', null, null, '1.0', 'teste')`)).rows[0].codigo).toBe('sem_plano');
      // o ramo de risco grava (INSERT sob a RLS forçada, como worker) e o papel volta
      expect((await c.query(`select codigo from app_ia_nutri_perguntar('quero sumir', 'emergencia', 'risco_emergencia', '1.0', 'teste')`)).rows[0].codigo).toBe('risco');
      expect((await c.query(`select codigo from app_ia_nutri_enviar_a_nutri('Posso trocar o jantar?', '1.0', 'teste')`)).rows[0].codigo).toBe('encaminhada');
      expect((await c.query(`select current_setting('app.role', true) as r, current_setting('app.patient_id', true) as p`)).rows[0]).toEqual({ r: 'paciente', p });
      expect((await c.query(`select revogacao_id from app_ia_nutri_revogar('198.51.100.9', 'teste')`)).rows[0].revogacao_id).not.toBeNull();
      await c.query('commit');
      await ctx(t, 'worker');
      // as três mensagens (pergunta com risco, texto fixo e a dúvida enviada direto) passaram pela revogação sob a RLS forçada
      const { rows: ms } = await c.query(`select autor, texto is not null as com_texto, revogada_em is not null as rev from ia_nutri_mensagens where patient_id = $1 order by created_at, autor`, [p]);
      expect(ms).toEqual([
        { autor: 'paciente', com_texto: true, rev: true }, // D22: a pergunta com risco não aberta fica com o texto
        { autor: 'sistema', com_texto: false, rev: true },
        { autor: 'paciente', com_texto: false, rev: true },
      ]);
      await c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2026-01-01' where id = $1`, [p]);
      await c.query('select app_anonimizar_consentimentos_ia_nutri($1)', [p]);
      const { rows: cs } = await c.query(`select evento, ip, registrado_por from ia_nutri_consentimentos where patient_id = $1 order by registrado_em`, [p]);
      expect(cs).toEqual([{ evento: 'aceite', ip: null, registrado_por: null }, { evento: 'revogacao', ip: null, registrado_por: null }]);
      await c.query('commit');
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('Plano 20: o app executa app_anonimizar_financeiro sob FORCE RLS com o dono sem superusuário; DELETE em fin_lancamentos e fin_configuracoes → 42501', async () => {
    const c = await app.connect();
    const nutri = '00000000-0000-4000-8000-0000000000f1';
    const ctx = async (t: string, role: string, user = '') => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.user_id', $3, true)`, [t, role, user]);
    };
    try {
      const t = (await c.query(`insert into tenants (slug, nome_exibicao) values ('fin-dono', 'F') returning id`)).rows[0].id as string;
      await ctx(t, 'worker');
      const p = (await c.query(`insert into patients (tenant_id, nome, data_nascimento, sexo, email) values ($1, 'Pac', '1990-01-01', 'F', 'pac@fin.dev') returning id`, [t])).rows[0].id as string;
      await c.query(`insert into fin_configuracoes (tenant_id, saldo_inicial_centavos, saldo_inicial_em) values ($1, 0, '2026-11-01')`, [t]);
      const cat = (await c.query(`insert into fin_categorias (tenant_id, tipo, nome) values ($1, 'entrada', 'Outras entradas') returning id`, [t])).rows[0].id as string;
      await c.query('commit');
      await ctx(t, 'nutri', nutri);
      const l = (await c.query(
        `insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, patient_id, descricao, criado_por) values ($1, 'entrada', $2, 100, '2026-11-10', $3, 'Retorno', $4) returning id`,
        [t, cat, p, nutri],
      )).rows[0].id as string;
      await c.query('commit');
      for (const tabela of ['fin_lancamentos', 'fin_configuracoes']) {
        await ctx(t, 'nutri', nutri);
        await expect(c.query(`delete from ${tabela}`)).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback');
      }
      await ctx(t, 'worker');
      await c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2026-01-01' where id = $1`, [p]);
      await c.query('select app_anonimizar_financeiro($1)', [p]);
      const { rows } = await c.query(`select descricao, anonimizado_em is not null as anon, cancelado_em is not null as cancelado, cancelado_por from fin_lancamentos where id = $1`, [l]);
      expect(rows).toEqual([{ descricao: null, anon: true, cancelado: true, cancelado_por: null }]);
      await c.query('commit');
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  // JUR-01 (dono, 09/10/2026; Res. CFN 594/2017, art. 3º, VI, "b"): o prazo de guarda conta do último registro do
  // prontuário — no pedido de exclusão, o próprio bloqueio. A 0110 recalcula quem já está bloqueado: data do bloqueio no
  // fuso do tenant + 20 anos, só para mais (GREATEST), com o gatilho de auditoria ligado, sob FORCE RLS (dono sem
  // superusuário, como em produção). Roda por último neste arquivo: a migration de novo pega todos os tenants do cluster.
  it('prazo de guarda do bloqueio (0110): recalcula os bloqueados de dois consultórios no fuso de cada um, nunca antecipa e audita', async () => {
    const MIGRATION = readFileSync(new URL('../../drizzle/0110_prazo_guarda_bloqueio.sql', import.meta.url), 'utf8');
    const c = await app.connect();
    const emTenant = async (t: string) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [t]);
    };
    const migrar = async () => {
      const o = await owner.connect();
      try {
        await o.query('begin');
        for (const st of MIGRATION.split('--> statement-breakpoint')) if (st.trim()) await o.query(st);
        await o.query('commit');
      } finally {
        await o.query('rollback').catch(() => undefined);
        o.release();
      }
    };
    try {
      const a = (await c.query(`insert into tenants (slug, nome_exibicao) values ('jur01-a', 'A') returning id`)).rows[0].id as string;
      const b = (await c.query(`insert into tenants (slug, nome_exibicao, fuso) values ('jur01-b', 'B', 'Asia/Tokyo') returning id`)).rows[0].id as string;
      const ids: Record<string, string> = {};
      const inserir = async (t: string, nome: string, status: string, bloqueadoEm: string | null, anonimizarApos: string | null, anonimizadoEm: string | null = null) => {
        ids[nome] = (
          await c.query(
            `insert into patients (tenant_id, nome, data_nascimento, sexo, email, status, bloqueado_em, anonimizar_apos, anonimizado_em)
             values ($1, $2, '1990-01-01', 'F', $3, $4, $5, $6, $7) returning id`,
            [t, nome, `${nome}@jur01.dev`, status, bloqueadoEm, anonimizarApos, anonimizadoEm],
          )
        ).rows[0].id as string;
      };
      await emTenant(a);
      await inserir(a, 'a1', 'bloqueado', '2026-10-05T12:00:00Z', '2045-03-10'); // antes: última consulta 10/03/2025 + 20
      await inserir(a, 'a2', 'bloqueado', '2026-10-02T01:30:00Z', '2046-01-01'); // 22h30 de 01/10 em São Paulo
      await inserir(a, 'a3', 'bloqueado', '2026-10-05T12:00:00Z', '2050-01-01'); // já depois: GREATEST mantém
      await inserir(a, 'a4', 'bloqueado', '2006-01-01T12:00:00Z', '2026-01-01', '2026-01-02T03:00:00Z'); // já anonimizado
      await inserir(a, 'a5', 'ativo', null, null);
      await inserir(a, 'a6', 'bloqueado', null, '2040-01-01'); // sem bloqueado_em: data do pedido de exclusão atendido
      await inserir(a, 'a7', 'bloqueado', null, '2040-01-01'); // sem data nenhuma: não mexe
      await inserir(a, 'a8', 'bloqueado', '2026-10-05T12:00:00Z', null); // sem prazo: não cria um
      await c.query(
        `insert into privacy_requests (tenant_id, patient_id, tipo, status, prazo, concluido_em) values
           ($1, $2, 'exclusao', 'concluido', '2026-10-05', '2026-09-20T15:00:00Z'),
           ($1, $2, 'exportacao', 'concluido', '2026-10-10', '2026-09-25T15:00:00Z'),
           ($1, $3, 'exclusao', 'aberto', '2026-10-20', null)`,
        [a, ids.a6, ids.a7],
      );
      await c.query('commit');
      await emTenant(b);
      await inserir(b, 'b1', 'bloqueado', '2026-10-05T16:00:00Z', '2045-01-01'); // 01h de 06/10 em Tóquio
      await inserir(b, 'b2', 'bloqueado', '2026-10-05T16:00:00Z', '2047-01-01');
      await c.query('commit');

      await migrar();
      await migrar(); // de novo: nada muda (só para mais)

      const ler = async (t: string) => {
        await emTenant(t);
        const p = await c.query(`select nome, anonimizar_apos::text as apos from patients where tenant_id = $1`, [t]);
        const log = await c.query(
          `select p.nome, l.actor_user_id from audit_log l join patients p on p.id = l.patient_id
            where l.tenant_id = $1 and l.entidade = 'patients' and l.acao = 'alterar' order by p.nome`,
          [t],
        );
        await c.query('commit');
        return { prazos: Object.fromEntries(p.rows.map((r) => [r.nome, r.apos])), alterados: log.rows };
      };
      const ra = await ler(a);
      expect(ra.prazos).toEqual({
        a1: '2046-10-05',
        a2: '2046-10-01',
        a3: '2050-01-01',
        a4: '2026-01-01',
        a5: null,
        a6: '2046-09-20',
        a7: '2040-01-01',
        a8: null,
      });
      // gatilho de auditoria ligado: uma linha "alterar" (ator nulo = Sistema) por paciente que mudou, só na 1ª vez
      expect(ra.alterados).toEqual([
        { nome: 'a1', actor_user_id: null },
        { nome: 'a2', actor_user_id: null },
        { nome: 'a6', actor_user_id: null },
      ]);
      const rb = await ler(b);
      expect(rb.prazos).toEqual({ b1: '2046-10-06', b2: '2047-01-01' });
      expect(rb.alterados).toEqual([{ nome: 'b1', actor_user_id: null }]);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });
});

// Plano 25 (spec §9.7 v0.3, CH-D59, CH-D70; Review Focus 2): as três funções SECURITY DEFINER do chat com o dono SEM
// superusuário e NOBYPASSRLS, como em produção — a RLS (FORCE) vale também dentro delas, então a troca de papel para o
// worker e o contexto restaurado são o que as faz funcionar. A custom é achada pelo sufixo (o número muda no §5).
describe('Plano 25: peças SECURITY DEFINER com dono NOBYPASSRLS', () => {
  const ARQUIVO = readdirSync(new URL('../../drizzle/', import.meta.url)).find((f) => f.endsWith('_rls_mensagens.sql'));
  const FUNCOES = ['app_chat_apagar_do_titular', 'app_chat_aviso_nutri_devido', 'app_chat_soltar_anexo'];
  const NUTRI = '00000000-0000-4000-8000-0000000025a1';
  let c: PoolClient;
  let seq = 0;
  beforeAll(async () => {
    c = await app.connect();
  });
  afterAll(async () => {
    await c?.query('rollback').catch(() => undefined);
    c?.release();
  });

  const ctx = async (t: string, role: string, o: { patient?: string; user?: string } = {}) => {
    await c.query('begin');
    await c.query(
      `select set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.patient_id', $3, true), set_config('app.user_id', $4, true)`,
      [t, role, o.patient ?? '', o.user ?? ''],
    );
  };
  const fim = () => c.query('commit');
  /** Roda num SAVEPOINT e devolve o erro (ou null): a transação segue para as conferências seguintes. */
  const tenta = async (q: string, params: unknown[] = []) => {
    await c.query('savepoint p25');
    try {
      await c.query(q, params);
      await c.query('release savepoint p25');
      return null;
    } catch (e) {
      await c.query('rollback to savepoint p25');
      return e as { code?: string; message?: string };
    }
  };
  const marcador = async () => (await c.query(`select coalesce(current_setting('app.chat_soltando', true), '') as m`)).rows[0].m as string;
  const contexto = async () =>
    (await c.query(`select current_setting('app.role', true) as r, current_setting('app.patient_id', true) as p, current_setting('app.user_id', true) as u`)).rows[0];

  type Cenario = { t: string; p1: string; p2: string; contas: Record<string, string> };
  async function cenario(fuso = 'America/Sao_Paulo'): Promise<Cenario> {
    const n = ++seq;
    const t = (
      await c.query(`insert into tenants (slug, nome_exibicao, nome_profissional, crn, fuso) values ($1, 'Chat', 'Débora Nutricionista', 'CRN-3 25025', $2) returning id`, [
        `chat-dono-${n}-${randomUUID().slice(0, 6)}`,
        fuso,
      ])
    ).rows[0].id as string;
    await ctx(t, 'worker');
    const novo = async (nome: string) =>
      (await c.query(`insert into patients (tenant_id, nome, data_nascimento, sexo, email) values ($1, $2, '1990-01-01', 'F', $3) returning id`, [t, nome, `${nome}-${n}@chat.dev`]))
        .rows[0].id as string;
    const p1 = await novo('p1');
    const p2 = await novo('p2');
    await fim();
    await ctx(t, 'nutri', { user: NUTRI });
    for (const p of [p1, p2]) {
      await c.query(`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma) values ($1, $2, now(), $3, 'aceite_escrito')`, [t, p, NUTRI]);
      await c.query(`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto) values ($1, $2, 'nutri', $3, 'Olá')`, [t, p, NUTRI]);
      await c.query(`insert into chat_leituras (tenant_id, patient_id, lado, lida_ate) values ($1, $2, 'consultorio', now())`, [t, p]);
    }
    await fim();
    return { t, p1, p2, contas: { [p1]: randomUUID(), [p2]: randomUUID() } };
  }
  /** O paciente envia uma foto (processando, com o original dele). */
  const foto = async (S: Cenario, p: string) => {
    await ctx(S.t, 'paciente', { patient: p, user: S.contas[p] });
    const orig = `${S.t}/chat_anexo_original/${randomUUID()}.jpg`;
    await c.query(`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values ($1, $2, 'chat_anexo_original', $3, 10, 'image/jpeg')`, [S.t, p, orig]);
    const id = (
      await c.query(
        `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, anexo_status, anexo_tipo, anexo_original_path) values ($1, $2, 'paciente', $3, 'processando', 'imagem', $4) returning id`,
        [S.t, p, S.contas[p], orig],
      )
    ).rows[0].id as string;
    await fim();
    return { id, orig };
  };
  /** O worker conclui a conversão: processando → pronto com o chat_anexo do mesmo paciente. */
  const concluir = async (S: Cenario, p: string, id: string) => {
    await ctx(S.t, 'worker');
    const path = `${S.t}/chat_anexo/${randomUUID()}.jpg`;
    await c.query(`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values ($1, $2, 'chat_anexo', $3, 10, 'image/jpeg')`, [S.t, p, path]);
    await c.query(`update chat_mensagens set anexo_status = 'pronto', anexo_path = $2, updated_at = now() where id = $1`, [id, path]);
    await fim();
    return path;
  };
  const mensagem = async (id: string) =>
    (await c.query(`select anexo_status, anexo_path, anexo_original_path from chat_mensagens where id = $1`, [id])).rows[0] as Record<string, unknown>;
  const contarDoTitular = async (t: string, p: string) => {
    await ctx(t, 'worker');
    const r: Record<string, number> = {};
    for (const tabela of ['chat_conversas', 'chat_mensagens', 'chat_leituras']) {
      r[tabela] = Number((await c.query(`select count(*)::int as n from ${tabela} where patient_id = $1`, [p])).rows[0].n);
    }
    await fim();
    return r;
  };

  it('as três estão na custom, são SECURITY DEFINER do dono sem superusuário, com search_path fixo, e o PUBLIC não executa', async () => {
    expect(ARQUIVO).toBeDefined();
    const sqlDaCustom = readFileSync(new URL(`../../drizzle/${ARQUIVO}`, import.meta.url), 'utf8');
    // as funções da custom: só as três são SECURITY DEFINER (as dos gatilhos, T1b, rodam com quem grava)
    const definidas = [...sqlDaCustom.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1]);
    const definer = await owner.query(`select proname as nome from pg_proc where proname = any($1) and prosecdef order by 1`, [definidas]);
    expect(definer.rows.map((r) => r.nome)).toEqual(FUNCOES);
    expect(definidas).toEqual(expect.arrayContaining(FUNCOES));
    const { rows } = await owner.query(
      `select p.proname as nome, p.prosecdef as definer, pg_get_userbyid(p.proowner) as dono, p.proconfig as config,
              exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publico,
              has_function_privilege('nutri_app', p.oid, 'EXECUTE') as app
         from pg_proc p where p.proname = any($1) order by 1`,
      [FUNCOES],
    );
    expect(rows).toEqual(FUNCOES.map((nome) => ({ nome, definer: true, dono: 'nutri_owner', config: ['search_path=public, pg_temp'], publico: false, app: true })));
  });

  it('app_chat_aviso_nutri_devido: cria a linha (aviso ligado), marca a janela de 2 h, respeita o horário e o aviso desligado; contexto restaurado', async () => {
    const S = await cenario();
    const conta = S.contas[S.p1];
    await ctx(S.t, 'paciente', { patient: S.p1, user: conta });
    const r1 = await c.query('select app_chat_aviso_nutri_devido(true) as devido');
    expect(r1.rows).toEqual([{ devido: true }]); // só o booleano: nenhuma coluna da tabela volta
    expect(await contexto()).toEqual({ r: 'paciente', p: S.p1, u: conta });
    expect((await c.query('select app_chat_aviso_nutri_devido(true) as devido')).rows[0].devido).toBe(false); // menos de 2 h
    expect(await contexto()).toEqual({ r: 'paciente', p: S.p1, u: conta });
    // a sessão de paciente não lê a linha que a função criou (staff_only, CH-D70)
    expect((await c.query('select 1 from chat_avisos_nutri')).rowCount).toBe(0);
    await fim();
    await ctx(S.t, 'nutri', { user: NUTRI });
    const linha = (await c.query('select aviso_email, aviso_nutri_em from chat_avisos_nutri where tenant_id = $1', [S.t])).rows;
    expect(linha).toHaveLength(1);
    expect(linha[0].aviso_email).toBe(true);
    expect(linha[0].aviso_nutri_em).not.toBeNull();
    await c.query(`update chat_avisos_nutri set aviso_nutri_em = now() - interval '3 hours' where tenant_id = $1`, [S.t]);
    await fim();
    await ctx(S.t, 'paciente', { patient: S.p2, user: S.contas[S.p2] });
    expect((await c.query('select app_chat_aviso_nutri_devido(false) as devido')).rows[0].devido).toBe(false); // fora do horário
    expect((await c.query('select app_chat_aviso_nutri_devido(null) as devido')).rows[0].devido).toBe(false);
    await fim();
    await ctx(S.t, 'nutri', { user: NUTRI });
    await c.query(`update chat_avisos_nutri set aviso_email = false where tenant_id = $1`, [S.t]);
    await fim();
    await ctx(S.t, 'paciente', { patient: S.p2, user: S.contas[S.p2] });
    expect((await c.query('select app_chat_aviso_nutri_devido(true) as devido')).rows[0].devido).toBe(false); // aviso desligado
    expect(await contexto()).toEqual({ r: 'paciente', p: S.p2, u: S.contas[S.p2] });
    await fim();
    await ctx(S.t, 'nutri', { user: NUTRI });
    await c.query(`update chat_avisos_nutri set aviso_email = true where tenant_id = $1`, [S.t]);
    await fim();
    await ctx(S.t, 'paciente', { patient: S.p2, user: S.contas[S.p2] });
    expect((await c.query('select app_chat_aviso_nutri_devido(true) as devido')).rows[0].devido).toBe(true); // passou das 2 h
    await fim();
  });

  it('app_chat_aviso_nutri_devido recusa (42501) nas sessões nutri, publico, worker e de paciente sem conta, sem tocar a marca', async () => {
    const S = await cenario();
    const marca = async () => {
      await ctx(S.t, 'worker');
      const r = (await c.query('select aviso_nutri_em from chat_avisos_nutri where tenant_id = $1', [S.t])).rows;
      await fim();
      return r;
    };
    for (const [role, o] of [
      ['nutri', { user: NUTRI }],
      ['publico', {}],
      ['worker', {}],
      ['paciente', { patient: S.p1 }],
    ] as const) {
      await ctx(S.t, role, o);
      const e = await tenta('select app_chat_aviso_nutri_devido(true)');
      expect(e?.code, role).toBe('42501');
      expect(await contexto(), role).toMatchObject({ r: role });
      await fim();
    }
    expect(await marca()).toEqual([]); // nem a linha nasceu
  });

  it('app_chat_soltar_anexo: só no worker, só o ponteiro atual; o original fora de processando; o anexo só sem original (CH-D59) e com o titular na anonimização; marcador sempre zerado', async () => {
    const S = await cenario();
    const m = await foto(S, S.p1);
    await ctx(S.t, 'nutri', { user: NUTRI });
    expect((await tenta('select app_chat_soltar_anexo($1, $2)', [m.id, m.orig]))?.code).toBe('42501'); // fora do worker
    await fim();
    await ctx(S.t, 'worker');
    expect((await tenta('select app_chat_soltar_anexo($1, $2)', [m.id, m.orig]))?.code).toBe('42501'); // em processando
    expect(await marcador()).toBe(''); // também depois de um erro capturado num SAVEPOINT
    expect((await tenta('select app_chat_soltar_anexo($1, $2)', [m.id, `${S.t}/chat_anexo_original/outro.jpg`]))?.code).toBe('42501'); // outro caminho
    expect((await tenta('select app_chat_soltar_anexo($1, null)', [m.id]))?.code).toBe('42501');
    await fim();
    const path = await concluir(S, S.p1, m.id);
    await ctx(S.t, 'worker');
    const e = await tenta('select app_chat_soltar_anexo($1, $2)', [m.id, path]); // CH-D59: ainda tem o original
    expect(e?.code).toBe('42501');
    expect(e?.message).toMatch(/solte antes o original/);
    await c.query('select app_chat_soltar_anexo($1, $2)', [m.id, m.orig]); // conversão concluída: o original sai
    expect(await marcador()).toBe('');
    expect(await mensagem(m.id)).toEqual({ anexo_status: 'pronto', anexo_path: path, anexo_original_path: null });
    expect((await tenta('select app_chat_soltar_anexo($1, $2)', [m.id, path]))?.code).toBe('42501'); // titular ativo
    expect(await marcador()).toBe('');
    await fim();

    // falhou: o original sai
    const f = await foto(S, S.p1);
    await ctx(S.t, 'worker');
    await c.query(`update chat_mensagens set anexo_status = 'falhou' where id = $1`, [f.id]);
    await c.query('select app_chat_soltar_anexo($1, $2)', [f.id, f.orig]);
    expect(await mensagem(f.id)).toEqual({ anexo_status: 'falhou', anexo_path: null, anexo_original_path: null });
    // anonimização: titular bloqueado com o prazo vencido — o anexo sai e a mensagem fica `removido`
    await c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2026-01-01' where id = $1`, [S.p1]);
    await c.query('select app_chat_soltar_anexo($1, $2)', [m.id, path]);
    expect(await marcador()).toBe('');
    expect(await mensagem(m.id)).toEqual({ anexo_status: 'removido', anexo_path: null, anexo_original_path: null });
    expect(await contexto()).toMatchObject({ r: 'worker' });
    await fim();
    // de outro consultório: a mensagem não existe para o worker deste
    const T = await cenario();
    const g = await foto(S, S.p2);
    await ctx(T.t, 'worker');
    expect((await tenta('select app_chat_soltar_anexo($1, $2)', [g.id, g.orig]))?.code).toBe('42501');
    await fim();
  });

  it('app_chat_apagar_do_titular: só no worker; recusa ativo, prazo no futuro e anexo apontado; apaga o bloqueado vencido e o já anonimizado, só no tenant da sessão', async () => {
    const S = await cenario();
    const O = await cenario(); // outro consultório, que não pode ser tocado
    await ctx(S.t, 'nutri', { user: NUTRI });
    expect((await tenta('select app_chat_apagar_do_titular($1)', [S.p1]))?.code).toBe('42501');
    await fim();
    await ctx(S.t, 'worker');
    expect((await tenta('select app_chat_apagar_do_titular($1)', [S.p1]))?.code).toBe('42501'); // ativo
    await c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = $1`, [S.p1]);
    expect((await tenta('select app_chat_apagar_do_titular($1)', [S.p1]))?.code).toBe('42501'); // prazo no futuro
    expect((await tenta('select app_chat_apagar_do_titular($1)', [O.p1]))?.code).toBe('42501'); // de outro tenant
    await c.query(`update patients set anonimizar_apos = '2026-01-01' where id = $1`, [S.p1]);
    await c.query('select app_chat_apagar_do_titular($1)', [S.p1]);
    await fim();
    expect(await contarDoTitular(S.t, S.p1)).toEqual({ chat_conversas: 0, chat_mensagens: 0, chat_leituras: 0 });
    expect(await contarDoTitular(S.t, S.p2)).toEqual({ chat_conversas: 1, chat_mensagens: 1, chat_leituras: 1 });
    expect(await contarDoTitular(O.t, O.p1)).toEqual({ chat_conversas: 1, chat_mensagens: 1, chat_leituras: 1 });

    // anexo ainda apontado → recusa; depois de soltar, apaga (titular já anonimizado: a rede de limpeza, RN-466)
    const m = await foto(S, S.p2);
    const path = await concluir(S, S.p2, m.id);
    await ctx(S.t, 'worker');
    await c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01', anonimizado_em = now() where id = $1`, [S.p2]);
    expect((await tenta('select app_chat_apagar_do_titular($1)', [S.p2]))?.code).toBe('42501');
    await c.query('select app_chat_soltar_anexo($1, $2)', [m.id, m.orig]);
    await c.query('select app_chat_soltar_anexo($1, $2)', [m.id, path]);
    await c.query('select app_chat_apagar_do_titular($1)', [S.p2]);
    await fim();
    expect(await contarDoTitular(S.t, S.p2)).toEqual({ chat_conversas: 0, chat_mensagens: 0, chat_leituras: 0 });
    // a trilha das exclusões (gatilho de auditoria) sob a RLS forçada
    await ctx(S.t, 'worker');
    const log = await c.query(`select entidade, count(*)::int as n from audit_log where patient_id = $1 and acao = 'excluir' group by 1 order by 1`, [S.p1]);
    expect(log.rows).toEqual([
      { entidade: 'chat', n: 1 },
      { entidade: 'chat_conversa', n: 1 },
    ]);
    await fim();
  });

  it('app_chat_apagar_do_titular compara anonimizar_apos com o "hoje" do fuso do consultório, nunca com current_date', async () => {
    // O relógio do Postgres não é falsificável aqui: escolhe-se um fuso cujo dia, AGORA, difere do dia em UTC — atrás (UTC-12,
    // de 00h a 12h UTC: como Brasília entre 00h e 03h UTC) e/ou à frente (UTC+14, de 10h a 24h UTC)
    const { rows } = await owner.query(
      `select current_date::text as utc, (now() at time zone 'Etc/GMT+12')::date::text as atras, (now() at time zone 'Etc/GMT-14')::date::text as adiante,
              (now() at time zone 'UTC')::date::text as hoje_utc`,
    );
    const { atras, adiante, hoje_utc: utc } = rows[0] as Record<string, string>;
    let provados = 0;
    if (atras < utc) {
      // o "hoje" do consultório é ontem em UTC: anonimizar_apos = hoje no fuso ainda NÃO venceu (current_date diria que sim)
      const S = await cenario('Etc/GMT+12');
      await ctx(S.t, 'worker');
      await c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = $2 where id = $1`, [S.p1, atras]);
      expect((await tenta('select app_chat_apagar_do_titular($1)', [S.p1]))?.code).toBe('42501');
      await fim();
      provados++;
    }
    if (adiante > utc) {
      // o "hoje" do consultório é amanhã em UTC: anonimizar_apos = hoje em UTC já venceu no fuso (current_date diria que não)
      const S = await cenario('Etc/GMT-14');
      await ctx(S.t, 'worker');
      await c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = $2 where id = $1`, [S.p1, utc]);
      await c.query('select app_chat_apagar_do_titular($1)', [S.p1]);
      await fim();
      expect(await contarDoTitular(S.t, S.p1)).toEqual({ chat_conversas: 0, chat_mensagens: 0, chat_leituras: 0 });
      provados++;
    }
    expect(provados).toBeGreaterThan(0);
  });
});
