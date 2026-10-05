import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, novoConsultorio, outroDocumento } from '../../../test/documentos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { limparArquivosOrfaosDeDocumentos } from './documento-pdf-job';
import { anonimizarDocumentosDoPaciente, documentosParaExportacao, pdfsDeDocumentosRestantes } from './lgpd-documentos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const conteudo = { versao: 1, tipo: 'receita', orientacoes: 'Com água.', itens: [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia', duracao: '', manipulado: false }], copia: { profissional: {}, paciente: { nome: 'Ana Souza' } } };
const existe = (f: string) => access(f).then(() => true, () => false);

describe('LGPD dos documentos (US-150 base, D15 da spec)', () => {
  it('equipe: todos, com a justificativa; titular: só os emitidos, com a justificativa e o recebimento; nunca o motivo de cancelamento', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = await documentoNoBanco(app.db, T.ctx, p.id, { conteudo });
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', conteudo });
    // 0092: o recibo "portal" só nasce na sessão do paciente, com o documento assinado; depois a nutricionista cancela
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${a.id}, 'aberto', 'portal')`), app.db);
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`update signed_documents set status = 'cancelado', cancelado_em = now() where id = ${a.id}`);
      await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${T.tenantId}, ${p.id}, ${r.id}, 'J rascunho')`);
      await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_cancelamento) values (${T.tenantId}, ${p.id}, ${a.id}, 'Dose errada')`);
    }, app.db);
    const equipe = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => documentosParaExportacao(tx, p.id, 'equipe'), app.db);
    expect(equipe.documentos.map((d) => d.situacao).sort()).toEqual(['Cancelado', 'Rascunho']);
    expect(JSON.stringify(equipe)).not.toContain('Dose errada');
    expect(equipe.documentos.find((d) => d.situacao === 'Rascunho')?.justificativaDeUso).toBe('J rascunho');
    expect(equipe.documentos.find((d) => d.situacao === 'Rascunho')?.codigo, 'o rascunho não tem código').toBeNull();
    const titular = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => documentosParaExportacao(tx, p.id, 'titular'), app.db);
    expect(titular.documentos.map((d) => d.situacao)).toEqual(['Cancelado']);
    expect(titular.documentos[0]).toMatchObject({
      tipo: 'Receita',
      codigo: `${a.codigo!.slice(0, 4)}-${a.codigo!.slice(4, 8)}-${a.codigo!.slice(8)}`,
      sha256: 'a'.repeat(64),
      assinatura: 'Digitalizado',
      orientacoes: 'Com água.',
      justificativaDeUso: null,
      recebimento: [expect.objectContaining({ evento: 'aberto', via: 'portal' })],
      pdf: null,
    });
    expect(titular.documentos[0].itens).toEqual([expect.objectContaining({ titulo: expect.stringContaining('Vitamina D3') })]);
    expect(JSON.stringify(titular)).not.toContain('Dose errada');
    expect(titular.anexos).toHaveLength(1);
    expect(titular.anexos[0]).toMatchObject({ indice: 0, caminho: a.pdfPath });
    expect(titular.anexos[0].nome).toMatch(/^documentos\/\d{4}-\d{2}-\d{2}-01\.pdf$/);
  });

  it('anonimização: emitido limpo pela função e PDF apagado do disco; rascunho e preparo apagados; nada sobra', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const dataDir = await mkdtemp(path.join(tmpdir(), 'lgpd-doc-'));
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', conteudo });
    await mkdir(path.join(dataDir, path.dirname(a.pdfPath!)), { recursive: true });
    await writeFile(path.join(dataDir, a.pdfPath!), '%PDF-1.3');
    await documentoNoBanco(app.db, T.ctx, p.id, { conteudo });
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
    const worker = { tenantId: T.tenantId, role: 'worker' as const };
    expect(await anonimizarDocumentosDoPaciente(worker, p.id, { db: app.db, dataDir })).toBe(2);
    const docs = await withTenant(T.ctx, (tx) => tx.execute(sql`select status, conteudo, pdf_path from signed_documents where patient_id = ${p.id}`), app.db);
    expect(docs.rows).toEqual([{ status: 'assinado', conteudo: {}, pdf_path: null }]);
    await expect(access(path.join(dataDir, a.pdfPath!))).rejects.toThrow();
    expect((await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where caminho = ${a.pdfPath}`), app.db)).rows).toEqual([]);
    expect(await withTenant(worker, (tx) => pdfsDeDocumentosRestantes(tx, p.id), app.db)).toBe(0);
    // idempotente: o anonimizado não volta à lista
    expect(await anonimizarDocumentosDoPaciente(worker, p.id, { db: app.db, dataDir })).toBe(0);
  });

  it('aguardando assinatura com fotos da digitalizada: as fotos e o base saem do disco e da cota, o documento some; nenhuma documento_digitalizado sobra', async () => {
    const c = await novoConsultorio(app.db);
    const x = await outroDocumento(c, app.db);
    const fotos = [`${c.T.tenantId}/documento_digitalizado/${randomUUID()}.jpg`, `${c.T.tenantId}/documento_digitalizado/${randomUUID()}.jpg`];
    await mkdir(path.join(c.dataDir, path.dirname(fotos[0])), { recursive: true });
    for (const f of fotos) await writeFile(path.join(c.dataDir, f), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await withTenant(c.T.ctx, async (tx) => {
      for (const f of fotos)
        await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${c.T.tenantId}, 'documento_digitalizado', ${f}, 4, 'image/jpeg', ${x.p.id})`);
      await tx.execute(sql`update signed_documents set digitalizacao = ${JSON.stringify(fotos)}::jsonb, digitalizacao_status = 'falhou', digitalizacao_em = now() where id = ${x.id}`);
      await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id) values (${c.T.tenantId}, ${x.p.id}, ${x.id})`);
      await tx.execute(sql`update patients set status = 'bloqueado' where id = ${x.p.id}`);
    }, app.db);
    const worker = { tenantId: c.T.tenantId, role: 'worker' as const };
    expect(await anonimizarDocumentosDoPaciente(worker, x.p.id, { db: app.db, dataDir: c.dataDir })).toBe(1);
    expect((await withTenant(c.T.ctx, (tx) => tx.execute(sql`select 1 from signed_documents where patient_id = ${x.p.id}`), app.db)).rows).toEqual([]);
    const sobra = await withTenant(c.T.ctx, (tx) => tx.execute(sql`select tipo from stored_files where patient_id = ${x.p.id}`), app.db);
    expect(sobra.rows).toEqual([]);
    for (const f of [...fotos, x.base]) expect(await existe(path.join(c.dataDir, f)), f).toBe(false);
    expect(await withTenant(worker, (tx) => pdfsDeDocumentosRestantes(tx, x.p.id), app.db)).toBe(0);
  });

  it('R14: base ainda apontado num emitido quando a função o solta (o soltar falhou duas vezes) — a varredura da T7 apaga o arquivo e o stored_files', async () => {
    const c = await novoConsultorio(app.db);
    const x = await outroDocumento(c, app.db);
    const assinado = `${c.T.tenantId}/documento_assinado/${randomUUID()}.pdf`;
    await withTenant(c.T.ctx, async (tx) => {
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${c.T.tenantId}, 'documento_assinado', ${assinado}, 100, 'application/pdf', ${x.p.id})`);
      // como depois da assinatura: o base continua apontado até o soltarArquivosDoPreparo (que aqui "falhou")
      await tx.execute(sql`update signed_documents set status = 'assinado', pdf_path = ${assinado}, pdf_sha256 = ${'b'.repeat(64)}, assinatura_tipo = 'digitalizada', assinado_em = now(), assinado_por = ${c.T.nutriId} where id = ${x.id}`);
      await tx.execute(sql`update patients set status = 'bloqueado' where id = ${x.p.id}`);
    }, app.db);
    const worker = { tenantId: c.T.tenantId, role: 'worker' as const };
    const r = await withTenant(worker, (tx) => tx.execute<{ caminho: string | null }>(sql`select app_anonimizar_documentos(${x.id}) as caminho`), app.db);
    expect(r.rows[0].caminho).toBe(assinado);
    expect(await withTenant(worker, (tx) => pdfsDeDocumentosRestantes(tx, x.p.id), app.db)).toBe(0);
    expect(await existe(path.join(c.dataDir, x.base)), 'o base ficou no disco até a varredura').toBe(true);
    expect(await limparArquivosOrfaosDeDocumentos(app.db, new Date(Date.now() + 2 * 3600_000), c.dataDir, { tenantId: c.T.tenantId })).toBeGreaterThanOrEqual(1);
    expect((await withTenant(c.T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where caminho = ${x.base}`), app.db)).rows).toEqual([]);
    expect(await existe(path.join(c.dataDir, x.base))).toBe(false);
  });
});
