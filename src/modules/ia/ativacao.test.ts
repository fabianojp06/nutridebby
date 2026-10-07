import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tarefaNoBanco } from '../../../test/ia';
import { consents, iaTarefas, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { ativarIa, AtivacaoIaError, desativarIa, MSG_ATIVACAO } from './ativacao';
import { IA_ADITIVO_TERMO, IA_ADITIVO_VERSAO } from './textos-legais';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
afterEach(() => vi.restoreAllMocks());
const agora = new Date('2026-10-06T15:00:00Z');
const tenantDe = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0];

describe('US-101 — ativar e desativar a IA do consultório (A-D20)', () => {
  it('sem a liberação da admin: "A IA ainda não foi liberada…" e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    await expect(ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: '203.0.113.5' }, true, { db: app.db, agora })).rejects.toMatchObject({ mensagem: MSG_ATIVACAO.naoLiberada });
    expect(await app.db.select().from(consents).where(eq(consents.userId, T.nutriId))).toEqual([]);
  });

  it('sem marcar o aceite: recusa', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaLiberada: true }).where(eq(tenants.id, T.tenantId));
    await expect(ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: null }, false, { db: app.db, agora })).rejects.toBeInstanceOf(AtivacaoIaError);
  });

  it('ativar: aceite em consents (termo, usuária, consultório, data, IP) e tenants.ia_ativada_em/ia_aditivo_versao na mesma transação', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaLiberada: true }).where(eq(tenants.id, T.tenantId));
    await ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: '203.0.113.5' }, true, { db: app.db, agora });
    const [c] = await app.db.select().from(consents).where(and(eq(consents.userId, T.nutriId), eq(consents.termoVersao, IA_ADITIVO_TERMO)));
    expect(c).toMatchObject({ tenantId: T.tenantId, patientId: null, ip: '203.0.113.5', aceitoEm: agora });
    expect(await tenantDe(T.tenantId)).toMatchObject({ iaAtivadaEm: agora, iaAditivoVersao: IA_ADITIVO_VERSAO });
    // reativar a mesma versão depois de desativar: o aceite já existe (um só), a IA volta
    await desativarIa(T.ctx, { db: app.db, agora });
    await ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: '203.0.113.5' }, true, { db: app.db, agora: new Date(agora.getTime() + 1000) });
    expect(await app.db.select().from(consents).where(and(eq(consents.userId, T.nutriId), eq(consents.termoVersao, IA_ADITIVO_TERMO)))).toHaveLength(1);
    expect((await tenantDe(T.tenantId)).iaAtivadaEm).toEqual(new Date(agora.getTime() + 1000));
  });

  it('Minor 8 (revisão final): ativar de novo com a IA já ativa (versão nova do aditivo, clique repetido) mantém a data da ativação', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaLiberada: true, iaAtivadaEm: agora, iaAditivoVersao: '0.0-antigo' }).where(eq(tenants.id, T.tenantId));
    await ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: null }, true, { db: app.db, agora: new Date(agora.getTime() + 86_400_000) });
    expect(await tenantDe(T.tenantId)).toMatchObject({ iaAtivadaEm: agora, iaAditivoVersao: IA_ADITIVO_VERSAO });
  });

  it('D21 (NGS1.07): toda ativação deixa trilha no log com a usuária — inclusive a reativação, que não grava consents novo', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaLiberada: true }).where(eq(tenants.id, T.tenantId));
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const ativacoes = () => info.mock.calls.filter((c) => c[1] === 'IA ativada pela nutricionista').map((c) => c[0]);
    await ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: '203.0.113.5' }, true, { db: app.db, agora });
    expect(ativacoes()).toEqual([{ tenantId: T.tenantId, userId: T.nutriId, aditivoVersao: IA_ADITIVO_VERSAO, aceiteNovo: true }]);
    await desativarIa(T.ctx, { db: app.db, agora });
    await ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: '203.0.113.9' }, true, { db: app.db, agora: new Date(agora.getTime() + 1000) });
    expect(ativacoes()).toEqual([
      { tenantId: T.tenantId, userId: T.nutriId, aditivoVersao: IA_ADITIVO_VERSAO, aceiteNovo: true },
      { tenantId: T.tenantId, userId: T.nutriId, aditivoVersao: IA_ADITIVO_VERSAO, aceiteNovo: false },
    ]);
    // sem IP no log (só ids)
    expect(JSON.stringify(ativacoes())).not.toContain('203.0.113');
  });

  it('recusada (sem liberação) não registra ativação no log', async () => {
    const T = await novoTenant(app.db);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    await expect(ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: null }, true, { db: app.db, agora })).rejects.toBeInstanceOf(AtivacaoIaError);
    expect(info.mock.calls.filter((c) => c[1] === 'IA ativada pela nutricionista')).toEqual([]);
  });

  it('desativar: tarefas na fila e prontas ficam canceladas e esvaziadas (as linhas ficam)', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaLiberada: true, iaAtivadaEm: agora, iaAditivoVersao: IA_ADITIVO_VERSAO }).where(eq(tenants.id, T.tenantId));
    const p = await novoPaciente(app.db, T.ctx);
    const pronta = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'pronta', resultado: { versao: 1, dataColeta: null, linhas: [], descartadas: 0 } });
    await desativarIa(T.ctx, { db: app.db, agora });
    expect((await tenantDe(T.tenantId)).iaAtivadaEm).toBeNull();
    const [t] = await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, pronta)), app.db);
    expect(t).toMatchObject({ status: 'cancelada', resultado: null, encerradoPor: T.nutriId });
  });

  it('conta suspensa não ativa (RN-15), mesmo com a IA liberada', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaLiberada: true, status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    await expect(ativarIa({ userId: T.nutriId, tenantId: T.tenantId, ip: null }, true, { db: app.db, agora })).rejects.toMatchObject({ mensagem: MSG_ATIVACAO.naoLiberada });
  });
});
