import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteInformado, tarefaNoBanco } from '../../../test/ia';
import { closeDb, type Tx } from '@/db/client';
import { iaGastoPlataforma, iaTarefas } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { definirRecusaIa } from './ciencia-paciente';
import { FUSO_DA_PLATAFORMA, mesNoFuso, reservar } from './cota';
import { expirarTarefasDoTenant } from './leitura-job';

/**
 * Revisão final do Plano 11 (Important "deadlock" e Minors 10 e 11): ciclos de travas entre a equipe, o worker e a
 * varredura. Cada teste para uma transação no ponto exato da corrida (a linha travada, antes da escrita), espera a
 * outra ficar bloqueada por ela (pg_blocking_pids) e então solta. Com a ordem de travas errada, o Postgres aborta uma
 * das duas com 40P01 (deadlock_timeout de 1 s); com a certa, as duas terminam.
 */
const app = makeDb(inject('appDatabaseUrl'));
const dono = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await dono.pool.end();
});

const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
const codigo = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;

function sinal() {
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  return { solto, soltar };
}

/** Espera alguma sessão ficar bloqueada pela sessão `pid` (até 10 s). */
async function esperarBloqueadoPor(pid: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const r = await dono.db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))`);
    if (r.rows[0].n > 0) return;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error('a outra transação não chegou a esperar');
}

/** Abre uma transação, roda `antes` (as travas), avisa o pid e espera `solto` para rodar `depois` (a escrita). */
async function parada(ctx: TenantContext, antes: (tx: Tx) => Promise<unknown>, depois: (tx: Tx) => Promise<unknown>) {
  const s = sinal();
  let avisar!: (pid: number) => void;
  const pid = new Promise<number>((r) => (avisar = r));
  const fim = withTenant(
    ctx,
    async (tx) => {
      await antes(tx);
      const r = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      avisar(r.rows[0].pid);
      await s.solto;
      await depois(tx);
    },
    app.db,
  );
  return { pid: await pid, soltar: s.soltar, fim };
}

describe('Plano 11 — ordem de travas sem ciclo (revisão final)', () => {
  it('worker no passo 1 (tarefa travada, antes do UPDATE auditado) × "Não usar IA": as duas terminam, sem 40P01', async () => {
    const T = await novoTenant(app.db);
    const p = await pacienteInformado(app.db, T.ctx);
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, null);
    // o passo 1 de processarTarefaIA: SELECT … FOR UPDATE da tarefa e, depois, o UPDATE para "processando" (gatilho de
    // auditoria → INSERT em audit_log → FK para tenants, que pede FOR KEY SHARE na linha do tenant)
    const worker = await parada(
      { tenantId: T.tenantId, role: 'worker' },
      (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, id)).for('update'),
      (tx) => tx.update(iaTarefas).set({ status: 'processando', iniciadoEm: agora, tentativas: 1, updatedAt: agora }).where(eq(iaTarefas.id, id)),
    );
    // a nutricionista: paciente → tenant → cancelarTarefas, que espera a tarefa travada pelo worker
    const recusa = definirRecusaIa(T.ctx, p.id, true, { db: app.db, agora });
    await esperarBloqueadoPor(worker.pid);
    worker.soltar();
    const r = await Promise.allSettled([worker.fim, recusa]);
    expect(r.map((x) => (x.status === 'rejected' ? codigo(x.reason) : 'ok'))).toEqual(['ok', 'ok']);
    // o worker confirmou "processando" antes: o cancelamento não a pega (o portão do envio recusa depois — paciente recusou)
    const [t] = await withTenant(T.ctx, (tx) => tx.select({ status: iaTarefas.status }).from(iaTarefas).where(eq(iaTarefas.id, id)), app.db);
    expect(t.status).toBe('processando');
  });

  it('varredura × cancelamento: a varredura trava todas as tarefas antes do contador da plataforma (sem ciclo tarefa ↔ plataforma)', async () => {
    const T = await novoTenant(app.db);
    const p = await pacienteInformado(app.db, T.ctx);
    const velho = new Date(agora.getTime() - 60 * 60_000);
    // uma esquecida na fila (com reserva: o estorno vai ao contador da plataforma) e uma pronta vencida
    const esquecida = await tarefaNoBanco(app.db, T.ctx, p.id, null, { criadoEm: velho });
    await withTenant(T.ctx, (tx) => reservar(tx, { tenantId: T.tenantId, tarefaId: esquecida, tipo: 'leitura_exame', modelo: 'claude-opus-5-5', promptVersao: 'teste', microUsd: 1, agora, tetoGlobalMicroUsd: Number.MAX_SAFE_INTEGER }), app.db);
    const vencida = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'pronta', expiraEm: velho, resultado: { versao: 1, dataColeta: null, linhas: [], descartadas: 0 } });
    const mes = mesNoFuso(agora, FUSO_DA_PLATAFORMA);
    // quem cancela (cancelarTarefas): já travou a pronta e vai estornar (linha do mês da plataforma)
    const cancela = await parada(
      T.ctx,
      (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, vencida)).for('update'),
      (tx) => tx.update(iaGastoPlataforma).set({ updatedAt: agora }).where(eq(iaGastoPlataforma.mes, mes)),
    );
    const varredura = withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => expirarTarefasDoTenant(tx, agora), app.db);
    await esperarBloqueadoPor(cancela.pid);
    cancela.soltar();
    const r = await Promise.allSettled([cancela.fim, varredura]);
    expect(r.map((x) => (x.status === 'rejected' ? codigo(x.reason) : 'ok'))).toEqual(['ok', 'ok']);
    expect(r[1].status === 'fulfilled' && r[1].value).toEqual({ interrompidas: 1, expiradas: 1 });
  });
});
