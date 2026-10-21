import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { envioNoBanco } from '../../../test/exames-enviados';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { accessEvents, auditLog, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { somarDias } from '@/modules/pacientes/datas';
import { jaUsavaOApp } from './acesso';
import { temEnvioVisivel } from './exames-enviados';
import { faixaDeHoje } from './hoje';
import { miniJornadaDoPaciente } from './jornada';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const tenantDe = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0];
const leituras = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select({ entidade: auditLog.entidade, n: count() }).from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.acao, 'ler'))).groupBy(auditLog.entidade), app.db).then((r) =>
    Object.fromEntries(r.map((x) => [x.entidade, x.n])),
  );

async function comDados() {
  const T = await novoTenant(app.db);
  const [p, outro] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
  await withTenant(
    T.ctx,
    async (tx) => {
      const [c] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data) values (${T.tenantId}, ${p.id}, '2026-03-18') returning id`)).rows;
      await tx.execute(sql`insert into anthropometry (tenant_id, patient_id, consultation_id, data, peso_kg, altura_cm) values
        (${T.tenantId}, ${p.id}, ${c.id}, '2026-03-18', 81.37, 170), (${T.tenantId}, ${p.id}, null, '2026-09-22', 78.62, 170)`);
    },
    app.db,
  );
  return { T, p, outro, ctx: ctxPaciente(T.tenantId, p.id) };
}

describe('faixaDeHoje (P08-13, D2 do Plano 16: a faixa de Hoje numa transação)', () => {
  const agora = new Date('2026-10-08T14:05:00Z');
  const hoje = '2026-10-08';

  it('o mesmo que a mini-jornada, o jaUsavaOApp e o temEnvioVisivel separados; a leitura da antropometria auditada uma vez', async () => {
    const { T, p, outro, ctx } = await comDados();
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-09T17:00:00Z'), 60);
    await consultaDireta(app.db, T.ctx, outro.id, new Date('2026-10-08T18:00:00Z'), 60); // a do outro paciente não é a próxima
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: p.id, dia: somarDias(hoje, -1) }), app.db);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    const tenant = await tenantDe(T.tenantId);
    const f = await faixaDeHoje(ctx, tenant, agora, hoje, app.db);
    expect(await leituras(T, p.id)).toEqual({ antropometria: 1 });
    expect(f).toEqual({ mini: await miniJornadaDoPaciente(ctx, tenant, agora, app.db), jaUsava: await jaUsavaOApp(ctx, hoje, app.db), exames: await temEnvioVisivel(ctx, app.db) });
    expect(f).toMatchObject({ mini: { linha1: '−2,8 kg desde março' }, jaUsava: true, exames: true });
    expect(f.mini.linha2.semFuso).toMatch(/amanhã/);
  });

  it('só o próprio paciente: sem acesso anterior, sem envio e sem consulta dele; com o recebimento ligado, "Exames" aparece sem envio', async () => {
    const { T, outro } = await comDados();
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: outro.id, dia: somarDias(hoje, -1) }), app.db);
    await envioNoBanco(app.db, T.ctx, outro.id, { status: 'recebido' });
    const novo = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, novo.id);
    expect(await faixaDeHoje(ctx, await tenantDe(T.tenantId), agora, hoje, app.db)).toMatchObject({ jaUsava: false, exames: false, mini: { pontos: [] } });
    await app.db.update(tenants).set({ examesPacienteAtivadoEm: new Date() }).where(eq(tenants.id, T.tenantId));
    expect((await faixaDeHoje(ctx, await tenantDe(T.tenantId), agora, hoje, app.db)).exames).toBe(true);
  });

  it('só em sessão de paciente', async () => {
    const T = await novoTenant(app.db);
    await expect(faixaDeHoje(T.ctx, await tenantDe(T.tenantId), agora, hoje, app.db)).rejects.toThrow(/sessão de paciente/);
  });
});
