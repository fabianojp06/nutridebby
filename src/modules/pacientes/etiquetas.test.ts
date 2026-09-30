import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, patients, patientTagLinks, patientTags } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';
import { etiquetasDoPaciente, EtiquetaError, listarEtiquetas, MSG_ETIQUETA, salvarEtiquetasDoPaciente } from './etiquetas';
import { listarPacientes } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('etiquetas (US-019)', () => {
  it('"Etiquetar e filtrar": a lista por "gestante" traz exatamente os 3 etiquetados', async () => {
    const T = await novoTenant(app.db);
    const ps = await Promise.all(['Ana', 'Bia', 'Cris', 'Duda', 'Eva'].map((nome) => novoPaciente(app.db, T.ctx, { nome })));
    await salvarEtiquetasDoPaciente(T.ctx, ps[0].id, { etiquetas: [], nova: 'gestante' }, app.db);
    const [gestante] = await listarEtiquetas(T.ctx, app.db);
    for (const p of [ps[2], ps[4]]) await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [gestante.id] }, app.db);
    expect((await listarPacientes(T.ctx, { etiquetaId: gestante.id }, app.db)).map((p) => p.nome)).toEqual(['Ana', 'Cris', 'Eva']);
    expect(await listarEtiquetas(T.ctx, app.db)).toEqual([{ id: gestante.id, nome: 'gestante', pacientes: 3 }]);
    expect(await listarPacientes(T.ctx, { etiquetaId: 'abc' }, app.db)).toEqual([]);
    // filtrar por etiqueta revela quem tem a condição (dado de saúde): uma leitura auditada por paciente devolvido
    const lidos = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'etiquetas'), eq(auditLog.acao, 'ler'))), app.db);
    expect(lidos.map((l) => l.patientId).sort()).toEqual([ps[0].id, ps[2].id, ps[4].id].sort());
    // a contagem do seletor é a mesma da lista padrão (só ativos)
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, ps[4].id)), app.db);
    expect(await listarEtiquetas(T.ctx, app.db)).toEqual([{ id: gestante.id, nome: 'gestante', pacientes: 2 }]);
  });

  it('"Gestante" reaproveita "gestante"; salvar troca o conjunto inteiro; auditoria "criar"/"excluir" com a nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: 'gestante' }, app.db);
    await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: '  Gestante ' }, app.db);
    expect(await listarEtiquetas(T.ctx, app.db)).toHaveLength(1);
    await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: 'diabetes' }, app.db);
    expect((await etiquetasDoPaciente(T.ctx, p.id, app.db)).map((e) => e.nome)).toEqual(['diabetes']);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.entidade, 'etiquetas'))), app.db);
    expect(log.map((l) => l.acao).sort()).toEqual(['criar', 'criar', 'excluir', 'ler']);
    expect(log.every((l) => l.actorUserId === T.nutriId)).toBe(true);
  });

  it('nome com mais de 40 caracteres é recusado; etiqueta de outro tenant é ignorada; bloqueado e outro tenant recusam', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const p = await novoPaciente(app.db, A.ctx);
    await expect(salvarEtiquetasDoPaciente(A.ctx, p.id, { etiquetas: [], nova: 'x'.repeat(41) }, app.db)).rejects.toThrow(MSG_ETIQUETA.nome);
    await expect(salvarEtiquetasDoPaciente(A.ctx, p.id, { etiquetas: [], nova: 'x'.repeat(41) }, app.db)).rejects.toBeInstanceOf(EtiquetaError);
    const pb = await novoPaciente(app.db, B.ctx);
    await salvarEtiquetasDoPaciente(B.ctx, pb.id, { etiquetas: [], nova: 'de-b' }, app.db);
    const [deB] = await listarEtiquetas(B.ctx, app.db);
    await salvarEtiquetasDoPaciente(A.ctx, p.id, { etiquetas: [deB.id, randomUUID(), 'lixo'] }, app.db);
    expect(await etiquetasDoPaciente(A.ctx, p.id, app.db)).toEqual([]);
    await expect(salvarEtiquetasDoPaciente(A.ctx, pb.id, { etiquetas: [] }, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const bloqueado = await novoPaciente(app.db, A.ctx, { status: 'bloqueado' });
    await expect(salvarEtiquetasDoPaciente(A.ctx, bloqueado.id, { etiquetas: [], nova: 'x' }, app.db)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('"Paciente não vê etiquetas": na sessão dele, nenhuma etiqueta nem vínculo, nem os próprios', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await salvarEtiquetasDoPaciente(T.ctx, p.id, { etiquetas: [], nova: 'diabetes' }, app.db);
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await withTenant(ctx, (tx) => tx.select().from(patientTags), app.db)).toEqual([]);
    expect(await withTenant(ctx, (tx) => tx.select().from(patientTagLinks), app.db)).toEqual([]);
    expect(await etiquetasDoPaciente(ctx, p.id, app.db)).toEqual([]);
  });
});
