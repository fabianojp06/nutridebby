import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, envioRecebido } from '../../../test/exames-enviados';
import { examSubmissionFiles, examSubmissions, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { apagarArquivosDoEnvio } from './exames-enviados-arquivos';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-arq-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const deps = { db: app.db, dataDir };
const bytes = async (tenantId: string) => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, tenantId)))[0].b;
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });
async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  return { T, p, antes: await bytes(T.tenantId) };
}
const linhas = (ctx: TenantContext, id: string) =>
  withTenant(ctx, (tx) => tx.select({ papel: examSubmissionFiles.papel }).from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)), app.db);
const envio = async (ctx: TenantContext, id: string) => (await withTenant(ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db))[0];

describe('apagarArquivosDoEnvio (regra 9: um apagarArquivo por arquivo, ponteiro na mesma transação)', () => {
  it('envio "recebido": nada sai (a nutricionista ainda vai conferir as páginas e o PDF limpo)', async () => {
    const { T, p } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    expect(await apagarArquivosDoEnvio(worker(T.tenantId), e.id, deps)).toBe(0);
    expect(await linhas(T.ctx, e.id)).toHaveLength(2);
    expect(existsSync(resolverCaminho(dataDir, e.pdf))).toBe(true);
  });

  it('cancelado pelo paciente: o PDF limpo (ponteiro solto) e as páginas saem do disco e da cota; idempotente', async () => {
    const { T, p, antes } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.update(examSubmissions).set({ status: 'cancelado' }).where(eq(examSubmissions.id, e.id)), app.db);
    expect(await apagarArquivosDoEnvio(worker(T.tenantId), e.id, deps)).toBe(3);
    expect(await linhas(T.ctx, e.id)).toEqual([]);
    expect(await envio(T.ctx, e.id)).toMatchObject({ status: 'cancelado', arquivoPath: null });
    for (const c of [e.pdf, ...e.paginas]) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(await bytes(T.tenantId)).toBe(antes);
    expect(await apagarArquivosDoEnvio(worker(T.tenantId), e.id, deps)).toBe(0);
  });

  it('originais só saem depois do processamento; "refazer" tira as páginas de uma tentativa anterior ainda "processando"', async () => {
    const { T, p } = await cenario();
    const w = worker(T.tenantId);
    const id = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
    await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values([
      { tenantId: T.tenantId, patientId: p.id, submissionId: id, arquivoPath: original, papel: 'original', ordem: 1 },
      { tenantId: T.tenantId, patientId: p.id, submissionId: id, arquivoPath: pagina, papel: 'pagina', ordem: 1 },
    ]), app.db);
    expect(await apagarArquivosDoEnvio(w, id, { ...deps, papel: 'original' })).toBe(0);
    expect(await apagarArquivosDoEnvio(w, id, { ...deps, papel: 'pagina' })).toBe(0); // sem "refazer", página de envio vivo fica
    expect(await apagarArquivosDoEnvio(w, id, { ...deps, papel: 'pagina', refazer: true })).toBe(1);
    expect((await linhas(T.ctx, id)).map((l) => l.papel)).toEqual(['original']);
    const pdf = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir);
    await withTenant(w, (tx) => tx.update(examSubmissions).set({ status: 'recebido', arquivoPath: pdf }).where(eq(examSubmissions.id, id)), app.db);
    expect(await apagarArquivosDoEnvio(w, id, { ...deps, papel: 'original' })).toBe(1);
    expect(await linhas(T.ctx, id)).toEqual([]);
    expect(existsSync(resolverCaminho(dataDir, pdf))).toBe(true); // o PDF limpo do "recebido" fica
  });

  it('aceito: as páginas que sobraram saem; o PDF limpo (agora do exame) não é tocado', async () => {
    const { T, p } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 3 });
    await withTenant(T.ctx, (tx) => tx.update(examSubmissions).set({ status: 'aceito', arquivoPath: null, revisadoPor: T.nutriId, revisadoEm: new Date() }).where(eq(examSubmissions.id, e.id)), app.db);
    expect(await apagarArquivosDoEnvio(T.ctx, e.id, deps)).toBe(3);
    expect(existsSync(resolverCaminho(dataDir, e.pdf))).toBe(true);
  });
});
