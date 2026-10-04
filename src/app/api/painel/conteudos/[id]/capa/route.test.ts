import sharp from 'sharp';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { carregarConteudoDoPainel, criarConteudo } from '@/modules/conteudo/conteudos';
import { nutriComDpa } from '../../../../../../../test/nutri';
import { POST } from './route';

vi.mock('server-only', () => ({}));
// o corpo que não chega no prazo (60 s) é simulado: a leitura real tem teste próprio (src/lib/corpo.test.ts)
vi.mock('@/lib/corpo', async (original) => {
  const m = await original<typeof import('@/lib/corpo')>();
  return { ...m, lerCorpoLimitado: vi.fn(m.lerCorpoLimitado) };
});
const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const enviar = (id: string, corpo: Uint8Array, cookie: string, origin = 'http://localhost:3000') =>
  POST(new Request(`http://localhost:3000/api/painel/conteudos/${id}/capa`, { method: 'POST', body: new Uint8Array(corpo), headers: { cookie, origin } }), { params: Promise.resolve({ id }) });
const base = { titulo: 'Panqueca', resumo: '', etiquetas: '', visibilidade: 'todos', pacientes: [], tags: [] };

describe('POST /api/painel/conteudos/[id]/capa', () => {
  it('JPEG da receita → 200 e a capa aparece; outra origem 403; tipo errado 415; vídeo 404', async () => {
    const A = await nutriComDpa(db, auth);
    const r = await criarConteudo(A.ctx, 'receita', base, { db });
    const jpg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#0a0' } }).jpeg().toBuffer();
    expect((await enviar(r, jpg, A.cookie, 'https://evil.example')).status).toBe(403);
    expect((await enviar(r, jpg, A.cookie)).status).toBe(200);
    expect((await carregarConteudoDoPainel(A.ctx, r, db))!.capaUrl).not.toBeNull();
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10)]);
    const t = await enviar(r, pdf, A.cookie);
    expect(t.status).toBe(415);
    expect(await t.json()).toEqual({ erro: 'Envie uma imagem JPEG ou PNG de até 5 MB.' });
    const v = await criarConteudo(A.ctx, 'video', { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db, fetchImpl: (async () => { throw new Error('rede'); }) as typeof fetch });
    expect((await enviar(v, jpg, A.cookie)).status).toBe(404);
  });

  it('corpo que não chega no prazo → 408 "Não foi possível enviar. Tente de novo." (não é "outro envio em andamento")', async () => {
    const A = await nutriComDpa(db, auth);
    const r = await criarConteudo(A.ctx, 'receita', base, { db });
    vi.mocked(lerCorpoLimitado).mockRejectedValueOnce(new CorpoLentoError());
    const resp = await enviar(r, new Uint8Array(10), A.cookie);
    expect(resp.status).toBe(408);
    expect(await resp.json()).toEqual({ erro: 'Não foi possível enviar. Tente de novo.' });
  });
});
