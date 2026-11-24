import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import type { Tx } from '@/db/client';
import { auditLog, examInterpretacoes, exams, patients, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { criarExame } from '@/modules/pacientes/exames';
import { MSG_EXAMES } from './constantes';
import { abrirExame } from './detalhe';
import { apagarNota, NotaError, notasAnteriores, salvarNota } from './interpretacao';

/**
 * Plano 22 (T5a, US-373, RN-383, EP-D18, EP-D19, EP-D41, EP-D61; Review Focus 3): a nota de interpretação — só de inclusão
 * (cada "Salvar nota" e "Apagar nota" grava uma versão nova), travas paciente → exame → nota, entidade `exames_nota` no
 * Histórico, `notasAnteriores` com `auditRead` só quando devolve nota, leitura pelos dois ids.
 */
const app = makeDb(inject('appDatabaseUrl'));
const dono = makeDb(inject('ownerDatabaseUrl')); // só lê pg_stat_activity (quem está preso em qual trava)
afterAll(async () => {
  await app.pool.end();
  await dono.pool.end();
});
const deps = { db: app.db };
const N = MSG_EXAMES.nota;

const errosDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof NotaError) return e.erros;
    throw e;
  }
  throw new Error('esperava NotaError');
};

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const exameId = await criarExame(
    T.ctx,
    T.tenant,
    p.id,
    { titulo: 'Rotina', data: '2026-09-01', valores: [{ nome: 'Ferritina', valor: '8', unidade: 'ng/mL', referencia: '15 a 150', refMin: '15', refMax: '150' }], arquivo: null },
    { db: app.db },
  );
  return { T, p, exameId };
}
const notas = (T: TenantDeTeste, exameId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(examInterpretacoes).where(eq(examInterpretacoes.examId, exameId)).orderBy(examInterpretacoes.versao), app.db);
/** O `audit_log` de `exames_nota` do consultório (cada teste tem o seu): o `criar` do gatilho leva o id da linha da nota. */
const logDa = (T: TenantDeTeste) =>
  withTenant(
    T.ctx,
    (tx) =>
      tx
        .select({ acao: auditLog.acao, entidade: auditLog.entidade, entidadeId: auditLog.entidadeId, actor: auditLog.actorUserId, patientId: auditLog.patientId })
        .from(auditLog)
        .where(eq(auditLog.entidade, 'exames_nota'))
        .orderBy(auditLog.criadoEm),
    app.db,
  );

