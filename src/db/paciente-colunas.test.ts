import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { novoConteudo } from '../../test/conteudos';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { pacienteComConta } from '../../test/portal';
import { user } from './schema';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const codigo = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
const negado = (e: unknown) => codigo(e) === '42501';

async function cenario() {
  const T = await novoTenant(app.db);
  const { paciente, userId } = await pacienteComConta(app.db, T, { telefoneE164: '+5511912345678' });
  const ctx: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: paciente.id, actorUserId: userId, ip: '203.0.113.9' };
  const comoPaciente = (s: ReturnType<typeof sql>) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, paciente, userId, comoPaciente };
}

describe('B-4: o que a sessão de paciente altera em patients (0085)', () => {
  it('opt-in (origem paciente) e opt-out do WhatsApp passam', async () => {
    const { paciente, comoPaciente } = await cenario();
    await comoPaciente(sql`update patients set whatsapp_optin_em = now(), whatsapp_optin_origem = 'paciente', whatsapp_optout_em = null, updated_at = now() where id = ${paciente.id}`);
    await comoPaciente(sql`update patients set whatsapp_optout_em = now(), updated_at = now() where id = ${paciente.id}`);
  });

  it.each([
    ['status', "status = 'arquivado'"],
    ['anonimizar_apos', "anonimizar_apos = '2099-01-01'"],
    ['nome', "nome = 'Outro Nome'"],
    ['opt-in com origem nutri', "whatsapp_optin_em = now(), whatsapp_optin_origem = 'nutri'"],
  ])('%s → 42501', async (_n, set) => {
    const { paciente, comoPaciente } = await cenario();
    await expect(comoPaciente(sql.raw(`update patients set ${set} where id = '${paciente.id}'`))).rejects.toSatisfy(negado);
  });

  it('user_id: só de nulo para a própria conta; nunca troca a conta já ligada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const [eu, outro] = [randomUUID(), randomUUID()];
    for (const id of [eu, outro]) await app.db.insert(user).values({ id, name: 'Conta', email: `c-${id.slice(0, 8)}@teste.dev`, appRole: 'paciente' });
    const ctx: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: p.id, actorUserId: eu };
    await expect(withTenant(ctx, (tx) => tx.execute(sql`update patients set user_id = ${outro} where id = ${p.id}`), app.db)).rejects.toSatisfy(negado);
    await withTenant(ctx, (tx) => tx.execute(sql`update patients set user_id = ${eu}, updated_at = now() where id = ${p.id}`), app.db);
    await expect(withTenant(ctx, (tx) => tx.execute(sql`update patients set user_id = null where id = ${p.id}`), app.db)).rejects.toSatisfy(negado);
  });

  it('a nutricionista continua alterando qualquer coluna', async () => {
    const { T, paciente } = await cenario();
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set nome = 'Ana S.', status = 'arquivado' where id = ${paciente.id}`), app.db);
  });
});

describe('B-4: data_exports na sessão de paciente', () => {
  it('só pendente → falhou; pronta ou outro caminho → 42501', async () => {
    const { T, paciente, comoPaciente } = await cenario();
    const novo = async () =>
      (await withTenant(T.ctx, (tx) => tx.execute(sql`insert into data_exports (tenant_id, patient_id, escopo) values (${T.tenantId}, ${paciente.id}, 'titular') returning id`), app.db)).rows[0].id as string;
    const a = await novo();
    await comoPaciente(sql`update data_exports set status = 'falhou', updated_at = now() where id = ${a}`);
    const b = await novo();
    await expect(comoPaciente(sql`update data_exports set status = 'pronta', expira_em = now() where id = ${b}`)).rejects.toSatisfy(negado);
    await expect(comoPaciente(sql`update data_exports set escopo = 'equipe' where id = ${b}`)).rejects.toSatisfy(negado);
  });
});

describe('B-6: audit_log não é legível pela sessão de paciente', () => {
  it('0 linhas, mesmo com linhas do próprio paciente; o INSERT (auditRead/gatilho) continua', async () => {
    const { T, paciente, comoPaciente } = await cenario();
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set nome = 'Ana Souza' where id = ${paciente.id}`), app.db); // gera linha auditada
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from audit_log where patient_id = ${paciente.id}`), app.db);
    expect(n.rows[0].n).toBeGreaterThan(0);
    expect((await comoPaciente(sql`select count(*)::int as n from audit_log`)).rows[0].n).toBe(0);
    await comoPaciente(sql`update patients set whatsapp_optout_em = now() where id = ${paciente.id}`); // o gatilho grava como paciente
  });
});

describe('N38: capa de conteúdo só pela audiência (paciente_arquivos)', () => {
  it('capa de conteúdo da audiência é visível; de conteúdo para outro paciente, não; logo do consultório, sim', async () => {
    const { T, paciente, comoPaciente } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const capa = (n: string) => `${T.tenantId}/capa/${n}.jpg`;
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values
          (${T.tenantId}, 'capa', ${capa('minha')}, 10, 'image/jpeg'),
          (${T.tenantId}, 'capa', ${capa('dela')}, 10, 'image/jpeg'),
          (${T.tenantId}, 'logo', ${`${T.tenantId}/logo/l.png`}, 10, 'image/png')`),
      app.db,
    );
    await novoConteudo(app.db, T, { capaPath: capa('minha'), visibilidade: 'pacientes', pacientes: [paciente.id] });
    await novoConteudo(app.db, T, { capaPath: capa('dela'), visibilidade: 'pacientes', pacientes: [outro.id] });
    const vistos = (await comoPaciente(sql`select caminho from stored_files where tipo in ('capa', 'logo') order by caminho`)).rows.map((r) => r.caminho);
    expect(vistos).toEqual([capa('minha'), `${T.tenantId}/logo/l.png`].sort());
  });
});
