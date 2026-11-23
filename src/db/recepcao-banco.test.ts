import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { bancoProprioParaDdl } from '../../test/ddl';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../test/pacientes';
import { TIPOS_DA_AGENDA, TIPOS_FORA_DA_RECEPCAO } from '@/modules/notificacoes/tipos';
import { withConta, withTenant, type TenantContext } from './tenant';

/**
 * Plano 26 (spec §9.1 a §9.3; RN-498, RN-505 a RN-508): o banco da recepção sem o módulo — negação por padrão
 * (app_deny_recepcao, app_allow_recepcao, app_enable_tenant_rls e o laço), a tabela equipe_membros com o gatilho
 * equipe_membros_regras e os CHECKs novos de `user` e `invites` (blocos 1 e 2, T4); as liberações da §4.3 e as condições
 * recepcao_cond_* — paciente visível, Financeiro, notificações da agenda — e o fin_lancamentos_regras refeito (bloco 3, T5a).
 * Os gatilhos de colunas e as funções SECURITY DEFINER (T5b) têm testes próprios.
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
    // linha de outro consultório: a RLS recusa, sem o gatilho ler a conta — a mensagem é a mesma para a recepção de T2 e para
    // qualquer outro user_id (não revela de quem é a conta; revisão da T4)
    await expect(em(T.ctx, inserir(T2.tenantId, await contaDeRecepcao(T2.tenantId))), 'recepção de T2 na linha de T2').rejects.toSatisfy(rlsDe('equipe_membros'));
    await expect(em(T.ctx, inserir(T2.tenantId, T.nutriId)), 'nutri na linha de T2').rejects.toSatisfy(rlsDe('equipe_membros'));
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
    // o módulo manda uma data qualquer: vale o relógio do banco (revisão da T4)
    await em(T.ctx, sql`update equipe_membros set desativada_em = now() + interval '30 days', desativada_por = ${randomUUID()} where id = ${m.id}`);
    const d = await ler(m.id);
    expect(d.desativada_por).toBe(T.nutriId);
    const { rows: [agora] } = await owner.pool.query<{ ok: boolean }>(
      `select desativada_em between clock_timestamp() - interval '1 minute' and clock_timestamp() as ok from equipe_membros where id = $1`,
      [m.id],
    );
    expect(agora.ok).toBe(true);
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

  it('staff_only: paciente, publico e conta não leem equipe_membros (0 linhas), com a linha lá (STAFF_ONLY, revisão da T4)', async () => {
    const [m] = await em(T.ctx, inserir(T.tenantId, await contaDeRecepcao()));
    expect((await owner.pool.query('select 1 from equipe_membros where id = $1', [m.id])).rowCount).toBe(1); // controle positivo
    expect(await em(T.ctx, sql`select id from equipe_membros where id = ${m.id}`)).toHaveLength(1); // a nutricionista vê
    const paciente: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: randomUUID(), actorUserId: randomUUID() };
    const semConta: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: randomUUID(), semConta: true };
    const publico: TenantContext = { tenantId: T.tenantId, role: 'publico' };
    for (const ctx of [paciente, semConta, publico]) expect(await em(ctx, sql`select id from equipe_membros`), ctx.role).toEqual([]);
    const conta = await withConta(T.nutriId, (tx) => tx.execute(sql`select id from equipe_membros`), app.db);
    expect(conta.rows).toEqual([]);
  });

  it('a nutricionista não apaga (DELETE revogado, RE-D28); índice parcial das ativas existe', async () => {
    await expect(em(T.ctx, sql`delete from equipe_membros`)).rejects.toSatisfy(permissaoNegada);
    const { rows } = await owner.pool.query<{ def: string }>(`select indexdef as def from pg_indexes where indexname = 'equipe_membros_ativas_idx'`);
    expect(rows[0]?.def).toMatch(/\(tenant_id\) WHERE \(desativada_em IS NULL\)/);
  });
});

/**
 * Bloco 3 (T5a): liberações da §4.3 e condições. Um consultório com a nutricionista, três pacientes — P visível, PB bloqueado
 * e PA anonimizado (arquivado com anonimizado_em, para provar a cláusula do anonimizado sozinha) — e as contas da recepção:
 * R1 com a permissão do Financeiro, R0 sem ela.
 */
