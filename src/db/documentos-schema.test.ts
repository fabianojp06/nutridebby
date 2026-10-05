import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { documentoNoBanco } from '../../test/documentos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string; message?: string };
const restricao = (nome: string) => (e: unknown) => causa(e).constraint === nome;
const negadoRls = (e: unknown) => causa(e).code === '42501';

describe('tabelas de documentos assinados (§10 da spec v0.3)', () => {
  it('CHECKs: código só fora do rascunho e no formato Crockford; emitido sem PDF recusado; tipo só receita no Plano 10A', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, codigo) values (${T.tenantId}, ${p.id}, 'ABCDEFGHJKMN')`)).rejects.toSatisfy(restricao('signed_documents_codigo_so_fora_do_rascunho'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, status, codigo) values (${T.tenantId}, ${p.id}, 'preparando', 'ABCDEFGHIJKL')`)).rejects.toSatisfy(restricao('signed_documents_codigo_formato'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, status, codigo) values (${T.tenantId}, ${p.id}, 'assinado', 'ABCDEFGHJKMN')`)).rejects.toSatisfy(restricao('signed_documents_emitido_com_pdf'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, tipo) values (${T.tenantId}, ${p.id}, 'parecer')`)).rejects.toSatisfy(restricao('signed_documents_tipo_valido'));
    // Plano 10A: só a digitalizada existe; o Plano 10B amplia o CHECK para 'govbr' e 'icp'
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, assinatura_tipo) values (${T.tenantId}, ${p.id}, 'govbr')`)).rejects.toSatisfy(restricao('signed_documents_assinatura_tipo_valida'));
  });

  it('paciente_so_emitidos: a sessão de paciente vê o assinado e nunca o rascunho, nem pelo id; não altera nada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const rascunho = await documentoNoBanco(app.db, T.ctx, p.id);
    const assinado = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const comoP = ctxPaciente(T.tenantId, p.id);
    const vistos = await withTenant(comoP, (tx) => tx.execute(sql`select id from signed_documents`), app.db);
    expect(vistos.rows.map((r) => r.id)).toEqual([assinado.id]);
    const porId = await withTenant(comoP, (tx) => tx.execute(sql`select id from signed_documents where id = ${rascunho.id}`), app.db);
    expect(porId.rows).toEqual([]);
    const alterou = await withTenant(comoP, (tx) => tx.execute(sql`update signed_documents set entregue_em = now() where id = ${assinado.id}`), app.db);
    expect(alterou.rowCount).toBe(0); // paciente_sem_update
  });

  it('recibo (D11): o paciente insere o "recebido" do PRÓPRIO documento assinado, uma vez; nunca "pessoalmente", nunca de rascunho; nunca altera nem apaga', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const r = await documentoNoBanco(app.db, T.ctx, p.id);
    const dDoOutro = await documentoNoBanco(app.db, T.ctx, outro.id, { status: 'assinado' });
    const comoP = (s: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(s), app.db);
    await comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${d.id}, 'recebido', 'portal')`);
    await expect(comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${d.id}, 'recebido', 'portal')`)).rejects.toSatisfy(restricao('signed_document_receipts_um_por_evento'));
    await expect(comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${d.id}, 'aberto', 'pessoalmente')`)).rejects.toSatisfy(negadoRls);
    await expect(comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${r.id}, 'aberto', 'portal')`)).rejects.toSatisfy(negadoRls);
    await expect(comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${dDoOutro.id}, 'aberto', 'portal')`)).rejects.toSatisfy(negadoRls);
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`delete from signed_document_receipts where documento_id = ${d.id}`), app.db)).rejects.toSatisfy((e) => causa(e).code === '42501'); // REVOKE DELETE
  });

  it('notas (STAFF_ONLY): a sessão de paciente não vê as notas do documento (motivo do cancelamento)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    // R2 do pre-flight: a justificativa só entra no rascunho (gatilho da T2); o cancelado é emitido (o paciente o vê) e tem nota
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_cancelamento) values (${T.tenantId}, ${p.id}, ${d.id}, 'Motivo')`);
    }, app.db);
    expect((await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from signed_document_notes`), app.db)).rows).toHaveLength(1);
    expect((await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`select id from signed_documents`), app.db)).rows).toHaveLength(1);
    const comoP = (s: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(s), app.db);
    expect((await comoP(sql`select 1 from signed_document_notes`)).rows).toEqual([]);
  });

  it('document_verifications: fora da RLS, o app insere e muda só a situação; nunca apaga nem muda o SHA-256; no 10A só a digitalizada', async () => {
    const T = await novoTenant(app.db);
    const codigo = 'ABCDEFGHJKMN'.split('').sort(() => Math.random() - 0.5).join('');
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, situacao, situacao_em, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
      values (${codigo}, ${T.tenantId}, ${randomUUID()}, 'receita', 'valido', now(), now(), 'Debby Silva', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    await app.db.execute(sql`update document_verifications set situacao = 'cancelado', situacao_em = now() where codigo = ${codigo}`);
    await expect(app.db.execute(sql`update document_verifications set pdf_sha256 = ${'b'.repeat(64)} where codigo = ${codigo}`)).rejects.toSatisfy((e) => causa(e).code === '42501');
    await expect(app.db.execute(sql`delete from document_verifications where codigo = ${codigo}`)).rejects.toSatisfy((e) => causa(e).code === '42501');
    await expect(app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
      values (${codigo.split('').reverse().join('')}, ${T.tenantId}, ${randomUUID()}, 'receita', now(), 'Debby Silva', 'CRN-3 12345', 'DEBBY', 'icp', ${'a'.repeat(64)})`)).rejects.toSatisfy(restricao('document_verifications_assinatura_tipo_valida'));
  });

  it('paciente_arquivos: o paciente não vê a linha do PDF preparado (documento_base) nem das fotos da digitalizada; vê a do assinado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const caminho = (tipo: string) => `${T.tenantId}/${tipo}/${randomUUID()}.pdf`;
    await withTenant(T.ctx, async (tx) => {
      for (const tipo of ['documento_base', 'documento_digitalizado', 'documento_assinado'])
        await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, ${tipo}, ${caminho(tipo)}, 10, 'application/pdf', ${p.id})`);
    }, app.db);
    const vistos = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`select tipo from stored_files where tipo like 'documento_%'`), app.db);
    expect(vistos.rows.map((r) => r.tipo)).toEqual(['documento_assinado']);
  });
});
