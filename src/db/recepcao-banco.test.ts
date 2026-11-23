import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { bancoProprioParaDdl } from '../../test/ddl';
import { novoTenant, type TenantDeTeste } from '../../test/pacientes';
import { withTenant, type TenantContext } from './tenant';

/**
 * Plano 26 (spec §9.1 a §9.3, blocos 1 e 2; RN-498, RN-505): o banco da recepção sem o módulo — negação por padrão
 * (app_deny_recepcao, app_allow_recepcao, app_enable_tenant_rls e o laço), a tabela equipe_membros com o gatilho
 * equipe_membros_regras e os CHECKs novos de `user` e `invites`. As liberações e as condições das outras tabelas (T5a) e os
 * gatilhos de colunas e as funções SECURITY DEFINER (T5b) têm testes próprios.
 */
const ddl = bancoProprioParaDdl(); // DDL (tabela de rascunho, laço): banco próprio, sem disputar travas (SUS-100)
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

type Row = Record<string, unknown>;
const em = async (ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), app.db)).rows as Row[];
const erro = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string; message?: string; constraint?: string }; message?: string; constraint?: string };
  return { code: x.code ?? x.cause?.code, message: x.cause?.message ?? x.message ?? '', constraint: x.constraint ?? x.cause?.constraint };
};
/** 42501 do gatilho (mensagem própria), não da RLS nem da permissão. */
const doGatilho = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && !/row-level security|permission denied/.test(message);
};
const rlsDe = (tabela: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /row-level security/.test(message) && message.includes(`for table "${tabela}"`);
};
const permissaoNegada = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /permission denied/.test(message);
};
const violaCheck = (nome: string) => (e: unknown) => {
  const { code, constraint, message } = erro(e);
  return code === '23514' && (constraint === nome || message.includes(nome));
};
const normalizar = (e: string | null) => (e ?? '').replace(/[\s()]/g, '').toLowerCase();
const NEGA_RECEPCAO = normalizar("app_current_role() IS DISTINCT FROM 'recepcao'::text");

/** O SQL da custom rls_recepcao, achado pelo nome (o número muda a cada regeneração, sessoes-paralelas.md §5). */
function sqlDaCustom(): string {
  const pasta = path.resolve('drizzle');
  const arquivos = readdirSync(pasta).filter((f) => /^\d{4}_rls_recepcao\.sql$/.test(f));
  expect(arquivos).toHaveLength(1);
  return readFileSync(path.join(pasta, arquivos[0]), 'utf8');
}

