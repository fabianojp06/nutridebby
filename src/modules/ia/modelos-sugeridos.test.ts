import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { geracaoNoBanco, IA_TESTE, iaPronta } from '../../../test/ia';
import { novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { iaGeracoesModelos, iaUso, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { desativarIa } from './ativacao';
import { MSG_IA, MSG_MODELOS_IA } from './constantes';
import { estadoDaGeracao, pedirModelos, situacaoDasAreas } from './modelos-sugeridos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
const deps = { db: app.db, agora, ia: { ...IA_TESTE, retencao: null }, avisarTeto: async () => 0 }; // sem retenção aceita: os modelos não dependem dela (A-D22 (c))
async function consultorio(o: { cotaUsd?: number; aditivo?: string } = {}) {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId, o);
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return { T, tenant: t as TenantRow };
}

describe('pedirModelos (US-123, RN-124, D19)', () => {
  it('cria a geração na fila com a reserva de US$ 1,00 (tipo modelos_area) — sem paciente e sem retenção aceita', async () => {
    const { T, tenant } = await consultorio();
    const id = await pedirModelos(T.ctx, tenant, 'diabetes', deps);
    const [g] = await withTenant(T.ctx, (tx) => tx.select().from(iaGeracoesModelos).where(eq(iaGeracoesModelos.id, id)), app.db);
    expect(g).toMatchObject({ area: 'diabetes', status: 'na_fila', modelo: 'claude-sonnet-5-5', reservaMicroUsd: 1_000_000, pedidoPor: T.nutriId });
    const [u] = await withTenant(T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, id)), app.db);
    expect(u).toMatchObject({ tipo: 'modelos_area', situacao: 'reservado', custoMicroUsd: 1_000_000 });
    // a fila leva só ids (RNF-104), na mesma transação da geração
    const jobs = await (await getBoss()).findJobs('ia-assistente');
    expect(jobs.map((j) => j.data)).toContainEqual({ tenantId: T.tenantId, geracaoId: id });
  });

  it('um pacote por vez; área fora da lista; limite do mês; aditivo antigo', async () => {
    const { T, tenant } = await consultorio();
    await pedirModelos(T.ctx, tenant, 'diabetes', deps);
    await expect(pedirModelos(T.ctx, tenant, 'gestacao', deps)).rejects.toMatchObject({ mensagem: MSG_MODELOS_IA.umPorVez });
    await expect(pedirModelos(T.ctx, tenant, 'infantil', deps)).rejects.toMatchObject({ mensagem: MSG_MODELOS_IA.areaInvalida });
    const pouca = await consultorio({ cotaUsd: 0.5 });
    await expect(pedirModelos(pouca.T.ctx, pouca.tenant, 'diabetes', deps)).rejects.toMatchObject({ mensagem: MSG_IA.cotaAcabou });
    const antigo = await consultorio({ aditivo: '0.1-provisorio' });
    await expect(pedirModelos(antigo.T.ctx, antigo.tenant, 'diabetes', deps)).rejects.toMatchObject({ mensagem: MSG_IA.aditivoDesatualizado });
  });

  it('IA desativada entre a leitura do tenant e o pedido: decide com a linha travada (sem geração nem reserva)', async () => {
    const { T, tenant } = await consultorio();
    await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    await expect(pedirModelos(T.ctx, tenant, 'diabetes', deps)).rejects.toMatchObject({ mensagem: MSG_IA.indisponivel });
    const gs = await withTenant(T.ctx, (tx) => tx.select().from(iaGeracoesModelos), app.db);
    const us = await withTenant(T.ctx, (tx) => tx.select().from(iaUso), app.db);
    expect(gs).toEqual([]);
    expect(us).toEqual([]);
  });

  it('desativar a IA cancela a geração na fila e estorna (US-101, D19)', async () => {
    const { T, tenant } = await consultorio();
    const id = await pedirModelos(T.ctx, tenant, 'idosos', deps);
    await desativarIa(T.ctx, { db: app.db, agora });
    const [g] = await withTenant(T.ctx, (tx) => tx.select().from(iaGeracoesModelos).where(eq(iaGeracoesModelos.id, id)), app.db);
    const [u] = await withTenant(T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, id)), app.db);
    expect(g.status).toBe('cancelada');
    expect(u.situacao).toBe('estornado');
  });

  it('situacaoDasAreas: "Gerado em" da última pronta de cada área e o pacote em andamento', async () => {
    const { T } = await consultorio();
    await geracaoNoBanco(app.db, T.ctx, { area: 'diabetes', status: 'pronta', concluidoEm: new Date('2026-10-05T12:00:00Z') });
    const andamento = await geracaoNoBanco(app.db, T.ctx, { area: 'gestacao', status: 'processando' });
    const s = await situacaoDasAreas(T.ctx, app.db);
    expect(s.diabetes.geradoEm?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    expect(s.gestacao.emAndamento).toEqual({ id: andamento });
    expect(s.idosos).toEqual({ geradoEm: null, emAndamento: null, falhou: null });
  });

  it('estadoDaGeracao: só situação; id inválido ou de outro consultório → nulo', async () => {
    const { T } = await consultorio();
    const outro = await consultorio();
    const id = await geracaoNoBanco(app.db, T.ctx, { status: 'falhou', erro: 'limite_custo' });
    expect(await estadoDaGeracao(T.ctx, id, app.db)).toEqual({ status: 'falhou', erro: 'limite_custo' });
    expect(await estadoDaGeracao(outro.T.ctx, id, app.db)).toBeNull();
    expect(await estadoDaGeracao(T.ctx, 'nao-e-uuid', app.db)).toBeNull();
  });
});
