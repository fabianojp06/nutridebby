import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { session, tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { criarRascunho } from '@/modules/plano-alimentar/rascunho';
import { documentoNoBanco } from '../../../../test/documentos';
import { tarefaNoBanco } from '../../../../test/ia';
import { nutriComDpa } from '../../../../test/nutri';
import { novoPaciente } from '../../../../test/pacientes';
import { GET as estadoDoDocumento } from './documentos/[id]/pdf/route';
import { GET as estadoDaTarefa } from './ia/tarefas/[id]/route';
import { GET as estadoDoPdfDoPlano } from './planos/[id]/pdf/route';
import { GET as estadoDoWhatsapp } from './whatsapp/estado/route';

vi.mock('server-only', () => ({}));

const MIN = 60_000;
const H = 60 * MIN;
const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

/** Mesmo padrão de api-auth.test.ts: a sessão como se o último uso tivesse sido há `updatedAgoMs`. */
async function envelhecer(userId: string, updatedAgoMs: number, expiresInMs: number) {
  const now = Date.now();
  await db.update(session).set({ updatedAt: new Date(now - updatedAgoMs), expiresAt: new Date(now + expiresInMs) }).where(eq(session.userId, userId));
}
const lerSessao = async (userId: string) =>
  (await db.select({ updatedAt: session.updatedAt, expiresAt: session.expiresAt }).from(session).where(eq(session.userId, userId)))[0];

const pedir = (url: string, cookie: string) => new Request(`http://localhost:3000${url}`, { headers: { cookie } });

/**
 * Revisão da Tarefa 14 (P12-14, RNF-06): as rotas que só devolvem estado para o polling da tela conferem a sessão, mas
 * não contam como uso — sem o cabeçalho de consulta automática, para valer também com o JavaScript de uma aba aberta
 * antes do deploy. Com a nutricionista longe da mesa e o worker parado, o "Preparando o PDF…" não segura mais a sessão.
 */
describe('rotas de estado do polling não renovam a sessão da equipe (P12-14)', () => {
  it('20 min sem uso: respondem 200 sem mexer na sessão; 31 min: 401 e nada renovado; o download do PDF continua sendo uso', async () => {
    const A = await nutriComDpa(db, auth);
    const userId = A.ctx.actorUserId;
    await db.update(tenants).set({ documentosLiberados: true }).where(eq(tenants.id, A.tenantId));
    const p = await novoPaciente(db, A.ctx);
    const doc = await documentoNoBanco(db, A.ctx, p.id, { status: 'preparando' });
    const tarefa = await tarefaNoBanco(db, A.ctx, p.id, null);
    const { id: plano } = await criarRascunho(A.ctx, p.id, { db });

    const consultas: Array<[string, () => Promise<Response>]> = [
      ['documento ?estado=1', () => estadoDoDocumento(pedir(`/api/painel/documentos/${doc.id}/pdf?estado=1`, A.cookie), { params: Promise.resolve({ id: doc.id }) })],
      ['tarefa da IA', () => estadoDaTarefa(pedir(`/api/painel/ia/tarefas/${tarefa}`, A.cookie), { params: Promise.resolve({ id: tarefa }) })],
      ['PDF do plano', () => estadoDoPdfDoPlano(pedir(`/api/painel/planos/${plano}/pdf?paciente=${p.id}`, A.cookie), { params: Promise.resolve({ id: plano }) })],
      ['WhatsApp', () => estadoDoWhatsapp(pedir('/api/painel/whatsapp/estado', A.cookie))],
    ];

    await envelhecer(userId, 20 * MIN, 10 * MIN);
    const antes = await lerSessao(userId);
    for (const [nome, consultar] of consultas) {
      expect([nome, (await consultar()).status]).toEqual([nome, 200]);
      expect([nome, await lerSessao(userId)]).toEqual([nome, antes]);
    }

    await envelhecer(userId, 31 * MIN, 11 * H); // sessão aberta antes da regra (expiresAt ainda de 12 h)
    const vencida = await lerSessao(userId);
    for (const [nome, consultar] of consultas) {
      expect([nome, (await consultar()).status]).toEqual([nome, 401]);
      expect([nome, await lerSessao(userId)]).toEqual([nome, vencida]);
    }

    // contraste: pedir o PDF (clique da pessoa, sem `?estado=1`) é uso e renova a sessão
    await envelhecer(userId, 20 * MIN, 10 * MIN);
    const r = await estadoDoDocumento(pedir(`/api/painel/documentos/${doc.id}/pdf?base=1`, A.cookie), { params: Promise.resolve({ id: doc.id }) });
    expect(r.status).not.toBe(401);
    expect(Math.abs(new Date((await lerSessao(userId)).updatedAt).getTime() - Date.now())).toBeLessThan(MIN);
  });
});
