import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { patientCadastro } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { nomeSocialNaTransacao } from './nome-social';
import { nomeSocialParaMascara } from './nome-social-worker';

// Plano 18 (RN-282, D19): o nome social só para a máscara — na transação de quem já está na equipe ou no worker, e no
// contexto worker próprio para a IA Nutri (cujo contexto é montado na sessão de paciente sem login, que não lê a tabela)
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

async function comNomeSocial(nomeSocial: string | null) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  if (nomeSocial) await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: p.id, nomeSocial }), app.db);
  return { T, p };
}

describe('nomeSocialNaTransacao', () => {
  it('na transação da equipe e na do worker devolve o nome social; sem linha (ou sem nome social), null', async () => {
    const { T, p } = await comNomeSocial('Joana Silva');
    expect(await withTenant(T.ctx, (tx) => nomeSocialNaTransacao(tx, p.id), app.db)).toBe('Joana Silva');
    expect(await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => nomeSocialNaTransacao(tx, p.id), app.db)).toBe('Joana Silva');
    const sem = await comNomeSocial(null);
    expect(await withTenant(sem.T.ctx, (tx) => nomeSocialNaTransacao(tx, sem.p.id), app.db)).toBeNull();
    await withTenant(sem.T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: sem.T.tenantId, patientId: sem.p.id, ocupacao: 'Professora' }), app.db);
    expect(await withTenant(sem.T.ctx, (tx) => nomeSocialNaTransacao(tx, sem.p.id), app.db)).toBeNull();
  });

  it('na sessão de paciente sem login recusa com erro (em vez de devolver null e deixar o nome social sem máscara)', async () => {
    const T = await novoTenant(app.db);
    const { paciente: p, userId } = await pacienteComConta(app.db, T);
    await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: p.id, nomeSocial: 'Joana Silva' }), app.db);
    // a sessão de paciente sem login no banco: papel paciente com app.user_id vazio (a política nega a tabela a ela)
    const semLogin = withTenant(
      ctxPaciente(T.tenantId, p.id, userId),
      async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true)`);
        return nomeSocialNaTransacao(tx, p.id);
      },
      app.db,
    );
    await expect(semLogin).rejects.toThrow(/nome social/);
    // o paciente com login também não é quem monta o que vai à IA
    await expect(withTenant(ctxPaciente(T.tenantId, p.id, userId), (tx) => nomeSocialNaTransacao(tx, p.id), app.db)).rejects.toThrow(/nome social/);
  });

  it('o erro não leva o nome social nem o id do paciente', async () => {
    const T = await novoTenant(app.db);
    const { paciente: p, userId } = await pacienteComConta(app.db, T);
    const erro = await withTenant(ctxPaciente(T.tenantId, p.id, userId), (tx) => nomeSocialNaTransacao(tx, p.id), app.db).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).not.toContain(p.id);
  });
});

describe('nomeSocialParaMascara (contexto worker próprio)', () => {
  it('lê o nome social do paciente do tenant; paciente de outro tenant → null', async () => {
    const { T, p } = await comNomeSocial('Joana Silva');
    expect(await nomeSocialParaMascara(app.db, T.tenantId, p.id)).toBe('Joana Silva');
    const outro = await novoTenant(app.db);
    expect(await nomeSocialParaMascara(app.db, outro.tenantId, p.id)).toBeNull();
  });

  it('não grava nada no audit_log (só leitura para a máscara, sem auditRead)', async () => {
    const { T, p } = await comNomeSocial('Joana Silva');
    const contar = () =>
      withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_log where patient_id = ${p.id}`), app.db);
    const antes = (await contar()).rows[0].n;
    await nomeSocialParaMascara(app.db, T.tenantId, p.id);
    expect((await contar()).rows[0].n).toBe(antes);
  });
});
