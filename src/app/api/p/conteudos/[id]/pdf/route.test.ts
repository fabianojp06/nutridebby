import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { contents } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { trocarPdf } from '@/modules/conteudo/arquivos';
import { novoConteudo } from '../../../../../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../../test/portal';
import { entrar } from '../../../../../../../test/sessao';
import { GET } from './route';

vi.mock('server-only', () => ({}));
const db = getDb();
afterAll(() => closeDb());

describe('GET /api/p/conteudos/[id]/pdf (US-052)', () => {
  it('da audiência: 303 para a URL assinada; de outro paciente, id inválido ou sem sessão: recusa', async () => {
    const T = await novoTenant(db);
    const { paciente, email } = await pacienteComConta(db, T);
    const outra = await novoPaciente(db, T.ctx);
    const meu = await novoConteudo(db, T, { visibilidade: 'pacientes', pacientes: [paciente.id] });
    const dela = await novoConteudo(db, T, { visibilidade: 'pacientes', pacientes: [outra.id] });
    for (const c of [meu, dela]) await trocarPdf(T.ctx, c.id, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]), { db });
    const cookie = await entrar(getAuth(), email);
    const pedir = (id: string, c: string | null = cookie) =>
      GET(new Request(`http://localhost:3000/api/p/conteudos/${id}/pdf`, { headers: c ? { cookie: c } : {} }), { params: Promise.resolve({ id }) });
    const ok = await pedir(meu.id);
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toMatch(/^\/api\/arquivos\?c=/);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect((await pedir(dela.id)).status).toBe(404);
    expect((await pedir('nao-e-id')).status).toBe(404);
    expect((await pedir(meu.id, null)).status).toBe(401);
    const [{ pdfPath }] = await withTenant(T.ctx, (tx) => tx.select({ pdfPath: contents.pdfPath }).from(contents).where(eq(contents.id, dela.id)), db);
    expect(pdfPath).not.toBeNull(); // o arquivo existe: é a audiência que esconde
  });
});
