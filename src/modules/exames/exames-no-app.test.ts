import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { auditLog, exams, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { criarExame, ExameError } from '@/modules/pacientes/exames';
import { MSG_EXAMES } from './constantes';
import { editarExame, exameParaEditar, mostrarNoApp, retirarDoApp } from './edicao';

/**
 * Plano 22 (T6, US-375, RN-385, EP-D22, EP-D45; Review Focus 1 e 3): "Mostrar no app" e "Retirar do app". Só a coluna
 * `mostrar_no_app_em` muda (nunca `updated_at`: o resumo da IA não fica desatualizado e uma edição aberta não é recusada);
 * cada liberação e retirada grava o `recordAudit` próprio, com o ator da sessão, ao lado do `alterar` do gatilho de `exams`.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const deps = { db: app.db };

async function cenario(o: { comConta?: boolean } = {}) {
  const T = await novoTenant(app.db);
  const p = o.comConta ? (await pacienteComConta(app.db, T)).paciente : await novoPaciente(app.db, T.ctx);
  const exameId = await criarExame(
    T.ctx,
    T.tenant,
    p.id,
    { titulo: 'Rotina', data: '2026-09-01', valores: [{ nome: 'Glicemia de jejum', valor: '95', unidade: 'mg/dL', referencia: '70 a 99' }], arquivo: null },
    { db: app.db, now: new Date('2026-09-02T12:00:00Z') },
  );
  return { T, p, exameId };
}
const exame = (T: TenantDeTeste, id: string) => withTenant(T.ctx, async (tx) => (await tx.select().from(exams).where(eq(exams.id, id)))[0], app.db);
const logDo = (T: TenantDeTeste, id: string) =>
  withTenant(
    T.ctx,
    (tx) =>
      tx
        .select({ acao: auditLog.acao, entidade: auditLog.entidade, actor: auditLog.actorUserId, patientId: auditLog.patientId, entidadeId: auditLog.entidadeId })
        .from(auditLog)
        .where(eq(auditLog.entidadeId, id))
        .orderBy(auditLog.criadoEm, auditLog.id),
    app.db,
  );
const doModulo = (linhas: Awaited<ReturnType<typeof logDo>>) => linhas.filter((l) => l.entidade.startsWith('exame_no_app_'));

describe('mostrarNoApp / retirarDoApp (Plano 22, T6, RN-385)', () => {
  it('liberar, retirar e liberar de novo: três eventos distinguíveis, cada um com o ator da sessão; a coluna liga e desliga', async () => {
    const { T, p, exameId } = await cenario();
    await mostrarNoApp(T.ctx, p.id, exameId, deps);
    expect((await exame(T, exameId)).mostrarNoAppEm).toBeInstanceOf(Date);
    await retirarDoApp(T.ctx, p.id, exameId, deps);
    expect((await exame(T, exameId)).mostrarNoAppEm).toBeNull();
    await mostrarNoApp(T.ctx, p.id, exameId, deps);
    expect((await exame(T, exameId)).mostrarNoAppEm).toBeInstanceOf(Date);
    const eventos = doModulo(await logDo(T, exameId));
    expect(eventos.map((e) => e.entidade)).toEqual(['exame_no_app_liberado', 'exame_no_app_retirado', 'exame_no_app_liberado']);
    for (const e of eventos) expect(e).toMatchObject({ acao: 'alterar', actor: T.nutriId, patientId: p.id, entidadeId: exameId });
  });

  it('cada liberação deixa as duas linhas: o `alterar`/`exames` do gatilho e o `alterar`/`exame_no_app_liberado` do módulo, com o mesmo ator e o mesmo exame (M5)', async () => {
    const { T, p, exameId } = await cenario();
    const antes = (await logDo(T, exameId)).length;
    await mostrarNoApp(T.ctx, p.id, exameId, deps);
    const novas = (await logDo(T, exameId)).slice(antes);
    expect(novas.map((l) => [l.acao, l.entidade]).sort()).toEqual([
      ['alterar', 'exame_no_app_liberado'],
      ['alterar', 'exames'],
    ]);
    for (const l of novas) expect(l).toMatchObject({ actor: T.nutriId, entidadeId: exameId, patientId: p.id });
  });

  it('Review Focus 3: `updated_at` igual antes e depois de liberar e de retirar; uma edição com o `lidoEm` de antes da liberação passa', async () => {
    const { T, p, exameId } = await cenario();
    const aberto = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
    const antes = (await exame(T, exameId)).updatedAt;
    await mostrarNoApp(T.ctx, p.id, exameId, deps);
    expect((await exame(T, exameId)).updatedAt.getTime()).toBe(antes.getTime());
    // o banco guarda microssegundos: compara também no próprio banco, sem passar pelo Date do JS
    const igual = await withTenant(T.ctx, (tx) => tx.select({ id: exams.id }).from(exams).where(and(eq(exams.id, exameId), eq(exams.updatedAt, antes))), app.db);
    expect(igual).toHaveLength(1);
    await retirarDoApp(T.ctx, p.id, exameId, deps);
    expect((await exame(T, exameId)).updatedAt.getTime()).toBe(antes.getTime());
    await mostrarNoApp(T.ctx, p.id, exameId, deps);
    const linhas = aberto.valores.map((v, i) => ({ origem: i, nome: v.nome, valor: '96', unidade: v.unidade ?? '', referencia: v.referencia ?? '', refMin: '', refMax: '' }));
    await editarExame(T.ctx, T.tenant, p.id, exameId, { titulo: 'Rotina', data: '2026-09-01', linhas, justificativa: 'Valor digitado errado', lidoEm: aberto.updatedAt }, deps);
    expect((await exame(T, exameId)).valores[0].valor).toBe(96);
    // a edição não retira o exame do app
    expect((await exame(T, exameId)).mostrarNoAppEm).toBeInstanceOf(Date);
  });

  it('liberar o já liberado e retirar o que não está: sem UPDATE e sem evento', async () => {
    const { T, p, exameId } = await cenario();
    await retirarDoApp(T.ctx, p.id, exameId, deps); // nunca liberado
    expect(doModulo(await logDo(T, exameId))).toEqual([]);
    const semUpdate = (await logDo(T, exameId)).filter((l) => l.acao === 'alterar').length;
    expect(semUpdate).toBe(0);
    await mostrarNoApp(T.ctx, p.id, exameId, deps);
    const primeira = (await exame(T, exameId)).mostrarNoAppEm;
    await mostrarNoApp(T.ctx, p.id, exameId, deps);
    expect((await exame(T, exameId)).mostrarNoAppEm).toEqual(primeira); // a data da primeira liberação fica
    expect(doModulo(await logDo(T, exameId)).map((e) => e.entidade)).toEqual(['exame_no_app_liberado']);
    expect((await logDo(T, exameId)).filter((l) => l.acao === 'alterar' && l.entidade === 'exames')).toHaveLength(1);
  });

  it('pacienteUsaApp: false sem conta (patients.user_id nulo); true com a conta ligada', async () => {
    const sem = await cenario();
    expect(await mostrarNoApp(sem.T.ctx, sem.p.id, sem.exameId, deps)).toEqual({ pacienteUsaApp: false });
    const com = await cenario({ comConta: true });
    expect(await mostrarNoApp(com.T.ctx, com.p.id, com.exameId, deps)).toEqual({ pacienteUsaApp: true });
  });

  it('paciente bloqueado → a recusa de hoje e nada muda; exame de outro paciente ou de outro consultório → "Exame não encontrado."', async () => {
    const { T, p, exameId } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(mostrarNoApp(T.ctx, outro.id, exameId, deps)).rejects.toMatchObject({ erros: { geral: MSG_EXAMES.erros.naoEncontrado } });
    const T2 = await novoTenant(app.db);
    const p2 = await novoPaciente(app.db, T2.ctx);
    await expect(mostrarNoApp(T2.ctx, p2.id, exameId, deps)).rejects.toBeInstanceOf(ExameError);
    await expect(retirarDoApp(T.ctx, p.id, 'nao-e-uuid', deps)).rejects.toBeInstanceOf(ExameError);
    expect((await exame(T, exameId)).mostrarNoAppEm).toBeNull();

    await mostrarNoApp(T.ctx, p.id, exameId, deps);
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date(), anonimizarApos: '2046-01-01' }).where(eq(patients.id, p.id)), app.db);
    await expect(retirarDoApp(T.ctx, p.id, exameId, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await expect(mostrarNoApp(T.ctx, p.id, exameId, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect((await exame(T, exameId)).mostrarNoAppEm).toBeInstanceOf(Date);
    expect(doModulo(await logDo(T, exameId))).toHaveLength(1);
  });

  it('só a sessão nutri, antes de abrir a transação', async () => {
    const { T, p, exameId } = await cenario();
    const ctx = ctxPaciente(T.tenantId, p.id);
    await expect(mostrarNoApp(ctx, p.id, exameId, deps)).rejects.toThrow('exames: só a sessão nutri');
    await expect(retirarDoApp(ctx, p.id, exameId, deps)).rejects.toThrow('exames: só a sessão nutri');
    expect((await exame(T, exameId)).mostrarNoAppEm).toBeNull();
  });
});
