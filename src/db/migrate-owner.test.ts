import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { runMigrations } from './migrate';

// Tarefa 13 (Ruling R49): em produção o migrator é um role dono do banco SEM superusuário.
// Cluster próprio, montado como no runbook, para provar que as migrations rodam assim.
let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let appUrl: string;
let owner: Pool;
let app: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const su = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
  // mesmos comandos do runbook (Tarefa 13, Step 1b), rodados uma vez como postgres
  await su.query(`CREATE ROLE nutri_owner LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD 'owner-pw'`);
  await su.query('CREATE DATABASE nutri OWNER nutri_owner');
  await su.end();
  const url = (user: string, password: string) => {
    const u = new URL(container.getConnectionUri());
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
    const su = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
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
    const su = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
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
    const su = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
    try {
      await su.query('ALTER ROLE nutri_app CREATEDB');
      await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).rejects.toThrow(/CREATEDB/);
    } finally {
      await su.query('ALTER ROLE nutri_app NOCREATEDB');
      await su.end();
    }
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
});
