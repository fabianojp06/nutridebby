import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, envioRecebido } from '../../test/exames-enviados';
import { auditLog, examSubmissionFiles, examSubmissions, exams, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { excluirExame } from '@/modules/pacientes/exames';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envios-schema-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const codigo = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
const falhaCom = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return codigo(e);
  }
  return 'sem erro';
};
const comoWorker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const conta = randomUUID();
  return { T, p, conta, comoPaciente: ctxPaciente(T.tenantId, p.id, conta) };
}
const mudar = (ctx: TenantContext, id: string, set: Partial<typeof examSubmissions.$inferInsert>) =>
  withTenant(ctx, (tx) => tx.update(examSubmissions).set(set).where(eq(examSubmissions.id, id)).returning({ id: examSubmissions.id }), app.db);

describe('Plano 12 — banco dos exames enviados (spec C v0.3 §13, §6.5)', () => {
  it('D18 = a: o tenant nasce com o recebimento desligado e sem aviso enviado', async () => {
    const T = await novoTenant(app.db);
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t).toMatchObject({ examesPacienteAtivadoEm: null, examesAvisoEm: null });
  });

  it('sessão de paciente: cria só envio "processando", dele e com a própria conta; a auditoria grava o paciente como ator', async () => {
    const { T, p, conta, comoPaciente } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const base = { tenantId: T.tenantId, patientId: p.id, enviadoPor: conta, dataColeta: '2026-09-28' };
    const inserir = (v: Partial<typeof examSubmissions.$inferInsert>) => withTenant(comoPaciente, (tx) => tx.insert(examSubmissions).values({ ...base, ...v }), app.db);
    await inserir({ status: 'processando' });
    expect(await falhaCom(inserir({ status: 'recebido' }))).toBe('42501');
    expect(await falhaCom(inserir({ status: 'processando', enviadoPor: randomUUID() }))).toBe('42501');
    expect(await falhaCom(inserir({ status: 'processando', patientId: outro.id }))).toBe('42501');
    const [linha] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'exames_enviados'), eq(auditLog.patientId, p.id))), app.db);
    expect(linha).toMatchObject({ acao: 'criar', actorUserId: conta });
  });

  it('RN-166: o paciente só cancela o próprio envio "recebido" e não muda nenhuma outra coluna; não aceita', async () => {
    const { T, p, comoPaciente } = await cenario();
    const id = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    expect(await falhaCom(mudar(comoPaciente, id, { status: 'cancelado', nome: 'Outro nome' }))).toBe('42501');
    expect(await falhaCom(mudar(comoPaciente, id, { status: 'aceito', revisadoPor: randomUUID(), revisadoEm: new Date() }))).toBe('42501');
    expect(await mudar(comoPaciente, id, { status: 'cancelado', updatedAt: new Date() })).toHaveLength(1);
    expect(await mudar(comoPaciente, id, { status: 'cancelado' })).toHaveLength(0); // já não é "recebido": a política esconde
    const processando = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    expect(await mudar(comoPaciente, processando, { status: 'cancelado' })).toHaveLength(0);
    // revisão do plano: o envio "recebido" de verdade tem o PDF limpo apontado; o cancelamento o mantém até a limpeza do worker
    const comPdf = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 0 });
    expect(await mudar(comoPaciente, comPdf.id, { status: 'cancelado', updatedAt: new Date() })).toHaveLength(1);
    const [cancelado] = await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, comPdf.id)), app.db);
    expect(cancelado).toMatchObject({ status: 'cancelado', arquivoPath: comPdf.pdf });
    expect(await mudar(comoWorker(T.tenantId), comPdf.id, { arquivoPath: null })).toHaveLength(1); // o job de limpeza solta o ponteiro
  });

  it('PM-14 / NGS1.03: cada papel só faz a sua transição; transição pulada, final reaberta e coluna fixa são recusadas', async () => {
    const { T, p } = await cenario();
    const worker = comoWorker(T.tenantId);
    const proc = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    expect(await falhaCom(mudar(T.ctx, proc, { status: 'recebido' }))).toBe('42501'); // "recebido" é do worker
    expect(await falhaCom(mudar(T.ctx, proc, { status: 'falhou', motivoFalha: 'conversao' }))).toBe('42501');
    expect(await falhaCom(mudar(T.ctx, proc, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() }))).toBe('42501'); // pula etapa
    await mudar(worker, proc, { status: 'falhou', motivoFalha: 'conversao' });
    expect(await falhaCom(mudar(worker, proc, { status: 'recebido' }))).toBe('42501'); // "falhou" é final
    const rec = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    expect(await falhaCom(mudar(worker, rec, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() }))).toBe('42501'); // o worker não aceita
    await mudar(T.ctx, rec, { status: 'recusado', motivoRecusa: 'ilegivel', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect(await falhaCom(mudar(T.ctx, rec, { status: 'aceito' }))).toBe('42501');
    expect(await falhaCom(mudar(T.ctx, rec, { motivoRecusa: 'repetido' }))).toBe('42501'); // a revisão não é reescrita
    expect(await falhaCom(mudar(T.ctx, rec, { dataColeta: '2026-01-01' }))).toBe('42501');
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await falhaCom(mudar(T.ctx, rec, { patientId: outro.id }))).toBe('42501');
  });

  it('§6.5 itens 1 e 3 (revisão do plano): todo envio nasce "processando", para qualquer papel; a revisão sai em nome de quem revisa', async () => {
    const { T, p } = await cenario();
    const pdf = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir);
    const base = { tenantId: T.tenantId, patientId: p.id, enviadoPor: randomUUID(), dataColeta: '2026-09-28' };
    const inserir = (ctx: TenantContext, v: Partial<typeof examSubmissions.$inferInsert>) => withTenant(ctx, (tx) => tx.insert(examSubmissions).values({ ...base, ...v }), app.db);
    const revisao = { revisadoPor: T.nutriId, revisadoEm: new Date() };
    for (const ctx of [T.ctx, comoWorker(T.tenantId)]) {
      expect(await falhaCom(inserir(ctx, { status: 'recebido' }))).toBe('42501');
      expect(await falhaCom(inserir(ctx, { status: 'aceito', ...revisao }))).toBe('42501'); // não fabrica "Enviado pelo paciente"
      expect(await falhaCom(inserir(ctx, { status: 'processando', arquivoPath: pdf }))).toBe('42501');
      expect(await falhaCom(inserir(ctx, { status: 'processando', revisadoPor: T.nutriId }))).toBe('42501');
    }
    const rec = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    expect(await falhaCom(mudar(T.ctx, rec, { status: 'aceito', revisadoPor: randomUUID(), revisadoEm: new Date() }))).toBe('42501');
    expect(await mudar(T.ctx, rec, { status: 'aceito', ...revisao })).toHaveLength(1);
  });

  it('CHECKs: PDF limpo só em "recebido"/"cancelado" e só do tipo exame; motivo só na recusa; "outro" exige texto; falha com motivo; nome ≤ 120', async () => {
    const { T, p } = await cenario();
    const pdf = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir);
    const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
    const revisao = { revisadoPor: T.nutriId, revisadoEm: new Date() };
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', arquivoPath: pagina }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'outro', ...revisao }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'ilegivel', motivoRecusaTexto: 'x', ...revisao }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', ...revisao }))).toBe('23514'); // recusa sem motivo
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'falhou' }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', nome: 'x'.repeat(121) }))).toBe('23514');
    // o ponteiro do PDF limpo não fica em "aceito" nem em "expirado": a revisão e a expiração o soltam no mesmo UPDATE
    const rec = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', arquivoPath: pdf });
    expect(await falhaCom(mudar(comoWorker(T.tenantId), rec, { status: 'expirado' }))).toBe('23514');
    expect(await falhaCom(mudar(T.ctx, rec, { status: 'aceito', ...revisao }))).toBe('23514');
  });

  it('excluir o exame aceito deixa o envio com exam_id nulo (ON DELETE SET NULL (exam_id)); exame de outro paciente não serve', async () => {
    const { T, p } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const exame = async (patientId: string) =>
      (await withTenant(T.ctx, (tx) => tx.insert(exams).values({ tenantId: T.tenantId, patientId, data: '2026-09-28', titulo: 'Hemograma' }).returning({ id: exams.id }), app.db))[0].id;
    const revisao = { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() } as const;
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { ...revisao, examId: await exame(outro.id) }))).toBe('23503');
    const ex = await exame(p.id);
    const id = await envioNoBanco(app.db, T.ctx, p.id, { ...revisao, examId: ex });
    expect(await excluirExame(T.ctx, p.id, ex, { db: app.db, dataDir })).toBe(true);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db);
    expect(e).toMatchObject({ id, examId: null, status: 'aceito' });
  });

  it('NGS1.12.03: ninguém apaga envio de paciente ativo — nem a nutricionista nem o worker; o worker apaga o do bloqueado', async () => {
    const { T, p } = await cenario();
    const id = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    const apagar = (ctx: TenantContext) => withTenant(ctx, (tx) => tx.delete(examSubmissions).where(eq(examSubmissions.id, id)), app.db);
    expect(await falhaCom(apagar(T.ctx))).toBe('42501');
    expect(await falhaCom(apagar(comoWorker(T.tenantId)))).toBe('42501');
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    expect(await falhaCom(apagar(T.ctx))).toBe('42501');
    await apagar(comoWorker(T.tenantId));
    expect(await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db)).toEqual([]);
  });

  it('stored_files: o paciente grava exame_original (o dele), não grava exame_pagina nem exame, e não vê as páginas', async () => {
    const { T, p, comoPaciente } = await cenario();
    const arquivo = (tipo: string): SQL =>
      sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, ${tipo}, ${`${T.tenantId}/${tipo}/${randomUUID()}.jpg`}, 1, 'image/jpeg', ${p.id}) returning caminho`;
    const comoP = (q: SQL) => withTenant(comoPaciente, (tx) => tx.execute(q), app.db);
    expect((await comoP(arquivo('exame_original'))).rows).toHaveLength(1);
    for (const tipo of ['exame_pagina', 'exame']) expect(await falhaCom(comoP(arquivo(tipo))), tipo).toBe('42501');
    const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    const vistos = (await comoP(sql`select caminho from stored_files`)).rows.map((r) => r.caminho);
    expect(vistos).toContain(original);
    expect(vistos).not.toContain(pagina);
  });

  it('exam_submission_files: o paciente só insere a linha "original" do próprio envio "processando", com o próprio original; não lê as páginas', async () => {
    const { T, p, comoPaciente } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const envio = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    const recebido = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    const doOutro = await arquivoDeEnvio(app.db, T.ctx, outro.id, 'exame_original', dataDir);
    const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
    const linha = (submissionId: string, arquivoPath: string, papel = 'original') =>
      withTenant(comoPaciente, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId, arquivoPath, papel, ordem: 1 }), app.db);
    expect(await falhaCom(linha(envio, doOutro))).toBe('42501');
    expect(await falhaCom(linha(recebido, original))).toBe('42501');
    expect(await falhaCom(linha(envio, pagina, 'pagina'))).toBe('42501');
    await linha(envio, original);
    await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: envio, arquivoPath: pagina, papel: 'pagina', ordem: 1 }), app.db);
    const vistas = await withTenant(comoPaciente, (tx) => tx.select({ papel: examSubmissionFiles.papel }).from(examSubmissionFiles), app.db);
    expect(vistas).toEqual([{ papel: 'original' }]);
  });

  it('admin_metricas_exames_enviados(): só contagens por tenant (enviados no mês e aguardando); recusa rodar dentro de withTenant', async () => {
    const { T, p } = await cenario();
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    const antigo = new Date(Date.now() - 70 * 86_400_000);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', createdAt: antigo, updatedAt: antigo });
    const r = await app.db.execute<{ tenant_id: string; enviados_mes: string; pendentes: string }>(sql`select * from admin_metricas_exames_enviados()`);
    const linha = r.rows.find((x) => x.tenant_id === T.tenantId)!;
    expect(Object.keys(linha).sort()).toEqual(['enviados_mes', 'pendentes', 'tenant_id']);
    expect(Number(linha.enviados_mes)).toBe(3);
    expect(Number(linha.pendentes)).toBe(3);
    expect(await falhaCom(withTenant(T.ctx, (tx) => tx.execute(sql`select * from admin_metricas_exames_enviados()`), app.db))).toBe('55000');
  });
});
