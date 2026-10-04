import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { carregarConteudoDoPainel, criarConteudo } from '@/modules/conteudo/conteudos';
import { nutriComDpa } from '../../../../../../../test/nutri';
import { POST } from './route';

vi.mock('server-only', () => ({}));
// o corpo que não chega no prazo (120 s) é simulado: a leitura real tem teste próprio (src/lib/corpo.test.ts)
vi.mock('@/lib/corpo', async (original) => {
  const m = await original<typeof import('@/lib/corpo')>();
  return { ...m, lerCorpoLimitado: vi.fn(m.lerCorpoLimitado) };
});
const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const enviar = (id: string, corpo: Uint8Array, cookie: string) =>
  POST(new Request(`http://localhost:3000/api/painel/conteudos/${id}/pdf`, { method: 'POST', body: new Uint8Array(corpo), headers: { cookie, origin: 'http://localhost:3000' } }), {
    params: Promise.resolve({ id }),
  });
const base = { titulo: 'Como ler rótulos', resumo: '', etiquetas: '', visibilidade: 'todos', pacientes: [], tags: [] };

describe('POST /api/painel/conteudos/[id]/pdf (US-052)', () => {
  it('PDF da orientação → 200; outro tipo de arquivo → 415; corpo que não chega no prazo → 408 com "Não foi possível enviar. Tente de novo."', async () => {
    const A = await nutriComDpa(db, auth);
    const o = await criarConteudo(A.ctx, 'orientacao', base, { db });
    expect((await enviar(o, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]), A.cookie)).status).toBe(200);
    expect((await carregarConteudoDoPainel(A.ctx, o, db))!.pdfUrl).not.toBeNull();
    const t = await enviar(o, Buffer.from('não é pdf'), A.cookie);
    expect(t.status).toBe(415);
    expect(await t.json()).toEqual({ erro: 'Envie um PDF de até 10 MB.' });
    vi.mocked(lerCorpoLimitado).mockRejectedValueOnce(new CorpoLentoError());
    const lento = await enviar(o, new Uint8Array(10), A.cookie);
    expect(lento.status).toBe(408);
    expect(await lento.json()).toEqual({ erro: 'Não foi possível enviar. Tente de novo.' });
  });
});
