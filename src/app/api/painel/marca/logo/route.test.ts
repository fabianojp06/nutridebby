import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from '../../../../../../test/sessao';
import { POST } from './route';

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
const enviar = (corpo: Buffer, headers: Record<string, string> = {}) =>
  // @types/node tipa Buffer com um ArrayBufferLike que o BodyInit do lib.dom não aceita direto.
  POST(new Request('http://localhost:3000/api/painel/marca/logo', { method: 'POST', headers, body: new Uint8Array(corpo) }));
const png = () => sharp({ create: { width: 800, height: 400, channels: 3, background: '#2E7D32' } }).png().toBuffer();

async function nutriComDpa() {
  const [t] = await db.insert(tenants).values({ slug: `rl-${randomUUID().slice(0, 8)}`, nomeExibicao: 'RL' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { t, cookie: n.cookie };
}

describe('POST /api/painel/marca/logo', () => {
  it('sem sessão 401; admin 403 (US-004 "Admin não vê prontuário")', async () => {
    expect((await enviar(await png())).status).toBe(401);
    const a = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    expect((await enviar(await png(), { cookie: a.cookie })).status).toBe(403);
  });

  it('nutricionista envia PNG: vira logo de até 512 px', async () => {
    const { t, cookie } = await nutriComDpa();
    const res = await enviar(await png(), { cookie, origin: 'http://localhost:3000' });
    expect(res.status).toBe(200);
    const [r] = await db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.logoPath).toMatch(new RegExp(`^${t.id}/logo/.+\\.png$`));
  });

  it('mais de 2 MB → 413; tipo errado → 415; outra origem → 403', async () => {
    const { cookie } = await nutriComDpa();
    const grande = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2 * 1024 * 1024)]);
    const r413 = await enviar(grande, { cookie });
    expect(r413.status).toBe(413);
    expect(await r413.json()).toEqual({ erro: 'O logo pode ter no máximo 2 MB.' });
    expect((await enviar(Buffer.from('<html><script>x</script></html>'), { cookie })).status).toBe(415);
    expect((await enviar(await png(), { cookie, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('sem o DPA aceito → 403', async () => {
    const [t] = await db.insert(tenants).values({ slug: `rl-${randomUUID().slice(0, 8)}`, nomeExibicao: 'RL' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    expect((await enviar(await png(), { cookie: n.cookie })).status).toBe(403);
  });
});
