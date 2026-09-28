import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { storedFiles, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import {
  apagarArquivo,
  COTA_BYTES,
  CotaEsgotadaError,
  nivelDeUso,
  resolverCaminho,
  salvarArquivo,
  TipoNaoPermitidoError,
} from './armazenamento';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-arq-'));
const deps = { db: app.db, dataDir };
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true }); // T8-R2b
});

const PNG = (n = 100) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
async function novoTenant(): Promise<TenantContext> {
  const [t] = await app.db.insert(tenants).values({ slug: `arq-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Arq' }).returning();
  return { tenantId: t.id, role: 'nutri', actorUserId: randomUUID(), ip: '203.0.113.1' };
}
const usado = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0].armazenamentoBytes;
const definirUso = (id: string, bytes: number) => app.db.update(tenants).set({ armazenamentoBytes: bytes }).where(eq(tenants.id, id));

describe('salvarArquivo (RN-18, RNF-06)', () => {
  it('grava em <tenant>/<tipo>/<id>.<ext>, registra e soma na cota', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(100), permitidos: ['png'] }, deps);
    expect(a.caminho).toBe(`${ctx.tenantId}/logo/${a.id}.png`);
    expect(readFileSync(path.join(dataDir, a.caminho)).equals(PNG(100))).toBe(true);
    expect(await usado(ctx.tenantId)).toBe(108);
    const [row] = await withTenant(ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, a.id)), app.db);
    expect(row).toMatchObject({ bytes: 108, mime: 'image/png', tipo: 'logo', criadoPor: ctx.actorUserId });
  });

  it('decide pelo conteúdo: HTML "como .png", PDF onde só cabe imagem e SVG são recusados (Review Focus 3)', async () => {
    const ctx = await novoTenant();
    await expect(
      salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('<html><script>x</script></html>'), permitidos: ['png'] }, deps),
    ).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    await expect(
      salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('%PDF-1.4'), permitidos: ['png', 'jpg'] }, deps),
    ).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    await expect(
      salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('<svg/>'), permitidos: ['png', 'svg'] }, deps),
    ).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    expect(await usado(ctx.tenantId)).toBe(0);
  });

  it('a 100% recusa com a mensagem da spec e não grava nada', async () => {
    const ctx = await novoTenant();
    await definirUso(ctx.tenantId, COTA_BYTES - 10);
    const e = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(20), permitidos: ['png'] }, deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CotaEsgotadaError);
    expect((e as Error).message).toBe('Espaço de armazenamento esgotado. Fale com o suporte.');
    expect(await usado(ctx.tenantId)).toBe(COTA_BYTES - 10);
  });

  it('dois uploads simultâneos perto do limite: só um passa (Review Focus 4)', async () => {
    const ctx = await novoTenant();
    await definirUso(ctx.tenantId, COTA_BYTES - 1500);
    const r = await Promise.allSettled([
      salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(992), permitidos: ['png'] }, deps),
      salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(992), permitidos: ['png'] }, deps),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(CotaEsgotadaError);
    expect(await usado(ctx.tenantId)).toBe(COTA_BYTES - 500);
  });

  it('falha ao gravar o arquivo devolve a reserva e não deixa registro', async () => {
    const ctx = await novoTenant();
    const naoEhPasta = path.join(dataDir, `arquivo-${randomUUID()}`);
    writeFileSync(naoEhPasta, 'x');
    await expect(
      salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(), permitidos: ['png'] }, { db: app.db, dataDir: naoEhPasta }),
    ).rejects.toThrow();
    expect(await usado(ctx.tenantId)).toBe(0);
    expect(await withTenant(ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
  });
});

describe('apagarArquivo', () => {
  it('apaga o arquivo e devolve o espaço; outro tenant não consegue apagar', async () => {
    const ctx = await novoTenant();
    const outro = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(50), permitidos: ['png'] }, deps);
    expect(await apagarArquivo(outro, { id: a.id }, deps)).toBe(false);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(true);
    expect(await apagarArquivo(ctx, { caminho: a.caminho }, deps)).toBe(true);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(false);
    expect(await usado(ctx.tenantId)).toBe(0);
  });
});

describe('nivelDeUso e resolverCaminho', () => {
  it('aviso a partir de 80%, esgotado em 100%', () => {
    expect(nivelDeUso(0)).toEqual({ percentual: 0, nivel: 'ok' });
    expect(nivelDeUso(COTA_BYTES * 0.8)).toEqual({ percentual: 80, nivel: 'aviso' });
    expect(nivelDeUso(COTA_BYTES)).toEqual({ percentual: 100, nivel: 'esgotado' });
  });
  it('recusa caminhos que escapam do DATA_DIR', () => {
    for (const c of ['../x', '/etc/passwd', 'a/../../x', '']) expect(() => resolverCaminho(dataDir, c)).toThrow();
    expect(resolverCaminho(dataDir, 'a/b.png')).toBe(path.join(dataDir, 'a/b.png'));
  });
});
