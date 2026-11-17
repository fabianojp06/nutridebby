import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { editarExame, exameParaEditar } from '@/modules/exames/edicao';
import { listarExames } from '@/modules/pacientes/exames';
import { COTA_BYTES, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { novoPaciente } from '../../../../../../../test/pacientes';
import { criarEEntrar } from '../../../../../../../test/sessao';
import { POST } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

async function nutriComDpa() {
  const [t] = await db.insert(tenants).values({ slug: `ex-${randomUUID().slice(0, 8)}`, nomeExibicao: 'EX' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
function enviar(id: string, campos: Record<string, string | Blob>, cookie?: string, origin = 'http://localhost:3000') {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return POST(new Request(`http://localhost:3000/api/painel/pacientes/${id}/exames`, { method: 'POST', body: f, headers: { ...(cookie ? { cookie } : {}), origin } }), {
    params: Promise.resolve({ id }),
  });
}
const pdf = (n: number) => new Blob([Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n)])], { type: 'application/pdf' });

describe('POST /api/painel/pacientes/[id]/exames', () => {
  it('grava o exame com laudo e valores', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    const r = await enviar(p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: JSON.stringify([{ nome: 'Glicemia', valor: '95', unidade: 'mg/dL' }]), arquivo: pdf(1000) }, A.cookie);
    expect(r.status).toBe(200);
    const [e] = await listarExames(A.ctx, p.id, db);
    expect(e).toMatchObject({ titulo: 'Hemograma', valores: [{ nome: 'Glicemia', valor: 95, unidade: 'mg/dL', referencia: null }] });
    expect(e.arquivoPath).toMatch(/\.pdf$/);
  });

  it('tipo errado 415 e grande demais 413, com a mensagem da spec; campos inválidos 400', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    const exe = await enviar(p.id, { titulo: 'X', data: '2026-09-01', valores: '[]', arquivo: new Blob([Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)])]) }, A.cookie);
    expect(exe.status).toBe(415);
    expect(await exe.json()).toEqual({ erros: { arquivo: 'Envie PDF, JPEG ou PNG de até 20 MB' } });
    const grande = await enviar(p.id, { titulo: 'X', data: '2026-09-01', valores: '[]', arquivo: pdf(21 * 1024 * 1024) }, A.cookie);
    expect(grande.status).toBe(413);
    expect(await grande.json()).toEqual({ erros: { arquivo: 'Envie PDF, JPEG ou PNG de até 20 MB' } });
    const ruim = await enviar(p.id, { titulo: '', data: '2026-09-01', valores: 'nao-e-json' }, A.cookie);
    expect(ruim.status).toBe(400);
    expect(await ruim.json()).toMatchObject({ erros: { titulo: 'Informe o título do exame', valores: expect.any(String) } });
  });

  it('cota esgotada 507 com a mensagem do RN-18; paciente bloqueado 409; nada é gravado', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    const bloqueado = await novoPaciente(db, A.ctx, { status: 'bloqueado' });
    const b = await enviar(bloqueado.id, { titulo: 'X', data: '2026-09-01', valores: '[]', arquivo: pdf(1000) }, A.cookie);
    expect(b.status).toBe(409);
    await db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, A.ctx.tenantId));
    const cheio = await enviar(p.id, { titulo: 'X', data: '2026-09-01', valores: '[]', arquivo: pdf(1000) }, A.cookie);
    expect(cheio.status).toBe(507);
    expect(await cheio.json()).toEqual({ erros: { arquivo: MSG_COTA_ESGOTADA } });
    expect(await listarExames(A.ctx, p.id, db)).toEqual([]);
  });

  it('paciente de outro tenant 404; sem sessão 401; outra origem 403', async () => {
    const A = await nutriComDpa();
    const B = await nutriComDpa();
    const pB = await novoPaciente(db, B.ctx);
    expect((await enviar(pB.id, { titulo: 'X', data: '2026-09-01', valores: '[]' }, A.cookie)).status).toBe(404);
    expect((await enviar(pB.id, { titulo: 'X', data: '2026-09-01', valores: '[]' })).status).toBe(401);
    expect((await enviar(pB.id, { titulo: 'X', data: '2026-09-01', valores: '[]' }, B.cookie, 'https://evil.example')).status).toBe(403);
  });

  it('Plano 22 (T4, RN-376, M3): grava a faixa do laudo (referência gerada da faixa) e o updatedAt do exame recém-criado, devolvido como lidoEm, passa na edição', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    const valores = JSON.stringify([{ nome: 'Glicemia de jejum', valor: '105', unidade: 'mg/dL', referencia: '', refMin: '70', refMax: '99', iaTarefaId: randomUUID() }]);
    const r = await enviar(p.id, { titulo: 'Rotina', data: '2026-09-01', valores }, A.cookie);
    expect(r.status).toBe(200);
    const { id } = (await r.json()) as { id: string };
    const aberto = (await exameParaEditar(A.ctx, p.id, id))!;
    expect(aberto.valores).toEqual([{ nome: 'Glicemia de jejum', valor: 105, unidade: 'mg/dL', referencia: '70 a 99', refMin: 70, refMax: 99 }]);
    await editarExame(A.ctx, { fuso: 'America/Sao_Paulo' }, p.id, id, {
      titulo: 'Rotina',
      data: '2026-09-01',
      linhas: [{ origem: 0, nome: 'Glicemia de jejum', valor: '98', unidade: 'mg/dL', referencia: '70 a 99', refMin: '70', refMax: '99' }],
      justificativa: 'Valor digitado errado',
      lidoEm: aberto.updatedAt,
    });
    expect((await listarExames(A.ctx, p.id, db))[0].valores[0].valor).toBe(98);
  });

  it('Plano 22 (T4): faixa invertida → 400 com o erro no campo da linha', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    const r = await enviar(p.id, { titulo: 'Rotina', data: '2026-09-01', valores: JSON.stringify([{ nome: 'G', valor: '1', refMin: '120', refMax: '99' }]) }, A.cookie);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erros: { 'valores.0.refMin': 'O início da faixa deve ser menor ou igual ao fim.' } });
  });
});

