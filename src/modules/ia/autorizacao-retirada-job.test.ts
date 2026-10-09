import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, exameComLaudo, IA_TESTE, iaPronta, pacienteAutorizado } from '../../../test/ia';
import { novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { iaTarefas, iaUso, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { processarRetiradaIa } from './autorizacao-retirada-job';
import { pedirLeituraExame } from './tarefas';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-ret-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);

async function cenario() {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId);
  const p = await pacienteAutorizado(app.db, T.ctx);
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  const pedir = async () => pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir }), { db: app.db, agora: new Date(), ia: IA_TESTE, avisarTeto: async () => 0 });
  const status = async (id: string) => (await withTenant(T.ctx, (tx) => tx.select({ s: iaTarefas.status }).from(iaTarefas).where(eq(iaTarefas.id, id)), app.db))[0].s;
  return { T, p, pedir, status };
}

describe('job ia-retirada (RN-108, RNF-111 c, D14)', () => {
  it('cancela a fila (estorno) do paciente que retirou', async () => {
    const { T, p, pedir, status } = await cenario();
    const id = await pedir();
    const retiradaId = await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    expect(await processarRetiradaIa({ tenantId: T.tenantId, patientId: p.id, retiradaId }, { db: app.db, destino: 'teste', agora: () => agora })).toBe(1);
    expect(await status(id)).toBe('cancelada');
    expect((await withTenant(T.ctx, (tx) => tx.select({ s: iaUso.situacao }).from(iaUso).where(eq(iaUso.tarefaId, id)), app.db))[0].s).toBe('estornado');
  });

  it('reautorizou antes de o job rodar: só a tarefa criada antes da retirada é cancelada', async () => {
    const { T, p, pedir, status } = await cenario();
    const antes = await pedir();
    const retiradaId = await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    const depois = await pedir();
    expect(await processarRetiradaIa({ tenantId: T.tenantId, patientId: p.id, retiradaId }, { db: app.db, destino: 'teste', agora: () => agora })).toBe(1);
    expect(await status(antes)).toBe('cancelada');
    expect(await status(depois)).toBe('na_fila');
  });

  it('id de retirada que não é deste paciente (ou não é retirada) → nada', async () => {
    const { T, p, pedir, status } = await cenario();
    const id = await pedir();
    const autorizacao = await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    expect(await processarRetiradaIa({ tenantId: T.tenantId, patientId: p.id, retiradaId: autorizacao }, { db: app.db, destino: 'teste' })).toBe(0);
    expect(await status(id)).toBe('na_fila');
  });
});