describe('liberações e condições da recepção (bloco 3, RN-506 a RN-508)', () => {
  let T: TenantDeTeste;
  let P: string;
  let PB: string;
  let PA: string;
  let R1: string;
  let R0: string;
  let entrada: string;
  let saida: string;
  type Consulta = { id: string; inicio: Date };
  /** Uma consulta por paciente, criada pela nutricionista antes de esconder dois (para a notificação e o UPDATE). */
  const consultaDe: Record<string, Consulta> = {};
  let seq = 0;
  const hora = () => sql`'2031-03-03T12:00:00Z'::timestamptz + ${++seq} * interval '2 hours'`;
  const worker = (): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });
  const rec = (u: string): TenantContext => ({ tenantId: T.tenantId, role: 'recepcao', actorUserId: u, ip: '203.0.113.36' });

  const contaDeRecepcao = async (financeiro: boolean) => {
    const id = randomUUID();
    await owner.pool.query(`insert into "user" (id, name, email, app_role, tenant_id) values ($1, 'Rec', $2, 'recepcao', $3)`, [
      id,
      `rec-${id.slice(0, 8)}@teste.dev`,
      T.tenantId,
    ]);
    await em(T.ctx, sql`insert into equipe_membros (tenant_id, user_id, papel, convidada_por, financeiro) values (${T.tenantId}, ${id}, 'recepcao', ${T.nutriId}, ${financeiro})`);
    return id;
  };
  const consulta = (paciente: string) => {
    const h = hora();
    return sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem)
               values (${T.tenantId}, ${paciente}, ${h}, ${h} + interval '1 hour', 'presencial', 'nutri') returning id, inicio`;
  };
  const marcar = async (ctx: TenantContext, paciente: string): Promise<Consulta> => {
    const [r] = await em(ctx, consulta(paciente));
    return { id: r.id as string, inicio: new Date(r.inicio as string) };
  };
  // valores explícitos (sem subconsulta em appointments: para a recepção, a consulta do escondido viria vazia e o INSERT não
  // gravaria nada, sem recusa nenhuma)
  const notificacao = (paciente: string, c: Consulta | null, tipo: string, canal = 'email') =>
    sql`insert into notifications (tenant_id, patient_id, appointment_id, inicio_consulta, canal, tipo, agendada_para)
        values (${T.tenantId}, ${paciente}, ${c?.id ?? null}, ${c ? c.inicio.toISOString() : null}::timestamptz, ${canal}, ${tipo}, now()) returning id`;
  const lancamento = (paciente: string | null, tipo: 'entrada' | 'saida' = 'entrada') =>
    sql`insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, patient_id, criado_por)
        values (${T.tenantId}, ${tipo}, ${tipo === 'entrada' ? entrada : saida}, 25000, '2026-11-10', ${paciente}, ${randomUUID()}) returning *`;
  const cadastro = (paciente: string) => sql`insert into patient_cadastro (tenant_id, patient_id, estado_civil) values (${T.tenantId}, ${paciente}, 'casado') returning id`;

  beforeAll(async () => {
    T = await novoTenant(app.db);
    P = (await novoPaciente(app.db, T.ctx)).id;
    PB = (await novoPaciente(app.db, T.ctx)).id;
    PA = (await novoPaciente(app.db, T.ctx)).id;
    await em(T.ctx, sql`insert into fin_configuracoes (tenant_id, saldo_inicial_centavos, saldo_inicial_em) values (${T.tenantId}, 0, '2026-11-01')`);
    entrada = (await em(T.ctx, sql`insert into fin_categorias (tenant_id, tipo, nome) values (${T.tenantId}, 'entrada', 'Outras entradas') returning id`))[0].id as string;
    saida = (await em(T.ctx, sql`insert into fin_categorias (tenant_id, tipo, nome) values (${T.tenantId}, 'saida', 'Aluguel') returning id`))[0].id as string;
    // o que a recepção não pode alcançar existe: a nutricionista grava tudo dos três pacientes antes de esconder dois
    for (const p of [P, PB, PA]) {
      consultaDe[p] = await marcar(T.ctx, p);
      await em(T.ctx, notificacao(p, consultaDe[p], 'lembrete_24h'));
      await em(T.ctx, cadastro(p));
      await em(T.ctx, lancamento(p));
    }
    await em(T.ctx, notificacao(P, null, 'plano_novo', 'push'));
    await em(worker(), sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${PB}`);
    await em(worker(), sql`update patients set status = 'arquivado', anonimizado_em = now() where id = ${PA}`);
    R1 = await contaDeRecepcao(true);
    R0 = await contaDeRecepcao(false);
  });

  describe('paciente escondido (RE-D40, RN-508)', () => {
    it('a recepção não lê o paciente bloqueado nem o anonimizado, nem as linhas filhas deles; a nutricionista lê tudo, como hoje', async () => {
      expect((await em(rec(R1), sql`select id from patients where id in (${P}, ${PB}, ${PA})`)).map((r) => r.id)).toEqual([P]);
      for (const t of ['appointments', 'notifications', 'patient_cadastro', 'fin_lancamentos']) {
        const id = sql.identifier(t);
        const comoRec = await em(rec(R1), sql`select patient_id from ${id} where patient_id in (${P}, ${PB}, ${PA})`);
        expect(new Set(comoRec.map((r) => r.patient_id)), t).toEqual(new Set([P])); // a de P aparece: é a condição que esconde
        const comoNutri = await em(T.ctx, sql`select patient_id from ${id} where patient_id in (${P}, ${PB}, ${PA})`);
        expect(new Set(comoNutri.map((r) => r.patient_id)), t).toEqual(new Set([P, PB, PA]));
      }
    });

    it('INSERT com o id do escondido: appointments, notifications e patient_cadastro → RLS; fin_lancamentos → 42501 do gatilho (não achado)', async () => {
      for (const p of [PB, PA]) {
        await expect(em(rec(R1), consulta(p)), `appointments ${p}`).rejects.toSatisfy(rlsDe('appointments'));
        await expect(em(rec(R1), notificacao(p, consultaDe[p], 'consulta_marcada')), `notifications ${p}`).rejects.toSatisfy(rlsDe('notifications'));
        await expect(em(rec(R1), cadastro(p)), `patient_cadastro ${p}`).rejects.toSatisfy(rlsDe('patient_cadastro'));
        // falha fechada (RN-506): o gatilho lê o paciente pela RLS da recepção, não acha e recusa — nunca "não bloqueado"
        await expect(em(rec(R1), lancamento(p)), `fin_lancamentos ${p}`).rejects.toSatisfy(
          (e: unknown) => doGatilho(e) && /paciente não encontrado/.test(erro(e).message),
        );
      }
      // a nutricionista, no mesmo cenário, recebe a recusa de sempre do gatilho (RN-315 do Plano 20)
      await expect(em(T.ctx, lancamento(PB))).rejects.toSatisfy((e: unknown) => doGatilho(e) && /bloqueado ou anonimizado/.test(erro(e).message));
    });

    it('UPDATE das linhas do escondido → 0 linhas; a recepção não leva o paciente visível a bloqueado (WITH CHECK)', async () => {
      for (const p of [PB, PA]) {
        expect(await em(rec(R1), sql`update patients set nome = nome where id = ${p} returning id`), `patients ${p}`).toEqual([]);
        expect(await em(rec(R1), sql`update appointments set status = 'confirmada' where id = ${consultaDe[p].id} returning id`), `appointments ${p}`).toEqual([]);
        expect(await em(rec(R1), sql`update notifications set status = 'ignorada', motivo_ignorada = 'paciente_inativo' where patient_id = ${p} returning id`), `notifications ${p}`).toEqual([]);
        expect(await em(rec(R1), sql`update patient_cadastro set estado_civil = 'solteiro' where patient_id = ${p} returning id`), `patient_cadastro ${p}`).toEqual([]);
        expect(await em(rec(R1), sql`update fin_lancamentos set valor_centavos = 1 where patient_id = ${p} returning id`), `fin_lancamentos ${p}`).toEqual([]);
      }
      const { rows } = await owner.pool.query(`select status from appointments where id = any($1::uuid[])`, [[consultaDe[PB].id, consultaDe[PA].id]]);
      expect(rows.map((r) => r.status)).toEqual(['agendada', 'agendada']);
      await expect(em(rec(R1), sql`update patients set status = 'bloqueado', bloqueado_em = now() where id = ${P}`)).rejects.toSatisfy(rlsDe('patients'));
      // a nutricionista continua alcançando a consulta do bloqueado, como hoje
      expect(await em(T.ctx, sql`update appointments set status = status where id = ${consultaDe[PB].id} returning id`)).toHaveLength(1);
    });

    it('a recepção grava o paciente visível: consulta, cadastro e paciente novo', async () => {
      const novo = randomUUID();
      await em(rec(R1), sql`insert into patients (id, tenant_id, nome, data_nascimento, sexo, email) values (${novo}, ${T.tenantId}, 'Bia', '1990-01-01', 'F', ${`bia-${novo.slice(0, 8)}@ex.com`})`);
      expect(await em(rec(R1), consulta(novo))).toHaveLength(1);
      expect(await em(rec(R1), cadastro(novo))).toHaveLength(1);
      expect(await em(rec(R1), sql`update appointments set status = 'confirmada' where id = ${consultaDe[P].id} returning id`)).toHaveLength(1);
    });
  });

  describe('notificações da agenda (RN-507)', () => {
    it('a recepção lê e grava só os tipos da agenda; os outros tipos (plano_novo, documento_novo, exame_revisado…) não lê nem grava', async () => {
      expect((await owner.pool.query(`select 1 from notifications where patient_id = $1 and tipo = 'plano_novo'`, [P])).rowCount).toBe(1); // a linha existe
      expect(await em(rec(R1), sql`select id from notifications where tipo = 'plano_novo'`)).toEqual([]);
      expect(await em(rec(R1), sql`update notifications set status = 'ignorada', motivo_ignorada = 'paciente_inativo' where tipo = 'plano_novo' returning id`)).toEqual([]);
      const c = await marcar(rec(R1), P);
      for (const tipo of TIPOS_FORA_DA_RECEPCAO) {
        await expect(em(rec(R1), notificacao(P, ehDaConsulta(tipo) ? c : null, tipo)), tipo).rejects.toSatisfy(rlsDe('notifications'));
      }
      for (const tipo of TIPOS_DA_AGENDA) expect(await em(rec(R1), notificacao(P, c, tipo)), tipo).toHaveLength(1);
      // trocar o tipo de uma linha da agenda para um clínico: o WITH CHECK recusa
      await expect(em(rec(R1), sql`update notifications set tipo = 'plano_novo' where appointment_id = ${c.id} and tipo = 'consulta_marcada'`)).rejects.toSatisfy(
        rlsDe('notifications'),
      );
      expect((await em(rec(R1), sql`select tipo from notifications where appointment_id = ${c.id}`)).map((r) => r.tipo).sort()).toEqual([...TIPOS_DA_AGENDA].sort());
    });
  });

  describe('Financeiro com a permissão (RN-506)', () => {
    const tabelas = ['fin_configuracoes', 'fin_categorias', 'fin_lancamentos'];

    it('sem a permissão: 0 linhas nas três tabelas e INSERT recusado pela RLS', async () => {
      for (const t of tabelas) {
        expect((await owner.pool.query(`select 1 from ${t} where tenant_id = $1`, [T.tenantId])).rowCount, t).toBeGreaterThan(0);
        expect(await em(rec(R0), sql`select 1 from ${sql.identifier(t)}`), t).toEqual([]);
      }
      await expect(em(rec(R0), lancamento(P))).rejects.toSatisfy(rlsDe('fin_lancamentos'));
      await expect(em(rec(R0), lancamento(null, 'saida'))).rejects.toSatisfy(rlsDe('fin_lancamentos'));
    });

    it('com a permissão: lê, lança (criado_por = a recepção), recebe e cancela (cancelado_por = a recepção); não grava configuração nem categoria', async () => {
      for (const t of tabelas) expect((await em(rec(R1), sql`select 1 from ${sql.identifier(t)}`)).length, t).toBeGreaterThan(0);
      const [l] = await em(rec(R1), lancamento(P));
      expect(l.criado_por).toBe(R1);
      const [s] = await em(rec(R1), lancamento(null, 'saida'));
      expect(s.criado_por).toBe(R1);
      const [pago] = await em(rec(R1), sql`update fin_lancamentos set pago_em = '2026-11-05', forma_pagamento = 'pix' where id = ${l.id} returning pago_em`);
      expect(pago.pago_em).toBeTruthy();
      const [c] = await em(rec(R1), sql`update fin_lancamentos set cancelado_em = now(), cancelado_por = ${randomUUID()}, motivo_cancelamento = 'Desistência' where id = ${s.id} returning cancelado_por`);
      expect(c.cancelado_por).toBe(R1);
      await expect(em(rec(R1), sql`insert into fin_categorias (tenant_id, tipo, nome) values (${T.tenantId}, 'saida', 'Outra')`)).rejects.toSatisfy(rlsDe('fin_categorias'));
      expect(await em(rec(R1), sql`update fin_configuracoes set saldo_inicial_centavos = 1 returning tenant_id`)).toEqual([]);
      expect(await em(rec(R1), sql`update fin_categorias set nome = nome || '!' returning id`)).toEqual([]);
    });

    it('desativada: 0 linhas, mesmo com a permissão marcada', async () => {
      const R = await contaDeRecepcao(true);
      expect((await em(rec(R), sql`select 1 from fin_lancamentos`)).length).toBeGreaterThan(0); // controle: ativa, lê
      await em(T.ctx, sql`update equipe_membros set desativada_em = now() where user_id = ${R}`);
      for (const t of tabelas) expect(await em(rec(R), sql`select 1 from ${sql.identifier(t)}`), t).toEqual([]);
      await expect(em(rec(R), lancamento(P))).rejects.toSatisfy(rlsDe('fin_lancamentos'));
    });

    it('a permissão é avaliada uma vez por consulta (InitPlan), não por linha', async () => {
      const plano = (await em(rec(R1), sql`explain (verbose, costs off) select id from fin_lancamentos`)).map((r) => String(r['QUERY PLAN']));
      const texto = plano.join('\n');
      expect(texto).toMatch(/InitPlan/);
      expect(texto).toMatch(/app_recepcao_tem_financeiro\(\)/);
      // a função só aparece no InitPlan: no filtro da varredura, a condição é o parâmetro dele
      for (const linha of plano.filter((l) => /Filter:/.test(l))) expect(linha).not.toMatch(/app_recepcao_tem_financeiro\(/);
    });
  });

  it('public_booking_requests fica negada à recepção (RE-D59): 0 linhas e nenhuma escrita', async () => {
    const pedido = sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, modalidade, termo_versao, expira_em)
        values (gen_random_uuid(), ${T.tenantId}, ${randomUUID()}, 'x', ${`ped-${randomUUID().slice(0, 8)}@teste.dev`}, 'Pedido', '2031-01-01T12:00:00Z', 'presencial', 't', now() + interval '10 minutes')`;
    await em(T.ctx, pedido);
    expect((await owner.pool.query('select 1 from public_booking_requests where tenant_id = $1', [T.tenantId])).rowCount).toBeGreaterThan(0);
    expect(await em(rec(R1), sql`select id from public_booking_requests`)).toEqual([]);
    expect(await em(rec(R1), sql`update public_booking_requests set nome = nome returning id`)).toEqual([]);
    await expect(em(rec(R1), pedido)).rejects.toSatisfy(rlsDe('public_booking_requests'));
  });
});

/** Tipos de notificação ligados a uma consulta (appointment_id e inicio_consulta preenchidos) — os da agenda e o convite não. */
const ehDaConsulta = (tipo: string) => (TIPOS_DA_AGENDA as readonly string[]).includes(tipo);
