import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { mealPlans, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { idTaco } from '@/modules/alimentos/taco';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { criarRascunho } from '@/modules/plano-alimentar/rascunho';
import { novoPaciente } from '../../../../../../test/pacientes';
import { nutriComDpa } from '../../../../../../test/nutri';
import { GET, PUT } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const url = (id: string) => `http://localhost:3000/api/painel/planos/${id}`;
const put = (id: string, corpo: unknown, cookie?: string) =>
  PUT(new Request(url(id), { method: 'PUT', body: JSON.stringify(corpo), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }), { params: Promise.resolve({ id }) });
const get = (id: string, cookie?: string) => GET(new Request(url(id), { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });
const corpo = (revisao: number, quantidadeG = '100') => ({
  revisao, titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '',
  refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG, medida: null, substituiItemId: null }] }],
});

describe('PUT /api/painel/planos/[id] (US-022 "Salvamento automático", D7)', () => {
  it('200 com a revisão nova; 409 com revisão velha; 422 com erro por campo; 404 para outro tenant; 401 sem sessão', async () => {
    const A = await nutriComDpa(db, auth);
    const B = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const { id } = await criarRascunho(A.ctx, p.id, { db });
    const ok = await put(id, corpo(0), A.cookie);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ revisao: 1 });
    const velho = await put(id, corpo(0), A.cookie);
    expect(velho.status).toBe(409);
    expect(await velho.json()).toEqual({ erro: MSG_PLANO.conflito, codigo: 'conflito' });
    const invalido = await put(id, corpo(1, 'abc'), A.cookie);
    expect(invalido.status).toBe(422);
    expect(Object.values((await invalido.json()).erros)).toEqual([MSG_PLANO.quantidade]);
    expect((await put(id, corpo(1), B.cookie)).status).toBe(404);
    expect((await put('abc', corpo(1), A.cookie)).status).toBe(404);
    expect((await put(id, corpo(1))).status).toBe(401);
    expect((await get(id, A.cookie)).status).toBe(200);
    expect((await get(id, B.cookie)).status).toBe(404);
  });

  it('409 diz o motivo: paciente bloqueado e versão já publicada não são "alterado em outra aba"', async () => {
    const A = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const { id } = await criarRascunho(A.ctx, p.id, { db });
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), db);
    const bloqueado = await put(id, corpo(0), A.cookie);
    expect(bloqueado.status).toBe(409);
    expect(await bloqueado.json()).toEqual({ erro: MSG_BLOQUEADO, codigo: 'bloqueado' });

    const q = await novoPaciente(db, A.ctx);
    const r = await criarRascunho(A.ctx, q.id, { db });
    await withTenant(A.ctx, (tx) => tx.update(mealPlans).set({ status: 'publicado', publicadoEm: new Date() }).where(eq(mealPlans.id, r.id)), db);
    const publicado = await put(r.id, corpo(0), A.cookie);
    expect(publicado.status).toBe(409);
    expect(await publicado.json()).toEqual({ erro: MSG_PLANO.naoEditavel, codigo: 'nao_editavel' });
  });

  it('GET não manda o caminho interno do arquivo do PDF ao cliente (só o status)', async () => {
    const A = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const { id } = await criarRascunho(A.ctx, p.id, { db });
    const r = await get(id, A.cookie);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toHaveProperty('pdfStatus');
    expect(corpo).not.toHaveProperty('pdfPath');
  });

  it('corpo que não é JSON é 422; corpo acima de 512 KB é 413', async () => {
    const A = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const { id } = await criarRascunho(A.ctx, p.id, { db });
    const r = await PUT(new Request(url(id), { method: 'PUT', body: '{x', headers: { cookie: A.cookie } }), { params: Promise.resolve({ id }) });
    expect(r.status).toBe(422);
    const grande = await PUT(new Request(url(id), { method: 'PUT', body: 'x'.repeat(600_000), headers: { cookie: A.cookie } }), { params: Promise.resolve({ id }) });
    expect(grande.status).toBe(413);
  });
});
