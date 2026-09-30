import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { FILE_URL_TTL_S, signFileUrl } from '@/lib/signed-url';
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
    // margem: tempo real passa entre assinar e servir, então nem sempre é exatamente 300
    expect(res.headers.get('cache-control')).toMatch(/^private, max-age=(29[5-9]|300)$/);
  });
  it('expirada → 410; assinatura errada ou caminho fora do formato → 403; arquivo inexistente → 404', async () => {
    const caminho = `${randomUUID()}/logo/${randomUUID()}.png`;
    expect((await get(signFileUrl(caminho, { now: new Date(Date.now() - 10 * 60_000) }))).status).toBe(410);
    expect((await get(`/api/arquivos?c=${encodeURIComponent(caminho)}&e=9999999999&s=x`)).status).toBe(403);
    expect((await get('/api/arquivos?c=..%2F..%2Fetc%2Fpasswd&e=9999999999&s=x')).status).toBe(403);
    expect((await get(signFileUrl(caminho))).status).toBe(404);
  });
  it('max-age acompanha o que falta para o exp, não um TTL fixo (T8-R2a)', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `rota2-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Rota 2' }).returning();
    const a = await salvarArquivo({ tenantId: t.id, role: 'nutri' }, { tipo: 'logo', conteudo: PNG, permitidos: ['png'] });
    // assinada como se emitida há quase os 5 min inteiros: restam ~5 s até expirar
    const emitidaEm = new Date(Date.now() - (FILE_URL_TTL_S - 5) * 1000);
    const res = await get(signFileUrl(a.caminho, { now: emitidaEm }));
    expect(res.status).toBe(200);
    const maxAge = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(0);
    expect(maxAge).toBeLessThanOrEqual(6); // bem longe dos 300 fixos de antes
  });
  it('PDF é servido como anexo (o visualizador do navegador não abre documento em sandbox)', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `rota3-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Rota 3' }).returning();
    const a = await salvarArquivo({ tenantId: t.id, role: 'nutri' }, { tipo: 'exame', conteudo: Buffer.from('%PDF-1.7\nconteudo'), permitidos: ['pdf'] });
    const res = await get(signFileUrl(a.caminho));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="documento.pdf"');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  it('ZIP da exportação é servido como anexo (US-018)', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `rota4-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Rota 4' }).returning();
    const a = await salvarArquivo({ tenantId: t.id, role: 'worker' }, { tipo: 'exportacao', conteudo: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), permitidos: ['zip'] });
    expect(a.caminho).toMatch(new RegExp(`^${t.id}/exportacao/[0-9a-f-]{36}\\.zip$`));
    const res = await get(signFileUrl(a.caminho));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="exportacao.zip"');
  });
});
