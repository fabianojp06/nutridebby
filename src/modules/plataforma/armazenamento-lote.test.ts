import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { JPEG_MINIMO } from '../../../test/exames-enviados';
import { PDF_MINIMO } from '../../../test/ia';
import { storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { COTA_BYTES, CotaEsgotadaError, resolverCaminho, salvarArquivos, TipoNaoPermitidoError, type ArquivoSalvo } from './armazenamento';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-lote-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const bytes = async (tenantId: string) => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, tenantId)))[0].b;
const noDisco = (tenantId: string) => {
  try {
    return readdirSync(path.join(dataDir, tenantId, 'exame_original'));
  } catch {
    return [];
  }
};
async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  return { T, p, ctx: ctxPaciente(T.tenantId, p.id) };
}
const jpegCom = (total: number) => Buffer.concat([JPEG_MINIMO, Buffer.alloc(total - JPEG_MINIMO.length, 1)]);

describe('salvarArquivos (DEP-09 reduzida: o lote do envio do paciente, tudo ou nada)', () => {
  it('grava o lote com UMA reserva (a soma), com dono, e um registrar com todos os arquivos na ordem', async () => {
    const { T, p, ctx } = await cenario();
    const antes = await bytes(T.tenantId);
    const conteudos = [JPEG_MINIMO, PDF_MINIMO, jpegCom(900)];
    let vistos: ArquivoSalvo[] = [];
    const r = await salvarArquivos(ctx, { tipo: 'exame_original', conteudos, permitidos: ['jpg', 'pdf'], patientId: p.id, registrar: async (_tx, a) => void (vistos = a) }, { db: app.db, dataDir });
    expect(r.map((a) => a.mime)).toEqual(['image/jpeg', 'application/pdf', 'image/jpeg']);
    expect(vistos.map((a) => a.caminho)).toEqual(r.map((a) => a.caminho));
    expect(await bytes(T.tenantId)).toBe(antes + conteudos.reduce((s, b) => s + b.length, 0));
    for (const a of r) expect(existsSync(resolverCaminho(dataDir, a.caminho))).toBe(true);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(inArray(storedFiles.caminho, r.map((a) => a.caminho))), app.db);
    expect(linhas.every((l) => l.patientId === p.id && l.tipo === 'exame_original')).toBe(true);
  });

  it('US-160 "Espaço do consultório esgotado": cabe um, não cabe a soma → nada gravado (nem linha, nem disco, nem reserva)', async () => {
    const { T, p, ctx } = await cenario();
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES - 1000 }).where(eq(tenants.id, T.tenantId));
    await expect(
      salvarArquivos(ctx, { tipo: 'exame_original', conteudos: [jpegCom(600), jpegCom(600)], permitidos: ['jpg'], patientId: p.id }, { db: app.db, dataDir }),
    ).rejects.toBeInstanceOf(CotaEsgotadaError);
    expect(await bytes(T.tenantId)).toBe(COTA_BYTES - 1000);
    expect(noDisco(T.tenantId)).toEqual([]);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.patientId, p.id)), app.db)).toEqual([]);
  });

  it('um conteúdo fora dos permitidos, vazio ou lote vazio: TipoNaoPermitidoError antes de gravar qualquer um', async () => {
    const { T, p, ctx } = await cenario();
    for (const conteudos of [[JPEG_MINIMO, Buffer.from('PK\u0003\u0004zip')], [JPEG_MINIMO, Buffer.alloc(0)], []]) {
      await expect(salvarArquivos(ctx, { tipo: 'exame_original', conteudos, permitidos: ['jpg', 'pdf'], patientId: p.id }, { db: app.db, dataDir })).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    }
    expect(noDisco(T.tenantId)).toEqual([]);
  });

  it('o registrar que lança desfaz tudo: sem linha, sem arquivo no disco, sem reserva', async () => {
    const { T, p, ctx } = await cenario();
    const antes = await bytes(T.tenantId);
    await expect(
      salvarArquivos(ctx, { tipo: 'exame_original', conteudos: [JPEG_MINIMO, JPEG_MINIMO], permitidos: ['jpg'], patientId: p.id, registrar: async () => { throw new Error('falha no registro'); } }, { db: app.db, dataDir }),
    ).rejects.toThrow('falha no registro');
    expect(await bytes(T.tenantId)).toBe(antes);
    expect(noDisco(T.tenantId).filter((f) => !f.endsWith('.tmp'))).toEqual([]);
    expect(noDisco(T.tenantId).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('dono obrigatório nos tipos do paciente; a sessão de paciente não grava o lote de outro paciente', async () => {
    const { T, p, ctx } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(salvarArquivos(ctx, { tipo: 'exame_original', conteudos: [JPEG_MINIMO], permitidos: ['jpg'] }, { db: app.db, dataDir })).rejects.toThrow(/patientId obrigatório/);
    await expect(salvarArquivos(ctx, { tipo: 'exame_original', conteudos: [JPEG_MINIMO], permitidos: ['jpg'], patientId: outro.id }, { db: app.db, dataDir })).rejects.toThrow();
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.patientId, p.id)), app.db)).toEqual([]);
  });
});
