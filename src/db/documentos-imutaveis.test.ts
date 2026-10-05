import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { documentoNoBanco } from '../../test/documentos';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const negado = (e: unknown) => (((e as { cause?: unknown }).cause ?? e) as { code?: string }).code === '42501';
const fk = (e: unknown) => (((e as { cause?: unknown }).cause ?? e) as { code?: string }).code === '23503';
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });
const linha = async (ctx: TenantContext, id: string) =>
  (await withTenant(ctx, (tx) => tx.execute(sql`select status, conteudo, pdf_path, codigo, anonimizado_em from signed_documents where id = ${id}`), app.db)).rows[0] as Record<string, unknown>;

describe('app_documento_imutavel (RN-140, RN-141, CS-141)', () => {
  it('rascunho: o conteúdo muda e o rascunho pode ser apagado; tenant/paciente/tipo nunca mudam', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await q(sql`update signed_documents set conteudo = '{"versao":1,"tipo":"receita","itens":[],"orientacoes":"x"}' where id = ${d.id}`);
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(q(sql`update signed_documents set patient_id = ${outro.id} where id = ${d.id}`)).rejects.toSatisfy(negado);
    // Minor 13 (revisão de segurança): fora dos emitidos, nada de PDF assinado, SHA-256, data ou tipo de assinatura
    await expect(q(sql`update signed_documents set pdf_sha256 = ${'c'.repeat(64)} where id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`update signed_documents set assinatura_tipo = 'digitalizada' where id = ${d.id}`)).rejects.toSatisfy(negado);
    await q(sql`delete from signed_documents where id = ${d.id}`);
  });

  it('preparando → aguardando_assinatura só pelo worker, com o PDF base uma vez; voltar a editar limpa código e base', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'preparando' });
    const base = `${T.tenantId}/documento_base/${randomUUID()}.pdf`;
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id})`), app.db);
    const pronto = sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10, area_assinatura = '{"x1":351,"y1":62,"x2":559,"y2":132}' where id = ${d.id}`;
    await expect(withTenant(T.ctx, (tx) => tx.execute(pronto), app.db)).rejects.toSatisfy(negado);
    await withTenant(worker(T.tenantId), (tx) => tx.execute(pronto), app.db);
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set conteudo = '{}' where id = ${d.id}`), app.db)).rejects.toSatisfy(negado);
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'rascunho' where id = ${d.id}`), app.db)).rejects.toSatisfy(negado); // código ficou
    await withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'rascunho', codigo = null, declaracao_em = null, base_pdf_path = null, base_pdf_sha256 = null, base_pdf_bytes = null, area_assinatura = null, pdf_status = null, digitalizacao_em = null where id = ${d.id}`), app.db);
    expect((await linha(T.ctx, d.id)).codigo).toBeNull();
  });

  it('assinado: conteúdo, PDF e SHA-256 nunca mudam, nem pelo DELETE; o PDF base pode sair; o no-op passa; cancelar é a única saída', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await expect(q(sql`update signed_documents set conteudo = '{"x":1}' where id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`update signed_documents set pdf_sha256 = ${'c'.repeat(64)} where id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`update signed_documents set status = 'rascunho', codigo = null where id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`delete from signed_documents where id = ${d.id}`)).rejects.toSatisfy(negado);
    await q(sql`update signed_documents set tenant_id = tenant_id, updated_at = now() where id = ${d.id}`); // no-op
    await q(sql`update signed_documents set status = 'cancelado', cancelado_em = now() where id = ${d.id}`);
    await expect(q(sql`update signed_documents set status = 'assinado', cancelado_em = null where id = ${d.id}`)).rejects.toSatisfy(negado);
  });

  it('regra 9: a assinatura mantém os ponteiros do base e das fotos; depois eles só saem (base → nulo, fotos encolhem), nunca trocam nem crescem', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'preparando' });
    const arq = (tipo: string) => `${T.tenantId}/${tipo}/${randomUUID()}.pdf`;
    const [base, assinado] = [arq('documento_base'), arq('documento_assinado')];
    const fotos = [arq('documento_digitalizado'), arq('documento_digitalizado')];
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await q(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id}), (${T.tenantId}, 'documento_assinado', ${assinado}, 10, 'application/pdf', ${p.id})`);
    await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10 where id = ${d.id}`), app.db);
    await q(sql`update signed_documents set digitalizacao = ${JSON.stringify(fotos)}::jsonb, digitalizacao_status = 'pendente', digitalizacao_em = now() where id = ${d.id}`);
    const assinar = (extra: ReturnType<typeof sql>) =>
      sql`update signed_documents set status = 'assinado', pdf_path = ${assinado}, pdf_sha256 = ${'a'.repeat(64)}, assinado_em = now(), assinatura_tipo = 'digitalizada', digitalizacao_status = null, digitalizacao_em = null${extra} where id = ${d.id}`;
    await expect(q(assinar(sql`, base_pdf_path = null`))).rejects.toSatisfy(negado); // o ponteiro só sai no apagarArquivo do base
    await expect(q(assinar(sql`, digitalizacao = null`))).rejects.toSatisfy(negado);
    await q(assinar(sql``));
    await expect(q(sql`update signed_documents set digitalizacao = ${JSON.stringify([...fotos, arq('documento_digitalizado')])}::jsonb where id = ${d.id}`)).rejects.toSatisfy(negado); // cresce
    await expect(q(sql`update signed_documents set base_pdf_path = ${arq('documento_base')} where id = ${d.id}`)).rejects.toSatisfy(negado); // troca
    await expect(q(sql`update signed_documents set digitalizacao = to_jsonb(${fotos[1]}::text) where id = ${d.id}`)).rejects.toSatisfy(negado); // escalar (R15)
    await q(sql`update signed_documents set digitalizacao = ${JSON.stringify([fotos[1]])}::jsonb where id = ${d.id}`); // uma foto sai
    await q(sql`update signed_documents set digitalizacao = null where id = ${d.id}`);
    await q(sql`update signed_documents set base_pdf_path = null where id = ${d.id}`);
    await expect(q(sql`update signed_documents set base_pdf_path = ${base} where id = ${d.id}`)).rejects.toSatisfy(negado); // de nulo, não volta
    expect(await linha(T.ctx, d.id)).toMatchObject({ status: 'assinado', pdf_path: assinado });
  });

  it('a FK NO ACTION recusa apagarArquivo avulso do PDF assinado, e nada muda', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const dataDir = await mkdtemp(path.join(tmpdir(), 'doc-'));
    await mkdir(path.join(dataDir, path.dirname(d.pdfPath!)), { recursive: true });
    await writeFile(path.join(dataDir, d.pdfPath!), 'x');
    await expect(apagarArquivo(T.ctx, { caminho: d.pdfPath! }, { db: app.db, dataDir })).rejects.toSatisfy(fk);
    expect((await linha(T.ctx, d.id)).pdf_path).toBe(d.pdfPath);
  });

  it('anonimização: só o worker, só paciente bloqueado; limpa conteúdo e notas, solta o PDF e elimina a verificação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    // R2 do pre-flight: a justificativa só entra no rascunho; o motivo entra com o documento já cancelado (US-149)
    await withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'cancelado', cancelado_em = now() where id = ${d.id}`), app.db);
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_cancelamento) values (${T.tenantId}, ${p.id}, ${d.id}, 'Motivo')`), app.db);
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
      values (${d.codigo}, ${T.tenantId}, ${d.id}, 'receita', now(), 'Debby Silva', 'CRN-3 12345', null, 'digitalizada', ${'a'.repeat(64)})`);
    const anonimizar = sql`select app_anonimizar_documentos(${d.id}) as caminho`;
    await expect(withTenant(T.ctx, (tx) => tx.execute(anonimizar), app.db)).rejects.toSatisfy(negado); // nutri
    await expect(withTenant(worker(T.tenantId), (tx) => tx.execute(anonimizar), app.db)).rejects.toSatisfy(negado); // paciente ativo
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set anonimizado_em = now(), conteudo = '{}', pdf_path = null where id = ${d.id}`), app.db)).rejects.toSatisfy(negado);
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
    const r = await withTenant(worker(T.tenantId), (tx) => tx.execute(anonimizar), app.db);
    expect(r.rows[0].caminho).toBe(d.pdfPath);
    const depois = await linha(T.ctx, d.id);
    expect(depois).toMatchObject({ conteudo: {}, pdf_path: null });
    expect(depois.anonimizado_em).not.toBeNull();
    const nota = (await withTenant(T.ctx, (tx) => tx.execute(sql`select justificativa_uso, motivo_cancelamento from signed_document_notes where documento_id = ${d.id}`), app.db)).rows[0];
    expect(nota).toMatchObject({ justificativa_uso: null, motivo_cancelamento: null });
    const v = (await app.db.execute(sql`select situacao from document_verifications where codigo = ${d.codigo}`)).rows[0];
    expect(v.situacao).toBe('eliminado');
    await expect(withTenant(worker(T.tenantId), (tx) => tx.execute(anonimizar), app.db)).rejects.toSatisfy(negado); // já anonimizado
  });

  it('notas: a justificativa muda no rascunho e fica fixa depois de preparar; nota de documento emitido não é apagada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${T.tenantId}, ${p.id}, ${d.id}, 'A')`);
    await q(sql`update signed_document_notes set justificativa_uso = 'B' where documento_id = ${d.id}`);
    await q(sql`update signed_documents set status = 'preparando', codigo = ${'ABCDEFGHJKMN'.split('').reverse().join('')}, declaracao_em = now() where id = ${d.id}`);
    await expect(q(sql`update signed_document_notes set justificativa_uso = 'C' where documento_id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`delete from signed_document_notes where documento_id = ${d.id}`)).rejects.toSatisfy(negado);
  });

  it('códigos do link (RN-158, Minor 14): tentativas só sobem de 1 em 1; a sessão nasce uma vez; o resto é fixo', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    const [c] = (await q(sql`insert into document_access_codes (tenant_id, patient_id, documento_id, codigo_hash, expira_em) values (${T.tenantId}, ${p.id}, ${d.id}, 'h', now() + interval '10 minutes') returning id`)).rows as { id: string }[];
    await q(sql`update document_access_codes set tentativas = tentativas + 1 where id = ${c.id}`);
    await expect(q(sql`update document_access_codes set tentativas = 0 where id = ${c.id}`)).rejects.toSatisfy(negado); // zerar
    await expect(q(sql`update document_access_codes set tentativas = 4 where id = ${c.id}`)).rejects.toSatisfy(negado); // pular
    await expect(q(sql`update document_access_codes set expira_em = now() + interval '1 day', codigo_hash = 'h2' where id = ${c.id}`)).rejects.toSatisfy(negado);
    await q(sql`update document_access_codes set usado_em = now(), sessao_hash = 'x', sessao_expira_em = now() + interval '15 minutes' where id = ${c.id}`);
    await expect(q(sql`update document_access_codes set sessao_hash = 'y', sessao_expira_em = now() + interval '1 day' where id = ${c.id}`)).rejects.toSatisfy(negado);
  });
});
