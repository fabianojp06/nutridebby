import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { codigoAleatorio, pdfDeTeste } from '../../../../../../../test/documentos';
import { novoPaciente } from '../../../../../../../test/pacientes';
import { criarEEntrar } from '../../../../../../../test/sessao';
import { POST } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
afterEach(() => vi.restoreAllMocks());

/** Nutricionista com DPA aceito, 2FA ligado e cookie de sessão; documentos liberados (D20) ou não. */
async function consultorio(liberado = true) {
  const [t] = await db.insert(tenants).values({ slug: `dg-${randomUUID().slice(0, 8)}`, nomeExibicao: 'DG', documentosLiberados: liberado }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id, twoFactorEnabled: true });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { tenantId: t.id, cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}

/** Um documento em "Aguardando assinatura" (o base só no stored_files: a rota não o lê), direto no banco. */
async function aguardando(ctx: TenantContext) {
  const p = await novoPaciente(db, ctx);
  const id = randomUUID();
  const base = `${ctx.tenantId}/documento_base/${randomUUID()}.pdf`;
  await withTenant(ctx, async (tx) => {
    await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${ctx.tenantId}, 'documento_base', ${base}, 100, 'application/pdf', ${p.id})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em, pdf_status, base_pdf_path)
      values (${id}, ${ctx.tenantId}, ${p.id}, 'aguardando_assinatura', ${codigoAleatorio()}, '{"versao":1,"tipo":"receita","itens":[],"orientacoes":""}'::jsonb, now(), 'pronto', ${base})`);
  }, db);
  return id;
}

const situacao = async (ctx: TenantContext, id: string) =>
  (await withTenant(ctx, (tx) => tx.execute(sql`select status, digitalizacao, digitalizacao_status from signed_documents where id = ${id}`), db)).rows[0];

function enviar(id: string, o: { cookie?: string; origin?: string; corpo?: BodyInit; contentType?: string } = {}) {
  const headers: Record<string, string> = { origin: o.origin ?? 'http://localhost:3000' };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.contentType) headers['content-type'] = o.contentType;
  return POST(new Request(`http://localhost:3000/api/painel/documentos/${id}/digitalizada`, { method: 'POST', body: o.corpo ?? new FormData(), headers }), {
    params: Promise.resolve({ id }),
  });
}

describe('POST /api/painel/documentos/[id]/digitalizada (RN-157, US-144)', () => {
  it('origem estranha → 403; sem sessão → 401; consultório sem documentos liberados → 404; id fora do formato → 404', async () => {
    const A = await consultorio();
    const id = await aguardando(A.ctx);
    expect((await enviar(id, { cookie: A.cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await enviar(id)).status).toBe(401);
    const B = await consultorio(false);
    const idB = await aguardando(B.ctx);
    const r = await enviar(idB, { cookie: B.cookie });
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await enviar('abc', { cookie: A.cookie })).status).toBe(404);
  });

  it('corpo de 11 MB → 413 "Envie de 1 a 5 fotos, até 10 MB no total." e nada muda', async () => {
    const A = await consultorio();
    const id = await aguardando(A.ctx);
    const r = await enviar(id, { cookie: A.cookie, corpo: new Uint8Array(11 * 1024 * 1024), contentType: 'multipart/form-data; boundary=x' });
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ erro: 'Envie de 1 a 5 fotos, até 10 MB no total.' });
    expect(await situacao(A.ctx, id)).toEqual({ status: 'aguardando_assinatura', digitalizacao: null, digitalizacao_status: null });
  });

  it('um PDF no campo "fotos" → 422 "Envie fotos das páginas (JPEG ou PNG)."; o documento continua "Aguardando assinatura"; o log só leva tenant, documento e motivo', async () => {
    const A = await consultorio();
    const id = await aguardando(A.ctx);
    const info = vi.spyOn(logger, 'info');
    const form = new FormData();
    form.append('fotos', new Blob([new Uint8Array(pdfDeTeste())], { type: 'image/jpeg' }), 'pagina.jpg');
    form.append('codigo2fa', '482913');
    const r = await enviar(id, { cookie: A.cookie, corpo: form });
    expect(r.status).toBe(422);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ erro: 'Envie fotos das páginas (JPEG ou PNG).', codigo: 'imagens' });
    expect(await situacao(A.ctx, id)).toEqual({ status: 'aguardando_assinatura', digitalizacao: null, digitalizacao_status: null });
    const recusa = info.mock.calls.find((c) => c[1] === 'digitalização recusada');
    expect(recusa?.[0]).toEqual({ tenantId: A.tenantId, documentoId: id, motivo: 'tipo' });
    expect(JSON.stringify(info.mock.calls)).not.toContain('482913'); // nunca o código do 2FA
  });
});
