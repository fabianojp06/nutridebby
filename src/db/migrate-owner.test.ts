import { readdirSync, readFileSync } from 'node:fs';
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

  // Plano 22 (spec §9.5, Review Focus 2): as ações referenciais rodam como dono da tabela filha (sem a RLS forçada e sem a
  // permissão revogada de nutri_app_role). O banco do Vitest é migrado como superusuário; só aqui (migrator sem superusuário,
  // sem BYPASSRLS, FORCE RLS — como produção) a cascata da exclusão do exame decide entre o REVOKE DELETE e o plano B.
  it('Plano 22: com o schema migrado pelo migrator sem superusuário, o DELETE de exams pela sessão nutri leva as linhas de exam_interpretacoes e exam_versoes do exame (cascata), grava os "excluir" no audit_log, e o UPDATE/DELETE direto nelas dá 42501', async () => {
    const c = await app.connect();
    const nutri = '00000000-0000-4000-8000-0000000000f2';
    const ctx = async (t: string, role: string, user = '') => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.user_id', $3, true)`, [t, role, user]);
    };
    try {
      const t = (await c.query(`insert into tenants (slug, nome_exibicao) values ('exames-dono', 'E') returning id`)).rows[0].id as string;
      await ctx(t, 'worker');
      const p = (await c.query(`insert into patients (tenant_id, nome, data_nascimento, sexo, email) values ($1, 'Pac', '1990-01-01', 'F', 'pac@exames.dev') returning id`, [t])).rows[0].id as string;
      await c.query('commit');
      await ctx(t, 'nutri', nutri);
      const exame = async () => (await c.query(`insert into exams (tenant_id, patient_id, data, titulo) values ($1, $2, '2026-11-01', 'Hemograma') returning id`, [t, p])).rows[0].id as string;
      const [sai, fica] = [await exame(), await exame()];
      const filhas: Record<string, { nota: string; versao: string }> = {};
      for (const e of [sai, fica]) {
        const nota = (await c.query(`insert into exam_interpretacoes (tenant_id, patient_id, exam_id, versao, texto, criado_por) values ($1, $2, $3, 1, 'Nota', $4) returning id, criado_por`, [t, p, e, '00000000-0000-4000-8000-0000000000ff'])).rows[0];
        expect(nota.criado_por).toBe(nutri); // autor pela sessão, também com o dono sem superusuário
        const versao = (await c.query(`insert into exam_versoes (tenant_id, patient_id, exam_id, versao, titulo, data, valores, justificativa, alterado_por) values ($1, $2, $3, 1, 'Hemograma', '2026-11-01', '[]', 'Valor errado', $4) returning id`, [t, p, e, nutri])).rows[0];
        filhas[e] = { nota: nota.id as string, versao: versao.id as string };
      }
      await c.query('commit');
      for (const tabela of ['exam_interpretacoes', 'exam_versoes']) {
        for (const comando of [`update ${tabela} set versao = versao`, `delete from ${tabela}`, `truncate ${tabela}`]) {
          await ctx(t, 'nutri', nutri);
          await expect(c.query(comando)).rejects.toMatchObject({ code: '42501' });
          await c.query('rollback');
        }
      }
      await ctx(t, 'nutri', nutri);
      expect((await c.query('delete from exams where id = $1 returning id', [sai])).rows).toHaveLength(1);
      await c.query('commit');
      await ctx(t, 'nutri', nutri);
      const contar = async (e: string) =>
        (await c.query(`select (select count(*) from exam_interpretacoes where exam_id = $1)::int as n, (select count(*) from exam_versoes where exam_id = $1)::int as v`, [e])).rows[0];
      expect(await contar(sai)).toEqual({ n: 0, v: 0 });
      expect(await contar(fica)).toEqual({ n: 1, v: 1 }); // controle positivo: a leitura enxerga as filhas que ficaram
      const excluidos = await c.query(
        `select entidade, entidade_id, actor_user_id from audit_log where tenant_id = $1 and acao = 'excluir' and entidade in ('exames_nota', 'exames_versoes') order by entidade`,
        [t],
      );
      expect(excluidos.rows).toEqual([
        { entidade: 'exames_nota', entidade_id: filhas[sai].nota, actor_user_id: nutri },
        { entidade: 'exames_versoes', entidade_id: filhas[sai].versao, actor_user_id: nutri },
      ]);
      await c.query('commit');
      // /code-review do PR 1 (LGPD): a anonimização não apaga o exame — a função SECURITY DEFINER do dono sem superusuário
      // (UPDATE revogado de nutri_app_role, FORCE RLS) limpa a justificativa e o texto das filhas que ficaram
      const fn = await owner.query(`select pg_get_userbyid(proowner) as dono, prosecdef from pg_proc where proname = 'app_anonimizar_exames_textos'`);
      expect(fn.rows).toEqual([{ dono: 'nutri_owner', prosecdef: true }]);
      await ctx(t, 'worker');
      await c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2026-01-01', anonimizado_em = now() where id = $1`, [p]);
      await c.query('select app_anonimizar_exames_textos($1, $2)', [t, p]);
      const textos = await c.query(
        `select (select array_agg(texto) from exam_interpretacoes where exam_id = $1) as notas, (select array_agg(justificativa) from exam_versoes where exam_id = $1) as versoes`,
        [fica],
      );
      expect(textos.rows).toEqual([{ notas: [null], versoes: [null] }]);
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

// Plano 23 (AG-D54, RNF-403 b): as peças SECURITY DEFINER da custom rls_agenda_2 trocam o papel para `worker` e passam pela
// RLS FORCE; só aqui (dono NOBYPASSRLS, como em produção) uma troca de contexto errada aparece — com o dono superusuário dos
// outros testes, a função leria tudo sem a troca. A custom é achada pelo sufixo (o §5 de sessoes-paralelas.md renumera).
describe('Plano 23: peças SECURITY DEFINER com dono NOBYPASSRLS', () => {
  const ARQUIVO = readdirSync(new URL('../../drizzle/', import.meta.url)).find((f) => f.endsWith('_rls_agenda_2.sql'));
  const CUSTOM = readFileSync(new URL(`../../drizzle/${ARQUIVO}`, import.meta.url), 'utf8');
  const SALA = 'https://sala.example.test/fixa';
  type Ctx = { role: string; patient?: string; user?: string };
  const NUTRI: Ctx = { role: 'nutri', user: '00000000-0000-4000-8000-0000000023a1' };
  const WORKER: Ctx = { role: 'worker' };
  const PUBLICO: Ctx = { role: 'publico' };
  type Row = Record<string, unknown>;

  /** Uma transação no login do app com o contexto de `withTenant`; `fim` decide se confirma. */
  const em = async <R>(t: string, x: Ctx, fn: (q: (texto: string, params?: unknown[]) => Promise<Row[]>) => Promise<R>, fim: 'commit' | 'rollback' = 'commit'): Promise<R> => {
    const c = await app.connect();
    try {
      await c.query('begin');
      await c.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.patient_id', $3, true), set_config('app.user_id', $4, true)`,
        [t, x.role, x.patient ?? '', x.user ?? ''],
      );
      const r = await fn(async (texto, params = []) => (await c.query(texto, params)).rows as Row[]);
      await c.query(fim);
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  };
  const contexto = `select current_setting('app.role', true) as role, current_setting('app.patient_id', true) as patient`;
  const novoTenant = async (extra: { endereco?: string | null; link?: string | null; paginaPublica?: boolean } = {}) =>
    (
      await app.query(
        `insert into tenants (slug, nome_exibicao, endereco_consultorio, link_online_padrao, agendamento_publico_ativo) values ($1, 'P23', $2, $3, $4) returning id`,
        [`p23-${crypto.randomUUID().slice(0, 8)}`, extra.endereco ?? null, extra.link ?? null, extra.paginaPublica ?? true],
      )
    ).rows[0].id as string;
  const novoPaciente = (t: string, status = 'ativo') =>
    em(t, WORKER, async (q) => (await q(`insert into patients (tenant_id, nome, data_nascimento, sexo, email, status) values ($1, 'Pac', '1990-01-01', 'F', $2, $3) returning id`, [t, `${crypto.randomUUID()}@p23.dev`, status]))[0].id as string);
  type Local = { nome: string; tipo?: 'presencial' | 'online'; endereco?: string; cidade?: string; mostrar?: boolean; link?: string; agendamento?: boolean; principal?: boolean; arquivado?: boolean; criado?: string };
  const novoLocal = (t: string, l: Local) =>
    em(t, NUTRI, async (q) =>
      (
        await q(
          `insert into locais_atendimento (tenant_id, nome, tipo, endereco, cidade, mostrar_endereco, link_sala, agendamento_online, principal, arquivado_em, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $10 then now() end, coalesce($11::timestamptz, now())) returning id`,
          [t, l.nome, l.tipo ?? 'presencial', l.endereco ?? null, l.cidade ?? null, l.mostrar ?? false, l.link ?? null, l.agendamento ?? false, l.principal ?? false, l.arquivado ?? false, l.criado ?? null],
        )
      )[0].id as string,
    );
  let seq = 0;
  /** Cada consulta ou pedido num horário próprio (EXCLUDE appointments_sem_sobreposicao e a sobreposição do aguardando). */
  const horario = () => {
    const inicio = new Date(Date.UTC(2031, 2, 1, 12) + ++seq * 2 * 3_600_000);
    return { inicio, fim: new Date(inicio.getTime() + 3_600_000) };
  };
  type Consulta = { local: string | null; modalidade: 'presencial' | 'online'; origem?: 'nutri' | 'paciente'; link?: string | null; paciente: string };
  const inserirConsulta = (q: (texto: string, params?: unknown[]) => Promise<Row[]>, t: string, c: Consulta, h = horario()) =>
    q(
      `insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, local_id, link_online) values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, status, link_online`,
      [t, c.paciente, h.inicio, h.fim, c.modalidade, c.origem ?? 'paciente', c.local, c.link ?? null],
    );
  const negado = (trecho: string) => (e: unknown) => (e as { code?: string }).code === '42501' && String((e as Error).message).includes(trecho);

  it('as funções novas são SECURITY DEFINER do migrator, sem EXECUTE para PUBLIC e com EXECUTE para o app', async () => {
    const nomes = [
      'app_locais_para_agendamento',
      'app_local_da_consulta',
      'app_pedidos_aguardando',
      'app_pedido_aguardar',
      'app_pedido_publico_desistir',
      'app_appointments_link_da_sala',
      'app_anonimizar_autorizacoes_aniversario',
    ];
    const { rows } = await owner.query(
      `select p.proname, pg_get_userbyid(p.proowner) as dono, p.prosecdef, array_to_string(p.proconfig, ',') as config,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico,
              has_function_privilege('nutri_app_role', p.oid, 'EXECUTE') as app
         from pg_proc p where p.proname = any($1) order by p.proname`,
      [nomes],
    );
    expect(rows.map((r) => r.proname)).toEqual([...nomes].sort());
    for (const r of rows) {
      expect(r, r.proname).toMatchObject({ dono: 'nutri_owner', prosecdef: true, config: 'search_path=public, pg_temp', publico: false });
      if (r.proname !== 'app_appointments_link_da_sala') expect(r.app, r.proname).toBe(true);
    }
  });

  it('app_locais_para_agendamento (AG-D62): publico e paciente recebem todos os ativos do próprio tenant, sem a sala, minimizados; nutri e worker, nada; o contexto volta', async () => {
    const t = await novoTenant();
    const outro = await novoTenant();
    const p = await novoPaciente(t);
    const principal = await novoLocal(t, { nome: 'Consultório', endereco: 'Rua A, 1', cidade: 'São Paulo', mostrar: true, agendamento: true, principal: true, criado: '2026-01-03T12:00Z' });
    const video = await novoLocal(t, { nome: 'Videoconferência', tipo: 'online', link: SALA, agendamento: true, criado: '2026-01-01T12:00Z' });
    const sala = await novoLocal(t, { nome: 'Sala B', endereco: 'Rua B, 2', cidade: 'Santos', mostrar: true, agendamento: false, criado: '2026-01-02T12:00Z' });
    const clinica = await novoLocal(t, { nome: 'Clínica', endereco: 'Rua C, 3', cidade: 'Campinas', mostrar: false, agendamento: true, criado: '2026-01-02T12:00Z' });
    await novoLocal(t, { nome: 'Antigo', arquivado: true, criado: '2025-12-01T12:00Z' });
    await novoLocal(outro, { nome: 'Outro consultório', agendamento: true, principal: true });
    const empate = [sala, clinica].sort(); // mesmo created_at: desempata pelo id
    const esperado = (id: string) =>
      ({
        [principal]: { nome: 'Consultório', tipo: 'presencial', cidade: 'São Paulo', endereco: 'Rua A, 1', principal: true, agendamento_online: true },
        [video]: { nome: 'Videoconferência', tipo: 'online', cidade: null, endereco: null, principal: false, agendamento_online: true },
        // sem agendamento: só o tipo (a RN-410a ainda precisa saber que ele existe)
        [sala]: { nome: null, tipo: 'presencial', cidade: null, endereco: null, principal: false, agendamento_online: false },
        // sem mostrar_endereco: o nome e a cidade, sem o endereço
        [clinica]: { nome: 'Clínica', tipo: 'presencial', cidade: 'Campinas', endereco: null, principal: false, agendamento_online: true },
      })[id];
    for (const x of [PUBLICO, { role: 'paciente', patient: p }, { role: 'paciente', patient: p, user: crypto.randomUUID() }]) {
      const { rows, ctx } = await em(t, x, async (q) => ({ rows: await q('select * from app_locais_para_agendamento()'), ctx: (await q(contexto))[0] }));
      expect(rows.map((r) => r.id), x.role).toEqual([principal, video, ...empate]);
      expect(Object.keys(rows[0])).toEqual(['id', 'nome', 'tipo', 'cidade', 'endereco', 'principal', 'agendamento_online', 'criado_em']);
      for (const r of rows) expect(r).toMatchObject({ ...esperado(r.id as string), criado_em: expect.any(Date) });
      expect(JSON.stringify(rows)).not.toContain('sala.example.test');
      expect(ctx).toEqual({ role: x.role, patient: x.patient ?? '' });
    }
    for (const x of [NUTRI, WORKER]) {
      const { rows, ctx } = await em(t, x, async (q) => ({ rows: await q('select * from app_locais_para_agendamento()'), ctx: (await q(contexto))[0] }));
      expect(rows, x.role).toEqual([]);
      expect(ctx).toEqual({ role: x.role, patient: '' });
    }

    // AG-D62: principal sem agendamento + outro presencial com agendamento. A regra sem local vai para o principal ativo do tipo
    // (RN-410a, o primeiro presencial da projeção); ele não aceita agendamento, então o recorte do TS não gera horário fora do painel
    const t2 = await novoTenant();
    const semAgendamento = await novoLocal(t2, { nome: 'Consultório', principal: true, agendamento: false, criado: '2026-01-02T12:00Z' });
    const comAgendamento = await novoLocal(t2, { nome: 'Clínica', agendamento: true, criado: '2026-01-01T12:00Z' });
    const rows = await em(t2, PUBLICO, (q) => q('select * from app_locais_para_agendamento()'));
    expect(rows.find((r) => r.tipo === 'presencial')).toMatchObject({ id: semAgendamento, principal: true, agendamento_online: false, nome: null });
    expect(rows.filter((r) => r.agendamento_online).map((r) => r.id)).toEqual([comAgendamento]);
  });

  it('app_local_da_consulta: o local da consulta do próprio paciente (nome, tipo, cidade, endereço), nunca a sala; vazio para a consulta de outro e fora da sessão de paciente', async () => {
    const t = await novoTenant();
    const [p1, p2] = [await novoPaciente(t), await novoPaciente(t)];
    const local = await novoLocal(t, { nome: 'Consultório', endereco: 'Rua A, 1', cidade: 'São Paulo', mostrar: false, principal: true });
    const video = await novoLocal(t, { nome: 'Videoconferência', tipo: 'online', link: SALA });
    const [c1, c2, c3, c4] = await em(t, NUTRI, async (q) => [
      (await inserirConsulta(q, t, { paciente: p1, local, modalidade: 'presencial', origem: 'nutri' }))[0].id,
      (await inserirConsulta(q, t, { paciente: p2, local, modalidade: 'presencial', origem: 'nutri' }))[0].id,
      (await inserirConsulta(q, t, { paciente: p1, local: video, modalidade: 'online', origem: 'nutri', link: 'https://consulta.example.test/1' }))[0].id,
      (await inserirConsulta(q, t, { paciente: p1, local: null, modalidade: 'presencial', origem: 'nutri' }))[0].id,
    ]);
    const ler = (x: Ctx, id: unknown) => em(t, x, async (q) => ({ rows: await q('select * from app_local_da_consulta($1)', [id]), ctx: (await q(contexto))[0] }));
    for (const x of [{ role: 'paciente', patient: p1 }, { role: 'paciente', patient: p1, user: crypto.randomUUID() }]) {
      const a = await ler(x, c1);
      expect(a.rows).toEqual([{ nome: 'Consultório', tipo: 'presencial', cidade: 'São Paulo', endereco: 'Rua A, 1' }]);
      expect(a.ctx).toEqual({ role: 'paciente', patient: p1 });
      const v = await ler(x, c3);
      expect(v.rows).toEqual([{ nome: 'Videoconferência', tipo: 'online', cidade: null, endereco: null }]);
      expect((await ler(x, c2)).rows).toEqual([]); // consulta de outro paciente
      expect((await ler(x, c4)).rows).toEqual([]); // consulta sem local (imagem anterior)
    }
    expect((await ler({ role: 'paciente', patient: p2 }, c1)).rows).toEqual([]);
    for (const x of [PUBLICO, NUTRI, WORKER]) {
      const r = await ler(x, c1);
      expect(r.rows, x.role).toEqual([]);
      expect(r.ctx).toEqual({ role: x.role, patient: '' });
    }
  });

  it('appointments_link_da_sala: copia a sala na consulta de origem paciente em local online, em qualquer papel; recusa local arquivado ou sem agendamento só no paciente e no publico; local nulo passa intacto', async () => {
    const t = await novoTenant();
    const p = await novoPaciente(t);
    const video = await novoLocal(t, { nome: 'Videoconferência', tipo: 'online', link: SALA, agendamento: true });
    const videoSemAgendamento = await novoLocal(t, { nome: 'Vídeo interno', tipo: 'online', link: 'https://sala.example.test/interna', agendamento: false });
    const videoArquivado = await novoLocal(t, { nome: 'Vídeo antigo', tipo: 'online', link: 'https://sala.example.test/antiga', arquivado: true });
    const presencial = await novoLocal(t, { nome: 'Consultório', agendamento: true, principal: true });
    const presencialSemAgendamento = await novoLocal(t, { nome: 'Sala da equipe', agendamento: false });
    const PACIENTE: Ctx = { role: 'paciente', patient: p };
    const MANDADO = 'https://codigo.example.test/mandado';
    const gravar = (x: Ctx, c: Omit<Consulta, 'paciente'>) =>
      em(t, x, async (q) => ({ linha: (await inserirConsulta(q, t, { paciente: p, ...c }))[0], ctx: (await q(contexto))[0] }));

    for (const x of [PACIENTE, PUBLICO]) {
      const { linha, ctx } = await gravar(x, { local: video, modalidade: 'online', link: MANDADO });
      expect(linha, x.role).toMatchObject({ status: 'agendada', link_online: SALA }); // o link mandado pelo código é ignorado
      expect(ctx).toEqual({ role: x.role, patient: x.patient ?? '' });
      expect((await gravar(x, { local: presencial, modalidade: 'presencial' })).linha).toMatchObject({ status: 'agendada', link_online: null });
      // imagem do PR 1: sem local, o link mandado fica e a chave desligada dá agendada
      expect((await gravar(x, { local: null, modalidade: 'online', link: MANDADO })).linha).toMatchObject({ status: 'agendada', link_online: MANDADO });
      for (const local of [videoSemAgendamento, videoArquivado]) {
        await expect(gravar(x, { local, modalidade: 'online', link: MANDADO }), x.role).rejects.toSatisfy(negado('o local não aceita agendamento pelo paciente'));
      }
      await expect(gravar(x, { local: presencialSemAgendamento, modalidade: 'presencial' })).rejects.toSatisfy(negado('o local não aceita agendamento pelo paciente'));
    }
    // o aceite da pessoa nova roda na sessão nutri com origem paciente: a sala também é copiada
    const aceite = await gravar(NUTRI, { local: video, modalidade: 'online', origem: 'paciente', link: MANDADO });
    expect(aceite.linha).toMatchObject({ status: 'agendada', link_online: SALA });
    expect(aceite.ctx).toEqual({ role: 'nutri', patient: '' });
    // a equipe marca no local sem agendamento e manda o link da consulta (origem nutri: o código decide o link)
    expect((await gravar(NUTRI, { local: videoSemAgendamento, modalidade: 'online', origem: 'nutri', link: MANDADO })).linha).toMatchObject({ link_online: MANDADO });
    expect((await gravar(NUTRI, { local: presencialSemAgendamento, modalidade: 'presencial', origem: 'nutri' })).linha).toMatchObject({ link_online: null });
    expect((await gravar(WORKER, { local: videoSemAgendamento, modalidade: 'online', origem: 'paciente', link: MANDADO })).linha).toMatchObject({
      link_online: 'https://sala.example.test/interna',
    });
  });

  /** Pedido da página pública (como gravarPedido: contexto worker do teste), já verificado há `verificadoHa` (null = sem código). */
  type Pedido = { email?: string; nome?: string; token?: string; verificadoHa?: string | null; concluido?: boolean; modalidade?: 'presencial' | 'online' };
  const novoPedido = (t: string, o: Pedido = {}) =>
    em(t, WORKER, async (q) =>
      (
        await q(
          `insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, modalidade, termo_versao, expira_em, verificado_em, concluido_em)
           values (gen_random_uuid(), $1, $2, 'codigo', $3, $4, '2031-06-01T12:00Z', $5, 'termo-v1', now() + interval '1 day',
                   case when $6::text is null then null else now() - $6::interval end, case when $7 then now() end) returning id`,
          [t, o.token ?? crypto.randomUUID(), o.email ?? `${crypto.randomUUID()}@pessoa.dev`, o.nome ?? 'Pessoa Nova', o.modalidade ?? 'presencial', o.verificadoHa === undefined ? '1 minute' : o.verificadoHa, o.concluido ?? false],
        )
      )[0].id as string,
    );
  const aguardar = (t: string, pedido: string, local: string, h: { inicio: Date; fim: Date }, x: Ctx = PUBLICO) =>
    em(t, x, async (q) => ({ r: (await q('select app_pedido_aguardar($1, $2, $3, $4) as r', [pedido, local, h.inicio, h.fim]))[0].r, ctx: (await q(contexto))[0] }));
  const lerPedido = async (t: string, id: string) =>
    (await em(t, WORKER, (q) => q('select local_id, modalidade, inicio, fim, aguardando_desde is not null as aguardando, resolvido_em is not null as resolvido, resolucao from public_booking_requests where id = $1', [id])))[0];

  it('app_pedido_aguardar (RN-425): grava com a modalidade do local; teto 20 por consultório e 1 por e-mail; ocupado sobre solicitada e sobre outro aguardando; inválido sem código, com código vencido, já aguardando, concluído, fora do publico ou com local sem agendamento', async () => {
    const t = await novoTenant();
    const outro = await novoTenant();
    const p = await novoPaciente(t);
    const video = await novoLocal(t, { nome: 'Videoconferência', tipo: 'online', link: SALA, agendamento: true });
    const presencial = await novoLocal(t, { nome: 'Consultório', agendamento: true, principal: true });
    const semAgendamento = await novoLocal(t, { nome: 'Sala da equipe', agendamento: false });
    const arquivado = await novoLocal(t, { nome: 'Antigo', arquivado: true });
    const deOutro = await novoLocal(outro, { nome: 'Consultório', agendamento: true, principal: true });

    // pedido presencial aguardando num local online: grava a modalidade do local (a FK composta recusaria outra)
    const h1 = horario();
    const p1 = await novoPedido(t, { email: 'Ana@Pessoa.dev', modalidade: 'presencial' });
    expect(await aguardar(t, p1, video, h1)).toEqual({ r: 'ok', ctx: { role: 'publico', patient: '' } });
    expect(await lerPedido(t, p1)).toEqual({ local_id: video, modalidade: 'online', inicio: h1.inicio, fim: h1.fim, aguardando: true, resolvido: false, resolucao: null });
    expect((await aguardar(t, p1, video, horario())).r).toBe('invalido'); // já aguardando

    // um por e-mail (sem diferença de maiúsculas)
    expect((await aguardar(t, await novoPedido(t, { email: 'ana@pessoa.dev' }), presencial, horario())).r).toBe('email');
    // ocupado: sobre outro aguardando e sobre uma consulta solicitada (chave ligada, pedido do paciente)
    expect((await aguardar(t, await novoPedido(t), presencial, { inicio: new Date(h1.inicio.getTime() + 30 * 60_000), fim: new Date(h1.fim.getTime() + 30 * 60_000) })).r).toBe('ocupado');
    await em(t, NUTRI, (q) => q('update tenants set agenda_confirmar_pedidos = true where id = $1', [t]));
    const hs = horario();
    const [sol] = await em(t, { role: 'paciente', patient: p }, (q) => inserirConsulta(q, t, { paciente: p, local: presencial, modalidade: 'presencial' }, hs));
    expect(sol.status).toBe('solicitada');
    expect((await aguardar(t, await novoPedido(t), presencial, hs)).r).toBe('ocupado');
    // encostar não é sobrepor
    expect((await aguardar(t, await novoPedido(t), presencial, { inicio: hs.fim, fim: new Date(hs.fim.getTime() + 3_600_000) })).r).toBe('ok');

    // inválidos: nada é gravado
    const invalidos: [string, string][] = [
      [await novoPedido(t, { verificadoHa: null }), presencial],
      [await novoPedido(t, { verificadoHa: '31 minutes' }), presencial],
      [await novoPedido(t, { concluido: true }), presencial],
      [await novoPedido(t), semAgendamento],
      [await novoPedido(t), arquivado],
      [await novoPedido(t), deOutro],
      [await novoPedido(outro), presencial], // pedido de outro consultório
      [crypto.randomUUID(), presencial],
    ];
    for (const [pedido, local] of invalidos) expect((await aguardar(t, pedido, local, horario())).r, `${pedido} ${local}`).toBe('invalido');
    expect((await lerPedido(t, invalidos[0][0])).aguardando).toBe(false);
    // dentro da validade de 30 min (VERIFICADO_VALIDADE_MS de agendamento-publico.ts) passa
    expect((await aguardar(t, await novoPedido(t, { verificadoHa: '29 minutes' }), presencial, horario())).r).toBe('ok');
    // só o publico: nos outros papéis é inválido e nada muda
    const naoPublico = await novoPedido(t);
    for (const x of [NUTRI, WORKER, { role: 'paciente', patient: p }]) {
      const { r, ctx } = await aguardar(t, naoPublico, presencial, horario(), x);
      expect(r, x.role).toBe('invalido');
      expect(ctx).toEqual({ role: x.role, patient: x.patient ?? '' });
    }
    expect((await lerPedido(t, naoPublico)).aguardando).toBe(false);

    // teto de 20 aguardando por consultório
    const t3 = await novoTenant();
    const l3 = await novoLocal(t3, { nome: 'Consultório', agendamento: true, principal: true });
    const resultados: unknown[] = [];
    for (let i = 0; i < 21; i++) resultados.push((await aguardar(t3, await novoPedido(t3), l3, horario())).r);
    expect(resultados).toEqual([...Array(20).fill('ok'), 'teto_tenant']);
  });

  it('app_pedidos_aguardando (AG-D58): só os intervalos (tstzrange) dos aguardando do tenant no período, no publico e no paciente; vazio na equipe', async () => {
    const t = await novoTenant();
    const outro = await novoTenant();
    const p = await novoPaciente(t);
    const local = await novoLocal(t, { nome: 'Consultório', agendamento: true, principal: true });
    const localOutro = await novoLocal(outro, { nome: 'Consultório', agendamento: true, principal: true });
    const h1 = horario();
    const h2 = horario();
    expect((await aguardar(t, await novoPedido(t), local, h1)).r).toBe('ok');
    const resolvido = await novoPedido(t);
    expect((await aguardar(t, resolvido, local, h2)).r).toBe('ok');
    await em(t, WORKER, (q) => q(`update public_booking_requests set resolvido_em = now(), resolucao = 'recusado' where id = $1`, [resolvido]));
    expect((await aguardar(outro, await novoPedido(outro), localOutro, h1)).r).toBe('ok');
    await novoPedido(t); // só verificado, sem aguardar

    const ler = (x: Ctx, de: Date, ate: Date) =>
      em(t, x, async (q) => ({
        rows: await q('select pg_typeof(r)::text as tipo, lower(r) as de, upper(r) as ate from app_pedidos_aguardando($1, $2) r', [de, ate]),
        ctx: (await q(contexto))[0],
      }));
    for (const x of [PUBLICO, { role: 'paciente', patient: p }]) {
      const { rows, ctx } = await ler(x, new Date(h1.inicio.getTime() - 86_400_000), new Date(h2.fim.getTime() + 86_400_000));
      expect(rows, x.role).toEqual([{ tipo: 'tstzrange', de: h1.inicio, ate: h1.fim }]);
      expect(ctx).toEqual({ role: x.role, patient: x.patient ?? '' });
      expect((await ler(x, h1.fim, h2.fim)).rows).toEqual([]); // fora do período (encostar não conta)
    }
    for (const x of [NUTRI, WORKER]) expect((await ler(x, new Date(0), new Date(h2.fim.getTime() + 86_400_000))).rows, x.role).toEqual([]);
    const { rows } = await owner.query(`select pg_get_function_result('app_pedidos_aguardando(timestamptz, timestamptz)'::regprocedure) as r`);
    expect(rows[0].r).toBe('SETOF tstzrange');
  });

  it('app_pedido_publico_desistir (AG-D48, AG-D63): mostra sem gravar; desiste uma vez (gravou e o primeiro nome só nessa chamada); inválido para pedido concluído, recusado, vencido ou sem aguardar; o contexto volta', async () => {
    const t = await novoTenant();
    const local = await novoLocal(t, { nome: 'Consultório', agendamento: true, principal: true });
    const h = horario();
    const pedido = await novoPedido(t, { token: 'tok-desistir', nome: '  Maria Clara Souza' });
    expect((await aguardar(t, pedido, local, h)).r).toBe('ok');
    const desistir = (token: string, confirmar: boolean, x: Ctx = PUBLICO) =>
      em(t, x, async (q) => ({ rows: await q('select * from app_pedido_publico_desistir($1, $2)', [token, confirmar]), ctx: (await q(contexto))[0] }));

    const ver = await desistir('tok-desistir', false);
    expect(ver.rows).toEqual([{ estado: 'aguardando', inicio: h.inicio, gravou: false, primeiro_nome: null }]);
    expect(ver.ctx).toEqual({ role: 'publico', patient: '' });
    expect((await lerPedido(t, pedido)).resolvido).toBe(false);
    for (const x of [NUTRI, WORKER]) {
      const r = await desistir('tok-desistir', true, x);
      expect(r.rows, x.role).toEqual([]);
      expect(r.ctx).toEqual({ role: x.role, patient: '' });
    }
    expect((await lerPedido(t, pedido)).resolvido).toBe(false);

    const gravou = await desistir('tok-desistir', true);
    expect(gravou.rows).toEqual([{ estado: 'cancelado', inicio: h.inicio, gravou: true, primeiro_nome: 'Maria' }]);
    expect(gravou.ctx).toEqual({ role: 'publico', patient: '' });
    expect(await lerPedido(t, pedido)).toMatchObject({ aguardando: true, resolvido: true, resolucao: 'desistido' });
    // F5, duplo clique e o provedor que reabre o link: cancelado, sem gravar de novo e sem o nome
    expect((await desistir('tok-desistir', true)).rows).toEqual([{ estado: 'cancelado', inicio: h.inicio, gravou: false, primeiro_nome: null }]);
    expect((await desistir('tok-desistir', false)).rows).toEqual([{ estado: 'cancelado', inicio: h.inicio, gravou: false, primeiro_nome: null }]);
    // o horário volta a ser oferecido
    expect(await em(t, PUBLICO, (q) => q('select * from app_pedidos_aguardando($1, $2)', [h.inicio, h.fim]))).toEqual([]);

    const invalido = [{ estado: 'invalido', inicio: null, gravou: false, primeiro_nome: null }];
    await novoPedido(t, { token: 'tok-concluido', concluido: true });
    await novoPedido(t, { token: 'tok-sem-aguardar' });
    for (const [token, resolucao] of [['tok-recusado', 'recusado'], ['tok-vencido', 'vencido'], ['tok-aceito', 'aceito']]) {
      const id = await novoPedido(t, { token });
      expect((await aguardar(t, id, local, horario())).r).toBe('ok');
      await em(t, WORKER, (q) => q('update public_booking_requests set resolvido_em = now(), resolucao = $2 where id = $1', [id, resolucao]));
    }
    // vencido e ainda não processado (leitura preguiçosa, RN-427): começa antes da antecedência (12 h)
    const preguicoso = await novoPedido(t, { token: 'tok-preguicoso' });
    expect((await aguardar(t, preguicoso, local, { inicio: new Date(Date.now() + 3_600_000), fim: new Date(Date.now() + 7_200_000) })).r).toBe('ok');
    for (const token of ['tok-concluido', 'tok-sem-aguardar', 'tok-recusado', 'tok-vencido', 'tok-aceito', 'tok-preguicoso', 'tok-inexistente']) {
      expect((await desistir(token, false)).rows, token).toEqual(invalido);
      expect((await desistir(token, true)).rows, token).toEqual(invalido);
    }
    expect(await lerPedido(t, preguicoso)).toMatchObject({ resolvido: false, resolucao: null });
  });

  it('app_anonimizar_autorizacoes_aniversario (RN-438): o app executa; recusa titular não bloqueado e fora do worker; anula só o registrado_por de origem app', async () => {
    const t = await novoTenant();
    const p = await novoPaciente(t);
    const conta = crypto.randomUUID();
    await em(t, NUTRI, (q) => q(`insert into aniversario_autorizacoes (tenant_id, patient_id, evento, origem, forma, registrado_por) values ($1, $2, 'autorizou', 'nutri', 'escrito', $3)`, [t, p, NUTRI.user]));
    await em(t, { role: 'paciente', patient: p, user: conta }, (q) =>
      q(`insert into aniversario_autorizacoes (tenant_id, patient_id, evento, origem, registrado_por) values ($1, $2, 'retirou', 'app', $3)`, [t, p, conta]),
    );
    await em(t, { role: 'paciente', patient: p }, (q) => q(`insert into aniversario_autorizacoes (tenant_id, patient_id, evento, origem) values ($1, $2, 'retirou', 'link')`, [t, p]));
    const anonimizar = (x: Ctx) => em(t, x, (q) => q('select app_anonimizar_autorizacoes_aniversario($1)', [p]));
    await expect(anonimizar(WORKER)).rejects.toMatchObject({ code: '42501' }); // titular ativo
    await em(t, WORKER, (q) => q(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2026-01-01' where id = $1`, [p]));
    await expect(anonimizar(NUTRI)).rejects.toMatchObject({ code: '42501' }); // fora do worker
    await anonimizar(WORKER);
    const linhas = await em(t, WORKER, (q) => q('select origem, evento, forma, registrado_por from aniversario_autorizacoes where patient_id = $1 order by registrado_em', [p]));
    expect(linhas).toEqual([
      { origem: 'nutri', evento: 'autorizou', forma: 'escrito', registrado_por: NUTRI.user }, // autoria da nutricionista (ECF.17.01)
      { origem: 'app', evento: 'retirou', forma: null, registrado_por: null },
      { origem: 'link', evento: 'retirou', forma: null, registrado_por: null },
    ]);
    await anonimizar(WORKER); // de novo: nada a fazer, sem erro
    await em(t, WORKER, (q) => q(`update patients set anonimizado_em = now() where id = $1`, [p]));
    await expect(anonimizar(WORKER)).rejects.toMatchObject({ code: '42501' }); // já anonimizado
  });

  // Roda por último neste arquivo (como o da 0110): o bloco roda em todos os tenants do cluster.
  it('P23-BACKFILL (AG-D6, AG-D40, AG-D47): locais iniciais por consultório e regras com local, "ambas" desdobrada; idempotente', async () => {
    const inicio = CUSTOM.indexOf('-- P23-BACKFILL início');
    const fim = CUSTOM.indexOf('-- P23-BACKFILL fim');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const BLOCO = CUSTOM.slice(inicio, fim);
    const migrar = async () => {
      const o = await owner.connect();
      try {
        await o.query('begin');
        for (const st of BLOCO.split('--> statement-breakpoint')) {
          if (st.split('\n').some((l) => l.trim() && !l.trim().startsWith('--'))) await o.query(st);
        }
        await o.query('commit');
      } finally {
        await o.query('rollback').catch(() => undefined);
        o.release();
      }
    };
    const regra = (q: (texto: string, params?: unknown[]) => Promise<Row[]>, t: string, dia: number, modalidade: string) =>
      q(`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade) values ($1, $2, '08:00', '12:00', 60, $3)`, [t, dia, modalidade]);
    const A = await novoTenant({ endereco: 'Rua A, 1' });
    const B = await novoTenant({ link: 'https://meet.example.test/b' });
    const C = await novoTenant();
    const D = await novoTenant({ endereco: 'Rua D, 4', link: 'https://meet.example.test/d', paginaPublica: false });
    const E = await novoTenant({ endereco: 'Rua E, 5' }); // já tem locais (consultório criado depois, garantirLocaisIniciais)
    const F = await novoTenant({ link: 'http://inseguro.example.test/f' }); // link fora do formato da sala: não é copiado
    await em(A, WORKER, async (q) => {
      await regra(q, A, 1, 'ambas');
      await regra(q, A, 2, 'presencial');
    });
    await em(B, WORKER, (q) => regra(q, B, 3, 'online'));
    await em(D, WORKER, async (q) => {
      await regra(q, D, 1, 'presencial');
      await regra(q, D, 2, 'online');
    });
    await novoLocal(E, { nome: 'Sala 1', agendamento: true, criado: '2026-01-01T12:00Z' });
    const sala2 = await novoLocal(E, { nome: 'Sala 2', principal: true, agendamento: true, criado: '2026-01-02T12:00Z' });
    await em(E, WORKER, (q) => regra(q, E, 4, 'presencial'));
    await em(F, WORKER, (q) => regra(q, F, 5, 'online'));

    const retrato = async (t: string) =>
      em(t, WORKER, async (q) => ({
        locais: await q(`select id, nome, tipo, endereco, link_sala, agendamento_online, principal from locais_atendimento where tenant_id = $1 order by principal desc, nome`, [t]),
        regras: await q(
          `select r.dia_semana, r.inicio::text as inicio, r.fim::text as fim, r.duracao_min, r.modalidade, l.nome as local
             from availability_rules r left join locais_atendimento l on l.tenant_id = r.tenant_id and l.id = r.local_id
            where r.tenant_id = $1 order by r.dia_semana, r.modalidade`,
          [t],
        ),
      }));
    const sem = (locais: Row[]) => locais.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'id')));
    const regraEm = (dia: number, modalidade: string, local: string) => ({ dia_semana: dia, inicio: '08:00:00', fim: '12:00:00', duracao_min: 60, modalidade, local });
    const consultorio = (endereco: string | null) => ({ nome: 'Consultório', tipo: 'presencial', endereco, link_sala: null, agendamento_online: true, principal: true });
    const videoconferencia = (link: string | null, principal = false) => ({ nome: 'Videoconferência', tipo: 'online', endereco: null, link_sala: link, agendamento_online: link !== null, principal });

    await migrar();
    const depois = Object.fromEntries(await Promise.all([A, B, C, D, E, F].map(async (t) => [t, await retrato(t)] as const)));
    // com endereço, sem link, regra "ambas": Consultório principal + Videoconferência sem sala; "ambas" vira presencial + par online
    expect(sem(depois[A].locais)).toEqual([consultorio('Rua A, 1'), videoconferencia(null)]);
    expect(depois[A].regras).toEqual([regraEm(1, 'online', 'Videoconferência'), regraEm(1, 'presencial', 'Consultório'), regraEm(2, 'presencial', 'Consultório')]);
    // sem endereço, com link, só regra online: só a Videoconferência, principal, com a sala
    expect(sem(depois[B].locais)).toEqual([videoconferencia('https://meet.example.test/b', true)]);
    expect(depois[B].regras).toEqual([regraEm(3, 'online', 'Videoconferência')]);
    // sem nada: só o Consultório
    expect(sem(depois[C].locais)).toEqual([consultorio(null)]);
    expect(depois[C].regras).toEqual([]);
    // página pública desligada: os dois aceitam agendamento pelo paciente (AG-D40: o portal continua com horários)
    expect(sem(depois[D].locais)).toEqual([consultorio('Rua D, 4'), videoconferencia('https://meet.example.test/d')]);
    expect(depois[D].regras).toEqual([regraEm(1, 'presencial', 'Consultório'), regraEm(2, 'online', 'Videoconferência')]);
    // consultório que já tem locais: nenhum local novo; a regra sem local vai para o principal ativo do tipo (RN-410a)
    expect(depois[E].locais.map((l) => l.nome)).toEqual(['Sala 2', 'Sala 1']);
    expect(depois[E].regras).toEqual([regraEm(4, 'presencial', 'Sala 2')]);
    expect(depois[E].locais[0].id).toBe(sala2);
    // link padrão fora do formato da sala: a Videoconferência nasce sem sala e sem agendamento
    expect(sem(depois[F].locais)).toEqual([videoconferencia(null, true)]);
    expect(depois[F].regras).toEqual([regraEm(5, 'online', 'Videoconferência')]);

    await migrar(); // de novo: nada muda (só tenant sem local e só regra sem local)
    for (const t of [A, B, C, D, E, F]) expect(await retrato(t)).toEqual(depois[t]);
    // a RLS volta a ser FORCE nas duas tabelas
    const { rows } = await owner.query(`select relname, relforcerowsecurity from pg_class where relname in ('locais_atendimento', 'availability_rules') order by relname`);
    expect(rows).toEqual([
      { relname: 'availability_rules', relforcerowsecurity: true },
      { relname: 'locais_atendimento', relforcerowsecurity: true },
    ]);
  });
});
