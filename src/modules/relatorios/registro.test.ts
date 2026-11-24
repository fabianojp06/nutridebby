import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { ENTIDADE_ROTULO, listAccessHistory, rotuloDaAcao } from '@/modules/plataforma/audit';
import type { Periodo } from './periodo';
import { registrarExportacao } from './registro';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const P: Periodo = { de: '2026-01', ate: '2026-06', meses: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'] };

/**
 * A trilha dos Relatórios, lida **dentro** de `withTenant` com a sessão da nutricionista (a RLS de `audit_log` esconderia
 * tudo fora dela e o "0 linhas" passaria calado). O controle positivo de cada caso é a própria linha gravada aparecer pela
 * mesma leitura.
 */
const trilha = (T: TenantDeTeste) =>
  withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.tenantId, T.tenantId), eq(auditLog.entidade, 'relatorios'))).orderBy(auditLog.criadoEm), app.db);

/** RN-493: o CSV e a impressão gravam `exportar` (entidade `relatorios`) na transação da leitura; nunca `ler`. */
describe('registrarExportacao', () => {
  it('agregado: uma linha "exportar" sem paciente, com o ator, o IP e entidade_id "{secao}|{de}..{ate}|todos"', async () => {
    const T = await novoTenant(app.db);
    expect(await trilha(T)).toEqual([]);
    await withTenant(T.ctx, (tx) => registrarExportacao(tx, { secao: 'agenda', periodo: P, localId: null }), app.db);
    const log = await trilha(T);
    expect(log).toHaveLength(1); // controle positivo: a leitura enxerga a linha gravada
    expect(log[0]).toMatchObject({
      acao: 'exportar',
      entidade: 'relatorios',
      entidadeId: 'agenda|2026-01..2026-06|todos',
      patientId: null,
      actorUserId: T.nutriId,
      ip: T.ctx.ip,
    });
  });

  it('com local: o id do local no lugar de "todos"', async () => {
    const T = await novoTenant(app.db);
    const local = randomUUID();
    await withTenant(T.ctx, (tx) => registrarExportacao(tx, { secao: 'financeiro', periodo: P, localId: local }), app.db);
    expect((await trilha(T)).map((l) => l.entidadeId)).toEqual([`financeiro|2026-01..2026-06|${local}`]);
  });

  it('Ranking: uma linha por paciente da lista (repetido conta uma vez), cada uma no Histórico como "Exportou — Relatórios"', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const caio = await novoPaciente(app.db, T.ctx, { nome: 'Caio Reis' }); // fora da lista
    await withTenant(T.ctx, (tx) => registrarExportacao(tx, { secao: 'ranking', periodo: P, localId: null, pacientes: [ana.id, bia.id, ana.id] }), app.db);
    const log = await trilha(T);
    expect(log.map((l) => [l.acao, l.patientId, l.entidadeId]).sort()).toEqual(
      [
        ['exportar', ana.id, 'ranking|2026-01..2026-06|todos'],
        ['exportar', bia.id, 'ranking|2026-01..2026-06|todos'],
      ].sort(),
    );
    for (const l of log) expect(l).toMatchObject({ actorUserId: T.nutriId, ip: T.ctx.ip });

    // no Histórico de acessos de quem está na lista: "Exportou — Relatórios"; de quem não está, nada dos Relatórios
    const historico = await listAccessHistory(T.ctx, ana.id, 1, app.db);
    const item = historico.itens.find((i) => i.entidade === 'relatorios');
    expect(item).toBeDefined();
    expect(`${rotuloDaAcao(item!)} — ${ENTIDADE_ROTULO[item!.entidade]}`).toBe('Exportou — Relatórios');
    const doCaio = await listAccessHistory(T.ctx, caio.id, 1, app.db);
    expect(doCaio.itens.length).toBeGreaterThan(0); // controle positivo: o "criar" do cadastro dele está lá
    expect(doCaio.itens.some((i) => i.entidade === 'relatorios')).toBe(false);
  });

  it('Ranking vazio: uma linha sem paciente (o download fica registrado)', async () => {
    const T = await novoTenant(app.db);
    await withTenant(T.ctx, (tx) => registrarExportacao(tx, { secao: 'ranking', periodo: P, localId: null, pacientes: [] }), app.db);
    expect((await trilha(T)).map((l) => [l.acao, l.patientId, l.entidadeId])).toEqual([['exportar', null, 'ranking|2026-01..2026-06|todos']]);
  });

  it('nunca grava "ler": nenhuma linha de leitura em nenhuma das gravações', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, async (tx) => {
      await registrarExportacao(tx, { secao: 'pacientes', periodo: P, localId: null });
      await registrarExportacao(tx, { secao: 'ranking', periodo: P, localId: null, pacientes: [ana.id] });
    }, app.db);
    const log = await trilha(T);
    expect(log).toHaveLength(2); // controle positivo
    expect(log.every((l) => l.acao === 'exportar')).toBe(true);
  });

  it('na transação de quem chama: se ela falhar depois, o registro some junto', async () => {
    const T = await novoTenant(app.db);
    await expect(
      withTenant(T.ctx, async (tx) => {
        await registrarExportacao(tx, { secao: 'agenda', periodo: P, localId: null });
        throw new Error('falha depois da leitura');
      }, app.db),
    ).rejects.toThrow('falha depois da leitura');
    expect(await trilha(T)).toEqual([]);
    // controle positivo: a mesma chamada sem a falha grava
    await withTenant(T.ctx, (tx) => registrarExportacao(tx, { secao: 'agenda', periodo: P, localId: null }), app.db);
    expect(await trilha(T)).toHaveLength(1);
  });

  it('erro de programação: Ranking sem a lista, ou agregado com pacientes', async () => {
    const T = await novoTenant(app.db);
    await expect(withTenant(T.ctx, (tx) => registrarExportacao(tx, { secao: 'ranking', periodo: P, localId: null }), app.db)).rejects.toThrow(RangeError);
    await expect(
      withTenant(T.ctx, (tx) => registrarExportacao(tx, { secao: 'agenda', periodo: P, localId: null, pacientes: [randomUUID()] }), app.db),
    ).rejects.toThrow(RangeError);
    expect(await trilha(T)).toEqual([]);
  });
});
