import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { signFileUrl } from '@/lib/signed-url';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { GET } from './route';

afterAll(() => closeDb());
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('conteudo')]);
const get = (url: string) => GET(new Request(`http://localhost:3000${url}`));

describe('GET /api/arquivos', () => {
  it('serve o arquivo com URL assinada válida, com cabeçalhos que impedem execução', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `rota-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Rota' }).returning();
    const a = await salvarArquivo({ tenantId: t.id, role: 'nutri' }, { tipo: 'logo', conteudo: PNG, permitidos: ['png'] });
    const res = await get(signFileUrl(a.caminho));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });
  it('expirada → 410; assinatura errada ou caminho fora do formato → 403; arquivo inexistente → 404', async () => {
    const caminho = `${randomUUID()}/logo/${randomUUID()}.png`;
    expect((await get(signFileUrl(caminho, { now: new Date(Date.now() - 10 * 60_000) }))).status).toBe(410);
    expect((await get(`/api/arquivos?c=${encodeURIComponent(caminho)}&e=9999999999&s=x`)).status).toBe(403);
    expect((await get('/api/arquivos?c=..%2F..%2Fetc%2Fpasswd&e=9999999999&s=x')).status).toBe(403);
    expect((await get(signFileUrl(caminho))).status).toBe(404);
  });
});
