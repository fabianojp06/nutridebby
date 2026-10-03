import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { escolherVinculo, vinculosDaConta, type Vinculo } from './vinculos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('vínculos da conta (D2, §3, RN-08)', () => {
  it('lista os vínculos ativos em todos os tenants, com o nome do consultório; arquivado, bloqueado e anonimizado somem', async () => {
    const A = await novoTenant(app.db, 'Debby Silva');
    const B = await novoTenant(app.db, 'Bia Nutri');
    const C = await novoTenant(app.db, 'Carla');
    const { userId } = await pacienteComConta(app.db, A);
    await pacienteComConta(app.db, B, { userId });
    const { paciente: pc } = await pacienteComConta(app.db, C, { userId });
    await withTenant(C.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, pc.id)), app.db);
    const D = await novoTenant(app.db, 'Dora');
    const { paciente: pd } = await pacienteComConta(app.db, D, { userId });
    await withTenant(D.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, pd.id)), app.db);
    const E = await novoTenant(app.db, 'Eva');
    const { paciente: pe } = await pacienteComConta(app.db, E, { userId });
    // anonimizado com status ativo (não acontece na prática): o filtro olha também a data, não só o status
    await withTenant(E.ctx, (tx) => tx.update(patients).set({ anonimizadoEm: new Date() }).where(eq(patients.id, pe.id)), app.db);
    const v = await vinculosDaConta(userId, { db: app.db });
    expect(v.map((x) => x.nomeNutri)).toEqual(['Bia Nutri', 'Debby Silva']);
    expect(v[0]).toMatchObject({ tenantId: B.tenantId, tenantStatus: 'ativa' });
    const todos = await vinculosDaConta(userId, { db: app.db, todos: true });
    expect(todos).toHaveLength(5);
    expect(todos.find((x) => x.tenantId === C.tenantId)).toMatchObject({ pacienteStatus: 'arquivado', anonimizado: false });
    expect(todos.find((x) => x.tenantId === D.tenantId)).toMatchObject({ pacienteStatus: 'bloqueado', anonimizado: false });
    expect(todos.find((x) => x.tenantId === E.tenantId)).toMatchObject({ pacienteStatus: 'ativo', anonimizado: true });
  });

  it('tenant suspenso continua na lista, com o status (a escolha o mostra desabilitado; a sessão decide pelo escolherVinculo)', async () => {
    const A = await novoTenant(app.db);
    const { userId } = await pacienteComConta(app.db, A);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    expect((await vinculosDaConta(userId, { db: app.db }))[0].tenantStatus).toBe('suspensa');
  });

  it('escolherVinculo: 0 → sem acesso; 1 → entra; 2+ → o do cookie, se ainda for vínculo; senão escolher', () => {
    const a: Vinculo = { tenantId: '00000000-0000-4000-8000-00000000000a', patientId: '00000000-0000-4000-8000-0000000000a1', nomeNutri: 'A', tenantStatus: 'ativa' };
    const b: Vinculo = { ...a, tenantId: '00000000-0000-4000-8000-00000000000b', patientId: '00000000-0000-4000-8000-0000000000b1', nomeNutri: 'B' };
    expect(escolherVinculo([], a.tenantId)).toEqual({ tipo: 'sem_acesso' });
    expect(escolherVinculo([a], undefined)).toEqual({ tipo: 'ok', vinculo: a });
    expect(escolherVinculo([a], b.tenantId)).toEqual({ tipo: 'ok', vinculo: a }); // cookie velho/forjado com 1 vínculo: o único
    expect(escolherVinculo([a, b], b.tenantId)).toEqual({ tipo: 'ok', vinculo: b });
    expect(escolherVinculo([a, b], undefined)).toEqual({ tipo: 'escolher' });
    expect(escolherVinculo([a, b], '00000000-0000-4000-8000-00000000000c')).toEqual({ tipo: 'escolher' }); // forjado
  });

  it('escolherVinculo com consultório suspenso (RN-15 barra só aquele vínculo)', () => {
    const a: Vinculo = { tenantId: '00000000-0000-4000-8000-00000000000a', patientId: '00000000-0000-4000-8000-0000000000a1', nomeNutri: 'A', tenantStatus: 'ativa' };
    const b: Vinculo = { ...a, tenantId: '00000000-0000-4000-8000-00000000000b', patientId: '00000000-0000-4000-8000-0000000000b1', nomeNutri: 'B' };
    const aSusp: Vinculo = { ...a, tenantStatus: 'suspensa' };
    const bSusp: Vinculo = { ...b, tenantStatus: 'suspensa' };
    expect(escolherVinculo([aSusp], aSusp.tenantId)).toEqual({ tipo: 'suspensa' }); // o único vínculo suspenso
    expect(escolherVinculo([aSusp, bSusp], aSusp.tenantId)).toEqual({ tipo: 'suspensa' }); // todos suspensos
    expect(escolherVinculo([aSusp, b], aSusp.tenantId)).toEqual({ tipo: 'escolher' }); // cookie no suspenso, outro ativo
    expect(escolherVinculo([aSusp, b], undefined)).toEqual({ tipo: 'escolher' });
    expect(escolherVinculo([aSusp, b], b.tenantId)).toEqual({ tipo: 'ok', vinculo: b });
  });
});
