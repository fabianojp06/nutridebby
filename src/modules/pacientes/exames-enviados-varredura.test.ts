import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, envioRecebido, esperarNaTrava } from '../../../test/exames-enviados';
import { closeDb } from '@/db/client';
import { examSubmissionFiles, examSubmissions, exams, notifications, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { limparEnvio, varrerEnvios } from './exames-enviados-varredura';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-varredura-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const semJobs = { findJobs: async () => [] } as unknown as Pick<PgBoss, 'findJobs'>;
const comJobVivo = { findJobs: async () => [{ state: 'retry' }] } as unknown as Pick<PgBoss, 'findJobs'>;
const AGORA = new Date('2026-10-07T15:00:00Z');
const atras = (ms: number) => new Date(AGORA.getTime() - ms);
const DIA = 86_400_000;
async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const bytes = async () => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].b;
  const ler = async (id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db))[0];
  const linhas = (id: string) => withTenant(T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)), app.db);
  const varrer = (boss = semJobs) => varrerEnvios({ db: app.db, dataDir, boss }, AGORA, { tenantId: T.tenantId });
  return { T, p, bytes, ler, linhas, varrer, inicial: await bytes() };
}

describe('limpeza e varredura dos envios (RN-163, RN-166, RN-167)', () => {
  it('RN-166: o job do cancelamento apaga o PDF limpo e as páginas e devolve a cota; idempotente', async () => {
    const { T, p, bytes, ler, linhas, inicial } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.update(examSubmissions).set({ status: 'cancelado' }).where(eq(examSubmissions.id, e.id)), app.db);
    expect(await limparEnvio({ tenantId: T.tenantId, envioId: e.id }, { db: app.db, dataDir })).toBe(3);
    expect(await ler(e.id)).toMatchObject({ status: 'cancelado', arquivoPath: null });
    expect(await linhas(e.id)).toEqual([]);
    expect(await bytes()).toBe(inicial);
    expect(await limparEnvio({ tenantId: T.tenantId, envioId: e.id }, { db: app.db, dataDir })).toBe(0);
  });

  it('D12: "processando" parado há mais de 30 min sem job vivo → "falhou" (interrompido), sem reprocessar, e o original sai; com job vivo ou recente, espera', async () => {
    const { T, p, ler, linhas, varrer } = await cenario();
    const parado = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando', updatedAt: atras(31 * 60_000) });
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: parado, arquivoPath: original, papel: 'original', ordem: 1 }), app.db);
    const recente = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando', updatedAt: atras(10 * 60_000) });
    expect((await varrer(comJobVivo)).interrompidos).toBe(0);
    expect((await ler(parado)).status).toBe('processando');
    expect((await varrer()).interrompidos).toBe(1);
    expect(await ler(parado)).toMatchObject({ status: 'falhou', motivoFalha: 'interrompido' });
    expect(await linhas(parado)).toEqual([]);
    expect(existsSync(resolverCaminho(dataDir, original))).toBe(false);
    expect((await ler(recente)).status).toBe('processando');
  });

  it('US-165 "Expirar" (D15 = b): "recebido" há 90 dias → "expirado", PDF e páginas apagados, push neutro; com 89 dias, fica', async () => {
    const { T, p, ler, linhas, varrer, bytes, inicial } = await cenario();
    const velho = await envioRecebido(app.db, T.ctx, p.id, dataDir, { criadoEm: atras(91 * DIA) });
    const novo = await envioRecebido(app.db, T.ctx, p.id, dataDir, { criadoEm: atras(89 * DIA) });
    const r = await varrer();
    expect(r.expirados).toBe(1);
    expect(await ler(velho.id)).toMatchObject({ status: 'expirado', arquivoPath: null });
    expect(await linhas(velho.id)).toEqual([]);
    for (const c of [velho.pdf, ...velho.paginas]) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect((await ler(novo.id)).status).toBe('recebido');
    const pushes = await withTenant(T.ctx, (tx) => tx.select({ tipo: notifications.tipo }).from(notifications).where(eq(notifications.patientId, p.id)), app.db);
    expect(pushes).toEqual([{ tipo: 'exame_expirado' }]);
    expect(await bytes()).toBeGreaterThan(inicial); // só o novo continua ocupando espaço
  });

  it('sobras: páginas de um envio já aceito e o original de um envio já "recebido" saem; a segunda varredura não acha nada', async () => {
    const { T, p, linhas, varrer } = await cenario();
    const aceito = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(T.ctx, (tx) => tx.update(examSubmissions).set({ status: 'aceito', arquivoPath: null, revisadoPor: T.nutriId, revisadoEm: new Date() }).where(eq(examSubmissions.id, aceito.id)), app.db);
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 1 });
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: rec.id, arquivoPath: original, papel: 'original', ordem: 1 }), app.db);
    const r = await varrer();
    expect(r.arquivos).toBe(3); // 2 páginas do aceito + o original do recebido
    expect(await linhas(aceito.id)).toEqual([]);
    expect((await linhas(rec.id)).map((l) => l.papel)).toEqual(['pagina']);
    expect(await varrer()).toEqual({ interrompidos: 0, expirados: 0, arquivos: 0 });
  });

  it('revisão do plano: PDF limpo (`exame`) que nenhum exame nem envio aponta, com mais de 1 h, sai; o do exame e o do envio ficam', async () => {
    const { T, p, ler } = await cenario();
    const solto = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir);
    const doExame = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir);
    await withTenant(T.ctx, (tx) => tx.insert(exams).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-28', titulo: 'Hemograma', arquivoPath: doExame }), app.db);
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 0 });
    const r = await varrerEnvios({ db: app.db, dataDir, boss: semJobs }, new Date(Date.now() + 2 * 3600_000), { tenantId: T.tenantId });
    expect(r.arquivos).toBe(1);
    expect(existsSync(resolverCaminho(dataDir, solto))).toBe(false);
    for (const c of [doExame, rec.pdf]) expect(existsSync(resolverCaminho(dataDir, c))).toBe(true);
    expect((await ler(rec.id)).arquivoPath).toBe(rec.pdf);
  });

  it('um envio com erro não para o resto do tenant: a pg-boss fora no "processando" parado e o vencido expira assim mesmo', async () => {
    const { T, p, ler, varrer } = await cenario();
    const parado = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando', updatedAt: atras(31 * 60_000) });
    const velho = await envioRecebido(app.db, T.ctx, p.id, dataDir, { criadoEm: atras(91 * DIA) });
    const bossFora = { findJobs: async () => Promise.reject(new Error('a')) } as unknown as Pick<PgBoss, 'findJobs'>;
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      expect(await varrer(bossFora)).toEqual({ interrompidos: 0, expirados: 1, arquivos: 3 });
      // RNF-11: só o nome do erro, o tenant, o id do envio e a etapa — nunca a mensagem
      expect(erro).toHaveBeenCalledWith({ err: 'Error', sqlstate: undefined, tenantId: T.tenantId, id: parado, etapa: 'interrompido' }, 'falha ao varrer os envios de exame');
    } finally {
      erro.mockRestore();
    }
    expect((await ler(parado)).status).toBe('processando'); // o próximo ciclo tenta de novo
    expect((await ler(velho.id)).status).toBe('expirado');
  });

  it('revisão do plano: expiração e aceite ao mesmo tempo não fecham ciclo — a expiração trava o paciente antes do envio', async () => {
    const { T, p, ler } = await cenario();
    const velho = await envioRecebido(app.db, T.ctx, p.id, dataDir, { criadoEm: atras(91 * DIA) });
    let travouPaciente!: () => void;
    const travou = new Promise<void>((ok) => (travouPaciente = ok));
    // a nutricionista (molde de travarEnvioRecebido): paciente FOR UPDATE; espera a varredura parar numa trava; então o envio
    const nutri = withTenant(
      T.ctx,
      async (tx) => {
        await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, p.id)).for('update');
        travouPaciente();
        await esperarNaTrava(app.db, 'patients'); // com a correção, a varredura espera o paciente SEM segurar o envio
        return tx.select({ status: examSubmissions.status }).from(examSubmissions).where(eq(examSubmissions.id, velho.id)).for('update');
      },
      app.db,
    );
    await travou;
    const varredura = varrerEnvios({ db: app.db, dataDir, boss: semJobs }, AGORA, { tenantId: T.tenantId });
    expect(await nutri).toEqual([{ status: 'recebido' }]); // sem 40P01
    expect((await varredura).expirados).toBe(1);
    expect((await ler(velho.id)).status).toBe('expirado');
  }, 30_000);
});
