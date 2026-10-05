import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { auditLog, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { codigoAleatorio, documentoNoBanco } from '../../../../../../../test/documentos';
import { nutriComDpa } from '../../../../../../../test/nutri';
import { novoPaciente } from '../../../../../../../test/pacientes';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const get = (id: string, busca: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/documentos/${id}/pdf${busca}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ id }),
  });

async function consultorio(liberado = true) {
  const A = await nutriComDpa(db, auth);
  if (liberado) await db.update(tenants).set({ documentosLiberados: true }).where(eq(tenants.id, A.tenantId));
  return A;
}

/** Documento em cada estado do preparo, direto no banco (o gatilho de imutabilidade não olha INSERT). */
async function documento(ctx: TenantContext, patientId: string, status: 'preparando' | 'aguardando_assinatura') {
  const id = randomUUID();
  const base = status === 'aguardando_assinatura' ? `${ctx.tenantId}/documento_base/${randomUUID()}.pdf` : null;
  await withTenant(ctx, async (tx) => {
    if (base)
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${ctx.tenantId}, 'documento_base', ${base}, 100, 'application/pdf', ${patientId})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em, pdf_status, pdf_pedido_em, base_pdf_path)
      values (${id}, ${ctx.tenantId}, ${patientId}, ${status}, ${codigoAleatorio()}, '{"versao":1,"tipo":"receita","itens":[],"orientacoes":""}'::jsonb, now(),
              ${base ? 'pronto' : 'pendente'}, now(), ${base})`);
  }, db);
  return { id, base };
}

const leituras = (A: Awaited<ReturnType<typeof consultorio>>, id: string) =>
  withTenant(A.ctx, async (tx) =>
    (await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.tenantId, A.tenantId), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'documentos'), eq(auditLog.entidadeId, id)))).length, db);

describe('GET /api/painel/documentos/[id]/pdf (US-143/144)', () => {
  it('sem sessão 401; consultório sem documentos liberados 404', async () => {
    const A = await consultorio(false);
    const p = await novoPaciente(db, A.ctx);
    const d = await documento(A.ctx, p.id, 'preparando');
    expect((await get(d.id, '?estado=1')).status).toBe(401);
    const r = await get(d.id, '?estado=1', A.cookie);
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('?estado=1 devolve a situação sem auditoria (o "Preparando o PDF…" consulta a cada 3 s)', async () => {
    const A = await consultorio();
    const p = await novoPaciente(db, A.ctx);
    const d = await documento(A.ctx, p.id, 'preparando');
    const r = await get(d.id, '?estado=1', A.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ status: 'preparando', pdfStatus: 'pendente', digitalizacaoStatus: null });
    expect(await leituras(A, d.id)).toBe(0);
    expect((await get('abc', '?estado=1', A.cookie)).status).toBe(404);
  });

  it('?base=1 em "Aguardando assinatura" → 303 para a URL assinada e uma leitura auditada; o base fora desse estado → 404', async () => {
    const A = await consultorio();
    const p = await novoPaciente(db, A.ctx);
    const d = await documento(A.ctx, p.id, 'aguardando_assinatura');
    const r = await get(d.id, '?base=1', A.cookie);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toMatch(/^\/api\/arquivos\?/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await leituras(A, d.id)).toBe(1);
    // ainda em preparo: não há PDF base para baixar, nem assinado — e nada é auditado
    const preparo = await documento(A.ctx, p.id, 'preparando');
    expect((await get(preparo.id, '?base=1', A.cookie)).status).toBe(404);
    expect((await get(preparo.id, '', A.cookie)).status).toBe(404);
    expect(await leituras(A, preparo.id)).toBe(0);
  });

  it('sem parâmetro → 303 para o PDF assinado, com auditoria; ?base=1 num assinado → 404', async () => {
    const A = await consultorio();
    const p = await novoPaciente(db, A.ctx);
    const d = await documentoNoBanco(db, A.ctx, p.id, { status: 'assinado' });
    const r = await get(d.id, '', A.cookie);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toMatch(/^\/api\/arquivos\?/);
    expect(await leituras(A, d.id)).toBe(1);
    expect((await get(d.id, '?base=1', A.cookie)).status).toBe(404);
    expect(await leituras(A, d.id)).toBe(1);
  });

  it('documento de outro consultório → 404 em todas as formas, sem auditoria', async () => {
    const A = await consultorio();
    const B = await consultorio();
    const pB = await novoPaciente(db, B.ctx);
    const d = await documento(B.ctx, pB.id, 'aguardando_assinatura');
    expect((await get(d.id, '?estado=1', A.cookie)).status).toBe(404);
    expect((await get(d.id, '?base=1', A.cookie)).status).toBe(404);
    expect((await get(d.id, '', A.cookie)).status).toBe(404);
    expect(await leituras(B, d.id)).toBe(0);
  });
});
