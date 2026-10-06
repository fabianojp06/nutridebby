import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { adminActions, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { CONTA_COTA } from '@/modules/notificacoes/whatsapp/cota';
import { ajustarCotaIa, ajustarCotaWhatsapp, CotaWhatsappError, metricasDeIaPorTenant, metricasDeSucessoPorTenant, metricasPorTenant, MSG_COTA_IA, MSG_METRICAS, salvarMetricasBase } from './metricas';
import { ContaNaoEncontradaError } from './tenant-status';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

async function tenantComArquivos(n: number, bytes: number) {
  const [t] = await app.db.insert(tenants).values({ slug: `met-${randomUUID().slice(0, 8)}`, nomeExibicao: 'M', armazenamentoBytes: bytes }).returning();
  for (let i = 0; i < n; i++) {
    await withTenant({ tenantId: t.id, role: 'nutri', actorUserId: randomUUID() }, (tx) =>
      tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values (${t.id}, 'logo', ${`${t.id}/logo/${randomUUID()}.png`}, 10, 'image/png')`), app.db);
  }
  return t.id;
}

describe('metricasPorTenant (§3: só contagens)', () => {
  it('conta arquivos e armazenamento de cada tenant; pacientes ativos, consultas e WhatsApps do mês contados', async () => {
    const a = await tenantComArquivos(3, 30);
    const b = await tenantComArquivos(1, 10);
    const m = await metricasPorTenant(app.db);
    expect(m.get(a)).toEqual({ tenantId: a, arquivos: 3, armazenamentoBytes: 30, pacientesAtivos: 0, consultasMes: 0, mensagensWhatsappMes: 0 });
    expect(m.get(b)?.arquivos).toBe(1);
  });

  it('conta consultas não canceladas e WhatsApps aceitos do mês do tenant (Plano 05)', async () => {
    const t = await tenantComArquivos(0, 0);
    const p = randomUUID();
    // mês civil corrente no fuso do tenant (o padrão, America/Sao_Paulo), a qualquer hora que o teste rode
    const inicioMes = sql`(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;
    const mesSeguinte = sql`((date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month') AT TIME ZONE 'America/Sao_Paulo')`;
    await withTenant({ tenantId: t, role: 'nutri', actorUserId: randomUUID() }, async (tx) => {
      await tx.execute(sql`insert into patients (id, tenant_id, nome, data_nascimento, sexo, email) values (${p}, ${t}, 'M', '1990-01-01', 'F', ${`m-${p}@t.dev`})`);
      const dia = sql`(${inicioMes} + interval '1 day')`; // sempre dentro do mês
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values (${t}, ${p}, ${dia}, ${dia} + interval '1 hour', 'presencial', 'nutri')`);
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status, cancelado_por, cancelada_em) values (${t}, ${p}, ${dia} + interval '2 hours', ${dia} + interval '3 hours', 'presencial', 'nutri', 'cancelada', 'nutri', now())`);
      // 00:00 do dia 1º do mês seguinte já é do outro mês
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values (${t}, ${p}, ${mesSeguinte}, ${mesSeguinte} + interval '1 hour', 'presencial', 'nutri')`);
      await tx.execute(sql`insert into notifications (tenant_id, patient_id, canal, tipo, status, agendada_para, enviada_em) values
        (${t}, ${p}, 'whatsapp', 'convite_paciente', 'enviada', now(), now()),
        (${t}, ${p}, 'whatsapp', 'resposta_confirmacao', 'enviada', now(), now()),
        (${t}, ${p}, 'email', 'convite_paciente', 'enviada', now(), now()),
        (${t}, ${p}, 'whatsapp', 'convite_paciente', 'enviada', ${inicioMes} - interval '1 minute', ${inicioMes} - interval '1 minute')`);
    }, app.db);
    expect((await metricasPorTenant(app.db)).get(t)).toMatchObject({ consultasMes: 1, mensagensWhatsappMes: 1 });
  });

  it('mensagens_whatsapp_mes conta os mesmos tipos da cota do envio (CONTA_COTA, D15)', async () => {
    const { rows } = await app.pool.query<{ def: string }>(`select pg_get_functiondef('admin_tenant_metrics()'::regprocedure) as def`);
    expect(rows[0].def).toContain(`n.tipo IN (${CONTA_COTA.map((t) => `'${t}'`).join(', ')})`);
  });

  it('dentro de withTenant é recusada (apagaria o contexto app.* da transação do tenant) (M13)', async () => {
    const t = await tenantComArquivos(0, 0);
    await expect(
      withTenant({ tenantId: t, role: 'nutri', actorUserId: randomUUID() }, (tx) => tx.execute(sql`select * from admin_tenant_metrics()`), app.db),
    ).rejects.toSatisfy((e: unknown) => /withTenant/.test(String((e as { cause?: unknown }).cause ?? e)));
    // e fora dele, na mesma conexão/sessão já usada por um withTenant, segue funcionando
    await expect(metricasPorTenant(app.db)).resolves.toBeInstanceOf(Map);
  });

  it('EXECUTE revogado de PUBLIC; só o role da aplicação executa (M14)', async () => {
    const { rows } = await app.pool.query<{ publico: boolean; app: boolean }>(`
      select exists (
               select 1 from pg_proc p
                 cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.proname = 'admin_tenant_metrics' and a.grantee = 0 and a.privilege_type = 'EXECUTE'
             ) as publico,
             has_function_privilege('nutri_app_role', 'admin_tenant_metrics()', 'EXECUTE') as app`);
    expect(rows[0]).toEqual({ publico: false, app: true });
  });
});

describe('metricasDeSucessoPorTenant (D15: só contagens)', () => {
  it('faltas e consultas já iniciadas do mês no fuso do tenant: cancelada e futura ficam fora', async () => {
    const t = await tenantComArquivos(0, 0);
    const p = randomUUID();
    // já começou e é deste mês (no 1º minuto do mês, o próprio início do mês)
    const i = sql`greatest(now() - interval '1 minute', date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;
    await withTenant({ tenantId: t, role: 'nutri', actorUserId: randomUUID() }, async (tx) => {
      await tx.execute(sql`insert into patients (id, tenant_id, nome, data_nascimento, sexo, email) values (${p}, ${t}, 'M', '1990-01-01', 'F', ${`s-${p}@t.dev`})`);
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status) values (${t}, ${p}, ${i}, ${i} + interval '30 minutes', 'presencial', 'nutri', 'faltou')`);
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status, cancelado_por, cancelada_em) values (${t}, ${p}, ${i}, ${i} + interval '30 minutes', 'presencial', 'nutri', 'cancelada', 'nutri', now())`);
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values (${t}, ${p}, now() + interval '1 hour', now() + interval '2 hours', 'presencial', 'nutri')`);
    }, app.db);
    expect((await metricasDeSucessoPorTenant(app.db)).get(t)).toEqual({ comConta: 0, abriram: 0, faltasMes: 1, iniciadasMes: 1 });
  });

  it('EXECUTE revogado de PUBLIC; só o role da aplicação executa', async () => {
    const { rows } = await app.pool.query<{ publico: boolean; app: boolean }>(`
      select exists (
               select 1 from pg_proc p
                 cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.proname = 'admin_metricas_sucesso' and a.grantee = 0 and a.privilege_type = 'EXECUTE'
             ) as publico,
             has_function_privilege('nutri_app_role', 'admin_metricas_sucesso()', 'EXECUTE') as app`);
    expect(rows[0]).toEqual({ publico: false, app: true });
  });
});

describe('ajustarCotaWhatsapp', () => {
  it('grava inteiro de 0 a 100000 e recusa o resto', async () => {
    const t = await tenantComArquivos(0, 0);
    await ajustarCotaWhatsapp(t, ' 800 ', randomUUID(), app.db);
    expect((await app.db.select().from(tenants).where(eq(tenants.id, t)))[0].waCotaMensal).toBe(800);
    for (const v of ['', '-1', '12.5', 'abc', '100001']) {
      await expect(ajustarCotaWhatsapp(t, v, randomUUID(), app.db)).rejects.toBeInstanceOf(CotaWhatsappError);
    }
    expect((await app.db.select().from(tenants).where(eq(tenants.id, t)))[0].waCotaMensal).toBe(800);
  });

  it('tenant inexistente → ContaNaoEncontradaError (M9)', async () => {
    await expect(ajustarCotaWhatsapp(randomUUID(), '10', randomUUID(), app.db)).rejects.toBeInstanceOf(ContaNaoEncontradaError);
  });
});

describe('salvarMetricasBase (D15: o admin grava a base do CS-03 e o início do uso)', () => {
  const ADMIN = randomUUID();
  it('salvarMetricasBase: valida a taxa (0 a 100, vírgula) e a data', async () => {
    const T = { tenantId: await tenantComArquivos(0, 0) };
    const info = vi.spyOn(logger, 'info');
    await salvarMetricasBase(T.tenantId, { taxaBase: '18,5', goLiveEm: '2026-10-01' }, ADMIN, app.db);
    expect(info).toHaveBeenCalledWith({ tenantId: T.tenantId, adminId: ADMIN }, 'métricas de sucesso ajustadas'); // quem mudou, sem o valor
    info.mockRestore();
    const [t] = await app.db.select({ base: tenants.taxaFaltasBase, desde: tenants.goLiveEm }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t).toEqual({ base: 18.5, desde: '2026-10-01' });
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '120', goLiveEm: '' }, ADMIN, app.db)).rejects.toThrow(MSG_METRICAS.taxa);
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '', goLiveEm: '31/02/2026' }, ADMIN, app.db)).rejects.toThrow(MSG_METRICAS.data);
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '', goLiveEm: '2026-02-31' }, ADMIN, app.db)).rejects.toThrow(MSG_METRICAS.data);
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '-1', goLiveEm: '' }, ADMIN, app.db)).rejects.toThrow(MSG_METRICAS.taxa);
    for (const taxaBase of ['abc', '1e2', '0x10', '18,555', '100,01']) {
      await expect(salvarMetricasBase(T.tenantId, { taxaBase, goLiveEm: '' }, ADMIN, app.db), taxaBase).rejects.toThrow(MSG_METRICAS.taxa);
    }
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '', goLiveEm: '2026-13-01' }, ADMIN, app.db)).rejects.toThrow(MSG_METRICAS.data);
    // recusas não gravam nada; vazio apaga os dois
    expect((await app.db.select({ base: tenants.taxaFaltasBase }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].base).toBe(18.5);
    await salvarMetricasBase(T.tenantId, { taxaBase: ' ', goLiveEm: '' }, ADMIN, app.db);
    const [vazio] = await app.db.select({ base: tenants.taxaFaltasBase, desde: tenants.goLiveEm }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(vazio).toEqual({ base: null, desde: null });
  });
  it('salvarMetricasBase: tenant inexistente → ContaNaoEncontradaError (M9)', async () => {
    await expect(salvarMetricasBase(randomUUID(), { taxaBase: '10', goLiveEm: '' }, ADMIN, app.db)).rejects.toBeInstanceOf(ContaNaoEncontradaError);
  });
});

describe('Plano 11 (US-100) — limite de IA do consultório', () => {
  it('aceita 0 a 1000 com até 2 casas (vírgula ou ponto) e grava ajustar_cota_ia; fora disso: "Informe um valor entre 0 e 1000"', async () => {
    const T = await novoTenant(app.db);
    const admin = randomUUID();
    await ajustarCotaIa(T.tenantId, '25,50', admin, app.db);
    const [t] = await app.db.select({ c: tenants.iaCotaMensalUsd }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t.c).toBe(25.5);
    for (const ruim of ['1000,01', '-1', 'abc', '', '12,345']) await expect(ajustarCotaIa(T.tenantId, ruim, admin, app.db)).rejects.toThrow(MSG_COTA_IA);
    expect(await app.db.select().from(adminActions).where(eq(adminActions.alvoTenantId, T.tenantId))).toHaveLength(1);
  });

  it('metricasDeIaPorTenant lê só a função SECURITY DEFINER (contagens e somas)', async () => {
    const T = await novoTenant(app.db);
    expect((await metricasDeIaPorTenant(app.db)).get(T.tenantId)).toEqual({ tarefasMes: 0, custoMesMicroUsd: 0 });
  });
});
