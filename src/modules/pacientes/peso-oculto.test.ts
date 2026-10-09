import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { PacienteBloqueadoError } from './base';
import { definirPesoOculto, pesoOcultoNaTransacao, semPeso, SERIES_DO_PESO } from './peso-oculto';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const opcao = (T: Awaited<ReturnType<typeof novoTenant>>, id: string) =>
  withTenant(T.ctx, (tx) => tx.select({ em: patients.pesoOcultoNoAppEm }).from(patients).where(eq(patients.id, id)), app.db).then((r) => r[0].em);

describe('"Não mostrar peso no app" (Plano 16, G-D1, RN-203 a RN-205)', () => {
  it('a nutricionista liga (com a data) e desliga; ligar de novo mantém a data; cada troca vira audit_log com o nome dela e com O QUE foi feito (peso_no_app criar/excluir)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const em = new Date('2026-10-08T13:00:00Z');
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db, agora: em });
    expect(await opcao(T, p.id)).toEqual(em);
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db, agora: new Date('2026-10-09T13:00:00Z') });
    expect(await opcao(T, p.id)).toEqual(em); // já ligada: nada muda, nenhuma linha nova na trilha
    await definirPesoOculto(T.ctx, p.id, false, { db: app.db });
    expect(await opcao(T, p.id)).toBeNull();
    const trilha = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'patients'), eq(auditLog.entidadeId, p.id), eq(auditLog.acao, 'alterar'))), app.db);
    expect(trilha.map((l) => l.actorUserId)).toEqual([T.nutriId, T.nutriId]);
    // correção da revisão do plano (spec §10, R-193): a linha genérica de patients não diz o que mudou e a coluna volta a
    // nulo ao desligar — a decisão clínica tem linha própria, na mesma transação do UPDATE
    const decisao = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'peso_no_app'), eq(auditLog.patientId, p.id))).orderBy(auditLog.criadoEm), app.db);
    expect(decisao.map((l) => [l.acao, l.actorUserId, l.entidadeId])).toEqual([['criar', T.nutriId, p.id], ['excluir', T.nutriId, p.id]]);
  });

  it('só a equipe: a sessão de paciente é recusada antes do banco; bloqueado ou anonimizado é só leitura', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await expect(definirPesoOculto(ctxPaciente(T.tenantId, p.id), p.id, true, { db: app.db })).rejects.toThrow(/só pela equipe/);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(definirPesoOculto(T.ctx, p.id, true, { db: app.db })).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('pesoOcultoNaTransacao lê a opção do próprio prontuário pela sessão do paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ler = () => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => pesoOcultoNaTransacao(tx, p.id), app.db);
    expect(await ler()).toBe(false);
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db });
    expect(await ler()).toBe(true);
  });

  it('G-D6 ★ = a: esconde peso e IMC; o resto das séries fica', () => {
    expect(SERIES_DO_PESO).toEqual(['peso', 'imc']);
    expect(semPeso([{ id: 'peso' }, { id: 'imc' }, { id: 'perc_gordura' }, { id: 'circ_cintura' }]).map((s) => s.id)).toEqual(['perc_gordura', 'circ_cintura']);
  });
});
