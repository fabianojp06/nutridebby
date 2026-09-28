import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getEnv } from '@/env';
import { detectarTipo } from '@/lib/file-type';
import { TipoNaoPermitidoError } from './armazenamento';
import { processarLogo, trocarLogo } from './logo';

afterAll(() => closeDb());
const imagem = (w: number, h: number, formato: 'png' | 'jpeg') =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2E7D32' } })[formato]().toBuffer();
const SVG_COM_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><rect width="64" height="64" fill="#2E7D32"/></svg>',
);

describe('processarLogo (US-005: PNG/JPEG/SVG, máx. 512 px)', () => {
  it('reduz para caber em 512 px e devolve PNG', async () => {
    const out = await processarLogo(await imagem(1024, 600, 'jpeg'));
    expect(detectarTipo(out)?.ext).toBe('png');
    expect(await sharp(out).metadata()).toMatchObject({ width: 512, height: 300 });
  });
  it('não aumenta imagem pequena', async () => {
    expect(await sharp(await processarLogo(await imagem(100, 80, 'png'))).metadata()).toMatchObject({ width: 100, height: 80 });
  });
  it('SVG com <script> vira PNG sem script (Review Focus 3)', async () => {
    const out = await processarLogo(SVG_COM_SCRIPT);
    expect(detectarTipo(out)?.ext).toBe('png');
    expect(out.includes('script')).toBe(false);
  });
  it('PDF, HTML e imagem corrompida são recusados', async () => {
    for (const b of [Buffer.from('%PDF-1.4'), Buffer.from('<html></html>'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)])]) {
      await expect(processarLogo(b)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    }
  });
});

describe('trocarLogo', () => {
  it('grava o novo, aponta tenants.logo_path e apaga o anterior (a cota só conta o atual)', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `logo-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Logo' }).returning();
    const ctx = { tenantId: t.id, role: 'nutri' as const };
    const primeiro = await trocarLogo(ctx, await imagem(300, 300, 'png'));
    const segundo = await trocarLogo(ctx, await imagem(200, 200, 'png'));
    const [r] = await getDb().select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.logoPath).toBe(segundo);
    expect(() => readFileSync(path.join(getEnv().DATA_DIR, primeiro))).toThrow();
    expect(r.armazenamentoBytes).toBe(readFileSync(path.join(getEnv().DATA_DIR, segundo)).length);
  });
});