describe('salvarNota / apagarNota (US-373, RN-383)', () => {
  it('"Escrever a nota": versão 1 com o autor da sessão; o gatilho audita criar/exames_nota', async () => {
    const { T, p, exameId } = await cenario();
    await salvarNota(T.ctx, p.id, exameId, '  Investigar ingestão de ferro.  ', deps);
    const [n, ...resto] = await notas(T, exameId);
    expect(resto).toEqual([]);
    expect(n).toMatchObject({ versao: 1, texto: 'Investigar ingestão de ferro.', criadoPor: T.nutriId, patientId: p.id, tenantId: T.tenantId });
    const log = await logDa(T);
    expect(log.map((l) => [l.acao, l.entidade, l.actor, l.patientId])).toEqual([['criar', 'exames_nota', T.nutriId, p.id]]);
  });

  it('salvar de novo → versão 2 (a 1 continua); "Apagar nota" → versão 3 com texto nulo, um excluir/exames_nota com o id do exame, e abrirExame sem nota', async () => {
    const { T, p, exameId } = await cenario();
    await salvarNota(T.ctx, p.id, exameId, 'Primeira.', deps);
    await salvarNota(T.ctx, p.id, exameId, 'Segunda.', deps);
    await apagarNota(T.ctx, p.id, exameId, deps);
    expect((await notas(T, exameId)).map((n) => [n.versao, n.texto])).toEqual([
      [1, 'Primeira.'],
      [2, 'Segunda.'],
      [3, null],
    ]);
    const excluir = (await logDa(T)).filter((l) => l.acao === 'excluir');
    expect(excluir).toEqual([{ acao: 'excluir', entidade: 'exames_nota', entidadeId: exameId, actor: T.nutriId, patientId: p.id }]);
    expect((await abrirExame(T.ctx, p.id, exameId, deps))!.nota).toBeNull();
    // apagar sem nota em vigor não grava nada
    await apagarNota(T.ctx, p.id, exameId, deps);
    expect(await notas(T, exameId)).toHaveLength(3);
    expect((await logDa(T)).filter((l) => l.acao === 'excluir')).toHaveLength(1);
  });

  it('2001 caracteres → "A nota tem no máximo 2000 caracteres."; vazia → mensagem; 2000 (por code point) passa', async () => {
    const { T, p, exameId } = await cenario();
    expect(await errosDe(salvarNota(T.ctx, p.id, exameId, 'x'.repeat(2001), deps))).toEqual({ texto: N.max });
    expect(await errosDe(salvarNota(T.ctx, p.id, exameId, '   ', deps))).toEqual({ texto: N.vazia });
    expect(await errosDe(salvarNota(T.ctx, p.id, exameId, null, deps))).toEqual({ texto: N.vazia });
    expect(await notas(T, exameId)).toEqual([]);
    await salvarNota(T.ctx, p.id, exameId, '🙂'.repeat(2000), deps);
    expect((await notas(T, exameId))[0].texto).toBe('🙂'.repeat(2000));
  });

  it('paciente bloqueado ou anonimizado → a recusa de hoje e nada é gravado', async () => {
    const { T, p, exameId } = await cenario();
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date(), anonimizarApos: '2046-01-01' }).where(eq(patients.id, p.id)), app.db);
    await expect(salvarNota(T.ctx, p.id, exameId, 'Nota.', deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await expect(apagarNota(T.ctx, p.id, exameId, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await notas(T, exameId)).toEqual([]);

    const anon = await cenario();
    await salvarNota(anon.T.ctx, anon.p.id, anon.exameId, 'Antes.', deps);
    await withTenant({ tenantId: anon.T.tenantId, role: 'worker' }, (tx) => tx.update(patients).set({ anonimizadoEm: new Date() }).where(eq(patients.id, anon.p.id)), app.db);
    await expect(salvarNota(anon.T.ctx, anon.p.id, anon.exameId, 'Depois.', deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await expect(apagarNota(anon.T.ctx, anon.p.id, anon.exameId, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect((await notas(anon.T, anon.exameId)).map((n) => n.texto)).toEqual(['Antes.']);
  });

  it('exame de outro paciente, inexistente ou id malformado → "Exame não encontrado." e nada gravado', async () => {
    const { T, p, exameId } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const naoEncontrado = { geral: MSG_EXAMES.erros.naoEncontrado };
    expect(await errosDe(salvarNota(T.ctx, outro.id, exameId, 'Nota.', deps))).toEqual(naoEncontrado);
    expect(await errosDe(salvarNota(T.ctx, p.id, randomUUID(), 'Nota.', deps))).toEqual(naoEncontrado);
    expect(await errosDe(salvarNota(T.ctx, p.id, 'nao-uuid', 'Nota.', deps))).toEqual(naoEncontrado);
    expect(await errosDe(apagarNota(T.ctx, outro.id, exameId, deps))).toEqual(naoEncontrado);
    expect(await notas(T, exameId)).toEqual([]);
  });

  it('sessão de paciente → erro do assert de papel, antes da transação', async () => {
    const { T, p, exameId } = await cenario();
    const P = ctxPaciente(T.tenantId, p.id);
    await expect(salvarNota(P, p.id, exameId, 'Nota.', deps)).rejects.toThrow('exames: só a sessão nutri');
    await expect(apagarNota(P, p.id, exameId, deps)).rejects.toThrow('exames: só a sessão nutri');
    await expect(notasAnteriores(P, p.id, exameId, deps)).rejects.toThrow('exames: só a sessão nutri');
  });
});

describe('Review Focus 3 — nota × excluirExame e duas notas concorrentes', () => {
  /** Espera alguma sessão ficar bloqueada pela sessão `pid` (até 10 s). */
  async function esperarBloqueadoPor(pid: number): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const r = await dono.pool.query<{ n: number }>('select count(*)::int as n from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))', [pid]);
      if (r.rows[0].n > 0) return;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error('a outra transação não chegou a esperar');
  }
  /** Abre uma transação, roda `antes` (as travas), avisa o pid e espera `soltar` para rodar `depois` (a escrita). */
  async function parada(ctx: TenantContext, antes: (tx: Tx) => Promise<unknown>, depois: (tx: Tx) => Promise<unknown>) {
    let soltar!: () => void;
    const solto = new Promise<void>((r) => (soltar = r));
    let avisar!: (pid: number) => void;
    const pid = new Promise<number>((r) => (avisar = r));
    const fim = withTenant(
      ctx,
      async (tx) => {
        await antes(tx);
        const r = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        avisar(r.rows[0].pid);
        await solto;
        await depois(tx);
      },
      app.db,
    );
    return { pid: await pid, soltar, fim };
  }

  it('A trava o exame e o exclui; B chama salvarNota e espera → B recebe "Exame não encontrado.", nunca o 23503', async () => {
    const { T, p, exameId } = await cenario();
    const A = await parada(
      T.ctx,
      (tx) => tx.select().from(exams).where(eq(exams.id, exameId)).for('update'),
      (tx) => tx.delete(exams).where(and(eq(exams.id, exameId), eq(exams.patientId, p.id))),
    );
    const B = salvarNota(T.ctx, p.id, exameId, 'Nota.', deps).then(
      () => null,
      (e: unknown) => e,
    );
    await esperarBloqueadoPor(A.pid);
    A.soltar();
    await A.fim;
    const r = await B;
    expect(r).toBeInstanceOf(NotaError);
    expect((r as NotaError).erros).toEqual({ geral: MSG_EXAMES.erros.naoEncontrado });
  });

  it('A trava o paciente (como excluirExame) e exclui o exame; B apaga a nota e espera → "Exame não encontrado."', async () => {
    const { T, p, exameId } = await cenario();
    await salvarNota(T.ctx, p.id, exameId, 'Nota.', deps);
    const A = await parada(
      T.ctx,
      (tx) => tx.select().from(patients).where(eq(patients.id, p.id)).for('update'),
      (tx) => tx.delete(exams).where(and(eq(exams.id, exameId), eq(exams.patientId, p.id))),
    );
    const B = apagarNota(T.ctx, p.id, exameId, deps).then(
      () => null,
      (e: unknown) => e,
    );
    await esperarBloqueadoPor(A.pid);
    A.soltar();
    await A.fim;
    const r = await B;
    expect(r).toBeInstanceOf(NotaError);
    expect((r as NotaError).erros).toEqual({ geral: MSG_EXAMES.erros.naoEncontrado });
    // a cascata levou a nota com o exame
    expect(await notas(T, exameId)).toEqual([]);
  });

  it('duas notas concorrentes no mesmo exame → versões 1 e 2, sem 23505', async () => {
    const { T, p, exameId } = await cenario();
    await Promise.all([salvarNota(T.ctx, p.id, exameId, 'Uma.', deps), salvarNota(T.ctx, p.id, exameId, 'Outra.', deps)]);
    expect((await notas(T, exameId)).map((n) => n.versao)).toEqual([1, 2]);
  });
});

describe('notasAnteriores ("Versões anteriores", I3, R22-04, M8)', () => {
  it('exame sem versão e com duas notas: devolve a anterior com o nome do autor e grava um ler/exames_nota com o exameId e o patientId', async () => {
    const { T, p, exameId } = await cenario();
    await salvarNota(T.ctx, p.id, exameId, 'Primeira.', deps);
    await salvarNota(T.ctx, p.id, exameId, 'Segunda.', deps);
    const lista = await notasAnteriores(T.ctx, p.id, exameId, deps);
    expect(lista).toEqual([{ versao: 1, texto: 'Primeira.', por: 'Debby Silva', em: expect.any(Date) }]);
    const lidas = (await logDa(T)).filter((l) => l.acao === 'ler');
    expect(lidas).toEqual([{ acao: 'ler', entidade: 'exames_nota', entidadeId: exameId, actor: T.nutriId, patientId: p.id }]);
  });

  it('a anterior apagada vem com texto nulo; o autor sem conta vira "Usuário removido"', async () => {
    const { T, p, exameId } = await cenario();
    const outra = randomUUID();
    await app.db.insert(user).values({ id: outra, name: 'Assistente', email: `a-${outra.slice(0, 8)}@teste.dev`, appRole: 'nutri', tenantId: T.tenantId });
    await salvarNota({ ...T.ctx, actorUserId: outra }, p.id, exameId, 'Da assistente.', deps);
    await apagarNota(T.ctx, p.id, exameId, deps);
    await salvarNota(T.ctx, p.id, exameId, 'Nova.', deps);
    await app.db.delete(user).where(eq(user.id, outra));
    expect((await notasAnteriores(T.ctx, p.id, exameId, deps)).map((n) => [n.versao, n.texto, n.por])).toEqual([
      [2, null, 'Debby Silva'],
      [1, 'Da assistente.', 'Usuário removido'],
    ]);
  });

  it('sem nota anterior (nenhuma ou só a em vigor) → [] e nenhum ler', async () => {
    const { T, p, exameId } = await cenario();
    expect(await notasAnteriores(T.ctx, p.id, exameId, deps)).toEqual([]);
    await salvarNota(T.ctx, p.id, exameId, 'Única.', deps);
    expect(await notasAnteriores(T.ctx, p.id, exameId, deps)).toEqual([]);
    expect((await logDa(T)).filter((l) => l.acao === 'ler')).toEqual([]);
  });

  it('exame de outro paciente na URL → [] e nenhum ler', async () => {
    const { T, p, exameId } = await cenario();
    await salvarNota(T.ctx, p.id, exameId, 'Primeira.', deps);
    await salvarNota(T.ctx, p.id, exameId, 'Segunda.', deps);
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await notasAnteriores(T.ctx, outro.id, exameId, deps)).toEqual([]);
    expect(await notasAnteriores(T.ctx, p.id, 'nao-uuid', deps)).toEqual([]);
    expect((await logDa(T)).filter((l) => l.acao === 'ler')).toEqual([]);
    const doOutro = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, outro.id), eq(auditLog.acao, 'ler'))), app.db);
    expect(doOutro).toEqual([]);
  });
});
