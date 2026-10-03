import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { avisarComentario, avisarPlanoNovo } from './avisos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = new Date('2026-10-05T15:00:00Z');

describe('avisos do portal (US-025, US-043)', () => {
  it('plano novo: push + e-mail "Seu novo plano alimentar está disponível" só para quem tem acesso ao portal e está ativo', async () => {
    const T = await novoTenant(app.db);
    const { paciente: comConta, email } = await pacienteComConta(app.db, T);
    const semConta = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, async (tx) => {
      await avisarPlanoNovo(tx, comConta, agora, 'https://nutri.exemplo.com');
      await avisarPlanoNovo(tx, semConta, agora, 'https://nutri.exemplo.com');
      await avisarPlanoNovo(tx, { ...comConta, status: 'arquivado' }, agora, 'https://nutri.exemplo.com');
    }, app.db);
    const push = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'plano_novo')), app.db);
    expect(push.map((n) => [n.patientId, n.canal, n.status, n.appointmentId])).toEqual([[comConta.id, 'push', 'pendente', null]]);
    expect(await emailsNaFila('plano_novo', email)).toEqual([{ tipo: 'plano_novo', para: email, link: 'https://nutri.exemplo.com/p/plano' }]);
    expect(await emailsNaFila('plano_novo', semConta.email)).toEqual([]);
  });

  it('comentário: um push comentario_diario pendente para o paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => avisarComentario(tx, { tenantId: T.tenantId, patientId: p.id }, agora), app.db);
    const n = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, p.id), eq(notifications.tipo, 'comentario_diario'))), app.db);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ canal: 'push', status: 'pendente', appointmentId: null });
  });
});
