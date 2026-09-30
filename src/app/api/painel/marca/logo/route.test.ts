import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { LogoOcupadoError, SvgPesadoError, trocarLogo } from '@/modules/plataforma/logo';
import { criarEEntrar } from '../../../../../../test/sessao';
import { POST } from './route';

// T10-R1c: `trocarLogo` real na maioria dos testes (wrapper em torno da implementação de
// verdade); só o teste do 429 troca a implementação por uma chamada só, para não depender de
// uma corrida real com o semáforo de `processarLogo` (isso já é testado em logo.test.ts).
vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)
vi.mock('@/modules/plataforma/logo', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/logo')>();
  return { ...real, trocarLogo: vi.fn(real.trocarLogo) };
});

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

  // T10-R1a
  it('SVG com filtro (CPU) → 415 com a mensagem exata', async () => {
    const { cookie } = await nutriComDpa();
    const svgComFiltro = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500"><filter id="f"><feGaussianBlur stdDeviation="500"/></filter><rect width="1500" height="1500" filter="url(#f)"/></svg>',
    );
    const res = await enviar(svgComFiltro, { cookie });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ erro: 'SVG com filtros não é aceito. Envie o logo em PNG.' });
  });

  // T10-R1c: mapeamento do "já tem outro logo em processamento no mesmo processo" para 429.
  it('logo ocupado (outro upload em processamento) → 429', async () => {
    const { cookie } = await nutriComDpa();
    vi.mocked(trocarLogo).mockRejectedValueOnce(new LogoOcupadoError());
    const res = await enviar(await png(), { cookie });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ erro: 'Tente novamente em alguns instantes.' });
  });

  // T10-R4a
  it('SVG que estoura o tempo de rasterização → 415 com a mensagem nova', async () => {
    const { cookie } = await nutriComDpa();
    vi.mocked(trocarLogo).mockRejectedValueOnce(new SvgPesadoError());
    const res = await enviar(await png(), { cookie });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ erro: 'Não foi possível processar este SVG. Envie o logo em PNG.' });
  });
});
