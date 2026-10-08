import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { definirPesoOculto } from '@/modules/pacientes/peso-oculto';
import { jornadaDoPaciente, miniJornadaDoPaciente } from './jornada';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const tenantDe = async (id: string) => ({ ...(await app.db.select().from(tenants).where(eq(tenants.id, id)))[0], mostrarPercGorduraPaciente: false });
const leituras = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select({ entidade: auditLog.entidade, n: count() }).from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.acao, 'ler'))).groupBy(auditLog.entidade), app.db).then((r) =>
    Object.fromEntries(r.map((x) => [x.entidade, x.n])),
  );

/** Dois atendimentos (com orientação e avaliação ligada), uma avaliação sem atendimento e uma nota privada (que nunca aparece). */
async function comHistorico() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  await withTenant(
    T.ctx,
    async (tx) => {
      const [c1] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${T.tenantId}, ${p.id}, '2026-03-18', 'Beber 2 litros de água.') returning id`)).rows;
      const [c2] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data) values (${T.tenantId}, ${p.id}, '2026-09-22') returning id`)).rows;
      await tx.execute(sql`insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) values (${T.tenantId}, ${p.id}, ${c2.id}, 'segredo da nutri')`);
      await tx.execute(sql`insert into anthropometry (tenant_id, patient_id, consultation_id, data, peso_kg, altura_cm, perc_gordura, dobras_mm, circunferencias) values
        (${T.tenantId}, ${p.id}, ${c1.id}, '2026-03-18', 81.37, 170, 30.5, '{"triceps": 20}', '{"cintura": 92}'),
        (${T.tenantId}, ${p.id}, ${c2.id}, '2026-09-22', 78.62, 170, 28.1, '{"triceps": 18}', '{"cintura": 86}'),
        (${T.tenantId}, ${p.id}, null, '2026-05-27', 80.11, 170, null, '{}', '{"cintura": 90}')`);
    },
    app.db,
  );
  return { T, p, ctx: ctxPaciente(T.tenantId, p.id) };
}

describe('jornadaDoPaciente / miniJornadaDoPaciente (Plano 16, US-194, RN-202, RN-203)', () => {
  it('marcos com as medidas e a orientação; leitura auditada (atendimentos e antropometria); sem nota privada, dobras nem % de gordura', async () => {
    const { T, p, ctx } = await comHistorico();
    const agora = new Date('2026-10-08T14:05:00Z');
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-09T17:00:00Z'), 60, { modalidade: 'online', linkOnline: 'https://meet.example/abc' });
    const j = await jornadaDoPaciente(ctx, await tenantDe(T.tenantId), agora, app.db);
    expect(j.titulo).toBe('Sua jornada desde março');
    expect(j.marcos.map((m) => m.tipo)).toEqual(['proxima', 'atendimento', 'medidas', 'atendimento']);
    expect(j.marcos[3]).toMatchObject({ primeira: true, orientacao: 'Beber 2 litros de água.' });
    expect(j.grafico?.pontos.map((x) => x.valor)).toEqual([81.37, 80.11, 78.62]);
    expect(JSON.stringify(j)).not.toMatch(/segredo|triceps|gordura/);
    expect(await leituras(T, p.id)).toEqual({ atendimentos: 1, antropometria: 1 });
  });

  it('peso oculto (RN-203, CS-194): nem o peso nem o IMC saem do módulo — sem gráfico de medida corporal (G-D16 a); a mini-jornada conta consultas e não lê a antropometria', async () => {
    const { T, p, ctx } = await comHistorico();
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db });
    const agora = new Date('2026-10-08T14:05:00Z');
    const tenant = await tenantDe(T.tenantId);
    const j = await jornadaDoPaciente(ctx, tenant, agora, app.db);
    const mini = await miniJornadaDoPaciente(ctx, tenant, agora, app.db);
    const tudo = JSON.stringify({ j, mini });
    expect(tudo).not.toMatch(/81[.,]37|81[.,]4|78[.,]62|78[.,]6|80[.,]11|kg|IMC|28[.,]1|27[.,]2/);
    expect(j.grafico).toBeNull();
    expect(mini).toMatchObject({ linha1: '2 consultas desde março', pontos: [] });
    expect((await leituras(T, p.id)).antropometria).toBe(1); // só a da jornada (cinturas); a mini não leu nada da antropometria
  });

  it('mini-jornada com o peso visível: a variação e a próxima consulta; leitura da antropometria auditada', async () => {
    const { T, p, ctx } = await comHistorico();
    const mini = await miniJornadaDoPaciente(ctx, await tenantDe(T.tenantId), new Date('2026-10-08T14:05:00Z'), app.db);
    expect(mini.linha1).toBe('−2,8 kg desde março');
    expect(mini.linha2.semFuso).toBe('Nenhuma consulta marcada.');
    expect(await leituras(T, p.id)).toEqual({ antropometria: 1 });
  });

  it('isolamento e papel: só o próprio histórico; só em sessão de paciente', async () => {
    const { T, ctx } = await comHistorico();
    const outro = await novoPaciente(app.db, T.ctx);
    const j = await jornadaDoPaciente(ctxPaciente(T.tenantId, outro.id), await tenantDe(T.tenantId), new Date(), app.db);
    expect(j).toMatchObject({ vazia: true, titulo: 'Sua jornada' });
    await expect(jornadaDoPaciente(T.ctx, await tenantDe(T.tenantId), new Date(), app.db)).rejects.toThrow(/sessão de paciente/);
    expect(ctx.role).toBe('paciente');
  });
});
