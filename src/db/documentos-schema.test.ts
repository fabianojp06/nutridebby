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

  it('recibo (Res. CFN 656, 0092): fora da sessão de paciente, só "pessoalmente" registrado pela própria usuária; "portal"/"link_email" forjados são recusados', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const recibo = (via: string, por: string | null, evento = 'recebido') =>
      sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via, registrado_por) values (${T.tenantId}, ${p.id}, ${d.id}, ${evento}, ${via}, ${por})`;
    const comoNutri = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    const comoWorker = (s: ReturnType<typeof sql>) => withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.execute(s), app.db);
    await expect(comoNutri(recibo('portal', null))).rejects.toSatisfy(negadoRls);
    await expect(comoNutri(recibo('link_email', null, 'aberto'))).rejects.toSatisfy(negadoRls);
    await expect(comoWorker(recibo('portal', null))).rejects.toSatisfy(negadoRls);
    await expect(comoNutri(recibo('pessoalmente', randomUUID()))).rejects.toSatisfy(negadoRls); // em nome de outra pessoa
    await comoNutri(recibo('pessoalmente', T.nutriId));
    const r = await comoNutri(sql`select evento, via, registrado_por from signed_document_receipts where documento_id = ${d.id}`);
    expect(r.rows).toEqual([{ evento: 'recebido', via: 'pessoalmente', registrado_por: T.nutriId }]);
  });

  it('código do link (RN-158, 0092): a sessão de paciente só cria código de documento assinado (não do cancelado, que ela vê)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const c = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    const codigo = (id: string) => sql`insert into document_access_codes (tenant_id, patient_id, documento_id, codigo_hash, expira_em) values (${T.tenantId}, ${p.id}, ${id}, 'h', now() + interval '10 minutes')`;
    const comoP = (s: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(s), app.db);
    expect((await comoP(sql`select id from signed_documents where id = ${c.id}`)).rows).toHaveLength(1);
    await expect(comoP(codigo(c.id))).rejects.toSatisfy(negadoRls);
    await comoP(codigo(a.id));
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select documento_id from document_access_codes where patient_id = ${p.id}`), app.db);
    expect(n.rows).toEqual([{ documento_id: a.id }]);
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
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const codigo = d.codigo!;
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, situacao, situacao_em, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
      values (${codigo}, ${T.tenantId}, ${d.id}, 'receita', 'valido', now(), now(), 'Debby Silva', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    await app.db.execute(sql`update document_verifications set situacao = 'cancelado', situacao_em = now() where codigo = ${codigo}`);
    await expect(app.db.execute(sql`update document_verifications set pdf_sha256 = ${'b'.repeat(64)} where codigo = ${codigo}`)).rejects.toSatisfy((e) => causa(e).code === '42501');
    await expect(app.db.execute(sql`delete from document_verifications where codigo = ${codigo}`)).rejects.toSatisfy((e) => causa(e).code === '42501');
    await expect(app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
      values (${codigo.split('').reverse().join('')}, ${T.tenantId}, ${randomUUID()}, 'receita', now(), 'Debby Silva', 'CRN-3 12345', 'DEBBY', 'icp', ${'a'.repeat(64)})`)).rejects.toSatisfy(restricao('document_verifications_assinatura_tipo_valida'));
  });

  it('document_verifications (0092): a situação só anda para a frente (nada volta a "valido"; "eliminado" é final) e a data não muda sozinha', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const nova = async () => {
      const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
      await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
        values (${d.codigo}, ${T.tenantId}, ${d.id}, 'receita', now(), 'Debby Silva', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
      return (situacao: string, em = sql`now() + interval '1 second'`) => app.db.execute(sql`update document_verifications set situacao = ${situacao}, situacao_em = ${em} where codigo = ${d.codigo}`);
    };
    const v1 = await nova();
    await expect(v1('valido')).rejects.toSatisfy(negadoRls); // mesma situação, outra data
    await v1('cancelado');
    await expect(v1('valido')).rejects.toSatisfy(negadoRls);
    await expect(v1('substituido')).rejects.toSatisfy(negadoRls);
    await v1('eliminado'); // retenção (app_anonimizar_documentos)
    await expect(v1('valido')).rejects.toSatisfy(negadoRls);
    await expect(v1('cancelado')).rejects.toSatisfy(negadoRls);
    const v2 = await nova();
    await v2('substituido');
    await expect(v2('cancelado')).rejects.toSatisfy(negadoRls);
    await v2('eliminado');
    const v3 = await nova();
    await v3('eliminado');
  });

  it('document_verifications (0092): aponta para um documento do mesmo tenant e com o mesmo código', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const outro = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const inserir = (codigo: string, tenantId: string, documentoId: string) =>
      app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
        values (${codigo}, ${tenantId}, ${documentoId}, 'receita', now(), 'Debby Silva', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    const fk = restricao('document_verifications_documento_fk');
    await expect(inserir(d.codigo!, T.tenantId, randomUUID())).rejects.toSatisfy(fk); // documento que não existe
    await expect(inserir(d.codigo!, U.tenantId, d.id)).rejects.toSatisfy(fk); // outro tenant
    await expect(inserir(outro.codigo!, T.tenantId, d.id)).rejects.toSatisfy(fk); // código de outro documento
    await inserir(d.codigo!, T.tenantId, d.id);
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