describe('negação por padrão (RN-505)', () => {
  it('app_enable_tenant_rls numa tabela de rascunho cria tenant_isolation, publico_negado, os paciente_sem_* e recepcao_negada', async () => {
    const c = await ddl.pool.connect();
    try {
      await c.query('begin');
      await c.query('create table tmp_rascunho (id int primary key, tenant_id uuid not null)');
      await c.query(`select app_enable_tenant_rls('tmp_rascunho')`);
      const { rows } = await c.query<{ pol: string; cmd: string; permissive: string; qual: string | null; with_check: string | null }>(
        `select policyname as pol, cmd, permissive, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'tmp_rascunho' order by 1`,
      );
      expect(rows.map((r) => r.pol)).toEqual([
        'paciente_sem_delete',
        'paciente_sem_insert',
        'paciente_sem_update',
        'publico_negado',
        'recepcao_negada',
        'tenant_isolation',
      ]);
      const negada = rows.find((r) => r.pol === 'recepcao_negada')!;
      expect({ cmd: negada.cmd, permissive: negada.permissive }).toEqual({ cmd: 'ALL', permissive: 'RESTRICTIVE' });
      expect(normalizar(negada.qual)).toBe(NEGA_RECEPCAO);
      expect(normalizar(negada.with_check)).toBe(NEGA_RECEPCAO);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('app_allow_recepcao troca a negada pelas recepcao_sem_* dos comandos não liberados; app_deny_recepcao volta a negar; comando inválido é recusado', async () => {
    const c = await ddl.pool.connect();
    const pols = async () =>
      (
        await c.query<{ pol: string; cmd: string }>(
          `select policyname as pol, cmd from pg_policies where schemaname = 'public' and tablename = 'tmp_rascunho' and policyname like 'recepcao%' order by 1`,
        )
      ).rows;
    try {
      await c.query('begin');
      await c.query('create table tmp_rascunho (id int primary key, tenant_id uuid not null)');
      await c.query(`select app_enable_tenant_rls('tmp_rascunho')`);
      await c.query(`select app_allow_recepcao('tmp_rascunho', 'select', 'update')`);
      expect(await pols()).toEqual([
        { pol: 'recepcao_sem_delete', cmd: 'DELETE' },
        { pol: 'recepcao_sem_insert', cmd: 'INSERT' },
      ]);
      await c.query(`select app_deny_recepcao('tmp_rascunho')`);
      expect(await pols()).toEqual([{ pol: 'recepcao_negada', cmd: 'ALL' }]);
      await c.query('savepoint s');
      await expect(c.query(`select app_allow_recepcao('tmp_rascunho', 'truncate')`)).rejects.toThrow(/comando inválido/);
      await c.query('rollback to savepoint s');
      await expect(c.query(`select app_allow_recepcao('tmp_rascunho', variadic '{}'::text[])`)).rejects.toThrow(/comando inválido/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('o laço da rls_recepcao nega as tabelas do schema public com tenant_isolation e não pega tabela de outro schema', async () => {
    const lacos = sqlDaCustom().match(/DO \$\$[\s\S]*?END \$\$;/g) ?? [];
    const laco = lacos.filter((b) => b.includes('app_deny_recepcao'));
    expect(laco).toHaveLength(1);
    expect(laco[0]).toContain(`schemaname = 'public'`);
    const c = await ddl.pool.connect();
    try {
      await c.query('begin');
      // as duas com a tenant_isolation à mão (sem app_enable_tenant_rls, que já nega): só o laço decide
      await c.query('create table public.tmp_laco (id int primary key, tenant_id uuid not null)');
      await c.query('alter table public.tmp_laco enable row level security');
      await c.query('create policy tenant_isolation on public.tmp_laco using (tenant_id = app_current_tenant())');
      await c.query('create schema tmp_fora');
      await c.query('create table tmp_fora.tmp_laco_fora (id int primary key, tenant_id uuid not null)');
      await c.query('alter table tmp_fora.tmp_laco_fora enable row level security');
      await c.query('create policy tenant_isolation on tmp_fora.tmp_laco_fora using (tenant_id = app_current_tenant())');
      await c.query(laco[0]);
      const { rows } = await c.query<{ esquema: string; tabela: string; pol: string }>(
        `select schemaname as esquema, tablename as tabela, policyname as pol from pg_policies
          where tablename in ('tmp_laco', 'tmp_laco_fora') and policyname like 'recepcao%' order by 1, 2`,
      );
      expect(rows).toEqual([{ esquema: 'public', tabela: 'tmp_laco', pol: 'recepcao_negada' }]);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('a custom não trava com SET LOCAL lock_timeout: o limite vem da conexão do migrador (RE-D64)', () => {
    const semComentarios = sqlDaCustom().replace(/--.*$/gm, '');
    expect(semComentarios).not.toMatch(/lock_timeout/i);
  });
});

describe('CHECKs de user e invites (spec §9.2)', () => {
  it('user aceita o papel recepcao só com tenant (user_recepcao_com_tenant); invites recepcao exige user e tenant, sem paciente', async () => {
    const c = await ddl.pool.connect();
    const tentar = async (q: string, params: unknown[]) => {
      await c.query('savepoint s');
      try {
        await c.query(q, params);
        await c.query('release savepoint s');
      } catch (e) {
        await c.query('rollback to savepoint s');
        throw e;
      }
    };
    try {
      await c.query('begin');
      const { rows: [t] } = await c.query(`insert into tenants (slug, nome_exibicao) values ($1, 'Rec') returning id`, [`rec-${randomUUID().slice(0, 8)}`]);
      const email = () => `rec-${randomUUID().slice(0, 8)}@teste.dev`;
      const inserirUser = `insert into "user" (id, name, email, app_role, tenant_id) values ($1, 'Rec', $2, 'recepcao', $3)`;
      await expect(tentar(inserirUser, [randomUUID(), email(), null])).rejects.toSatisfy(violaCheck('user_recepcao_com_tenant'));
      await expect(tentar(`insert into "user" (name, email, app_role) values ('X', $1, 'gerente')`, [email()])).rejects.toSatisfy(violaCheck('user_app_role_valido'));
      const u = randomUUID();
      await tentar(inserirUser, [u, email(), t.id]);
      const { rows: [col] } = await c.query(`select ultimo_acesso_em from "user" where id = $1`, [u]);
      expect(col).toEqual({ ultimo_acesso_em: null });
      const convite = `insert into invites (user_id, tenant_id, patient_id, tipo, token_hash, expira_em) values ($1, $2, $3, 'recepcao', $4, now() + interval '72 hours')`;
      await expect(tentar(convite, [u, null, null, randomUUID()])).rejects.toSatisfy(violaCheck('invites_alvo'));
      await expect(tentar(convite, [null, t.id, null, randomUUID()])).rejects.toSatisfy(violaCheck('invites_alvo'));
      await tentar(convite, [u, t.id, null, randomUUID()]);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('equipe_membros (spec §9.1)', () => {
  let T: TenantDeTeste;
  let T2: TenantDeTeste;
  const contaDeRecepcao = async (tenantId: string | null = T.tenantId) => {
    const id = randomUUID();
    await owner.pool.query(`insert into "user" (id, name, email, app_role, tenant_id) values ($1, 'Rec', $2, 'recepcao', $3)`, [
      id,
      `rec-${id.slice(0, 8)}@teste.dev`,
      tenantId,
    ]);
    return id;
  };
  /** `convidada_por` (e a desativação, com `desativada`) mandados pelo "módulo": o gatilho sobrescreve na sessão `nutri`. */
  const inserir = (tenantId: string, userId: string, desativada = false) =>
    desativada
      ? sql`insert into equipe_membros (tenant_id, user_id, papel, convidada_por, desativada_em, desativada_por)
            values (${tenantId}, ${userId}, 'recepcao', ${randomUUID()}, now(), ${randomUUID()}) returning *`
      : sql`insert into equipe_membros (tenant_id, user_id, papel, convidada_por) values (${tenantId}, ${userId}, 'recepcao', ${randomUUID()}) returning *`;
  const ler = async (id: unknown) => (await owner.pool.query('select * from equipe_membros where id = $1', [id])).rows[0] as Row;
  const ctxRecepcao = (userId: string): TenantContext => ({ tenantId: T.tenantId, role: 'recepcao', actorUserId: userId });

  beforeAll(async () => {
    T = await novoTenant(app.db);
    T2 = await novoTenant(app.db);
  });

  it('INSERT da nutricionista: convidada_por é ela e a desativação nasce nula, o que quer que o módulo mande', async () => {
    const u = await contaDeRecepcao();
    const [m] = await em(T.ctx, inserir(T.tenantId, u, true));
    expect(m).toMatchObject({ convidada_por: T.nutriId, desativada_em: null, desativada_por: null, financeiro: false, papel: 'recepcao' });
  });

  it('INSERT da nutricionista com conta de outro consultório, de papel nutri ou de paciente → 42501 do gatilho', async () => {
    await expect(em(T.ctx, inserir(T.tenantId, await contaDeRecepcao(T2.tenantId))), 'outro consultório').rejects.toSatisfy(doGatilho);
    await expect(em(T.ctx, inserir(T.tenantId, T.nutriId)), 'papel nutri').rejects.toSatisfy(doGatilho);
    const paciente = randomUUID();
    await owner.pool.query(`insert into "user" (id, name, email, app_role) values ($1, 'Pac', $2, 'paciente')`, [paciente, `pac-${paciente.slice(0, 8)}@teste.dev`]);
    await expect(em(T.ctx, inserir(T.tenantId, paciente)), 'paciente').rejects.toSatisfy(doGatilho);
  });

  it('UPDATE: id, tenant_id, user_id, papel, convidada_por e created_at fixos (42501); financeiro muda; UPDATE sem mudança passa', async () => {
    const [m] = await em(T.ctx, inserir(T.tenantId, await contaDeRecepcao()));
    const outra = await contaDeRecepcao();
    const fixas: [string, SQL][] = [
      ['id', sql`id = gen_random_uuid()`],
      ['tenant_id', sql`tenant_id = ${T2.tenantId}`],
      ['user_id', sql`user_id = ${outra}`],
      ['papel', sql`papel = 'gerente'`], // o BEFORE roda antes do CHECK equipe_membros_papel_valido
      ['convidada_por', sql`convidada_por = ${randomUUID()}`],
      ['created_at', sql`created_at = created_at - interval '1 day'`],
    ];
    for (const [coluna, set] of fixas) {
      await expect(em(T.ctx, sql`update equipe_membros set ${set} where id = ${m.id}`), coluna).rejects.toSatisfy(doGatilho);
    }
    expect(await em(T.ctx, sql`update equipe_membros set tenant_id = tenant_id where id = ${m.id} returning id`)).toHaveLength(1);
    const [f] = await em(T.ctx, sql`update equipe_membros set financeiro = true where id = ${m.id} returning financeiro`);
    expect(f.financeiro).toBe(true);
  });

  it('desativar grava desativada_por = a nutricionista da sessão; reativar limpa; desativação registrada não muda', async () => {
    const [m] = await em(T.ctx, inserir(T.tenantId, await contaDeRecepcao()));
    await em(T.ctx, sql`update equipe_membros set desativada_em = now(), desativada_por = ${randomUUID()} where id = ${m.id}`);
    const d = await ler(m.id);
    expect(d.desativada_por).toBe(T.nutriId);
    expect(d.desativada_em).not.toBeNull();
    await expect(em(T.ctx, sql`update equipe_membros set desativada_por = ${randomUUID()} where id = ${m.id}`)).rejects.toSatisfy(doGatilho);
    await expect(em(T.ctx, sql`update equipe_membros set desativada_em = now() + interval '1 day' where id = ${m.id}`)).rejects.toSatisfy(doGatilho);
    await em(T.ctx, sql`update equipe_membros set desativada_em = null where id = ${m.id}`);
    expect(await ler(m.id)).toMatchObject({ desativada_em: null, desativada_por: null });
  });

  it('worker e contexto vazio → 42501 do gatilho (o worker não grava a equipe)', async () => {
    const [m] = await em(T.ctx, inserir(T.tenantId, await contaDeRecepcao()));
    const worker: TenantContext = { tenantId: T.tenantId, role: 'worker' };
    await expect(em(worker, inserir(T.tenantId, await contaDeRecepcao()))).rejects.toSatisfy(doGatilho);
    await expect(em(worker, sql`update equipe_membros set financeiro = true where id = ${m.id}`)).rejects.toSatisfy(doGatilho);
    await expect(app.db.execute(inserir(T.tenantId, await contaDeRecepcao()))).rejects.toSatisfy(doGatilho);
  });

  it('recepção: INSERT → 42501 do gatilho; UPDATE e DELETE não alcançam a linha (0 linhas e permissão revogada); lê só a própria', async () => {
    const u = await contaDeRecepcao();
    const [m] = await em(T.ctx, inserir(T.tenantId, u));
    const [outra] = await em(T.ctx, inserir(T.tenantId, await contaDeRecepcao()));
    await expect(em(ctxRecepcao(u), inserir(T.tenantId, await contaDeRecepcao()))).rejects.toSatisfy(doGatilho);
    expect(await em(ctxRecepcao(u), sql`update equipe_membros set financeiro = true returning id`)).toEqual([]);
    expect((await ler(m.id)).financeiro).toBe(false);
    await expect(em(ctxRecepcao(u), sql`delete from equipe_membros`)).rejects.toSatisfy(permissaoNegada);
    expect((await em(ctxRecepcao(u), sql`select id from equipe_membros`)).map((r) => r.id)).toEqual([m.id]);
    expect((await em(T.ctx, sql`select id from equipe_membros where id in (${m.id}, ${outra.id})`)).length).toBe(2);
  });

  it('paciente e publico: a RLS da própria tabela recusa (o gatilho deixa passar)', async () => {
    const paciente: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: randomUUID(), actorUserId: randomUUID() };
    const publico: TenantContext = { tenantId: T.tenantId, role: 'publico' };
    await expect(em(paciente, inserir(T.tenantId, await contaDeRecepcao()))).rejects.toSatisfy(rlsDe('equipe_membros'));
    await expect(em(publico, inserir(T.tenantId, await contaDeRecepcao()))).rejects.toSatisfy(rlsDe('equipe_membros'));
  });

  it('a nutricionista não apaga (DELETE revogado, RE-D28); índice parcial das ativas existe', async () => {
    await expect(em(T.ctx, sql`delete from equipe_membros`)).rejects.toSatisfy(permissaoNegada);
    const { rows } = await owner.pool.query<{ def: string }>(`select indexdef as def from pg_indexes where indexname = 'equipe_membros_ativas_idx'`);
    expect(rows[0]?.def).toMatch(/\(tenant_id\) WHERE \(desativada_em IS NULL\)/);
  });
});
