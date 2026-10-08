import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { codigoAleatorio, documentoNoBanco, retificacaoAssinadaNoBanco } from '../../test/documentos';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string; constraint?: string };
const negadoPor = (trecho: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(trecho);
const violaCheck = (nome: string) => (e: unknown) => causa(e).code === '23514' && causa(e).constraint === nome;
const unico = (e: unknown) => causa(e).code === '23505';
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

async function cenario(o: { bloqueado?: boolean } = {}) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx, o.bloqueado ? { status: 'bloqueado' } : {});
  const q = (s: ReturnType<typeof sql>, ctx: TenantContext = T.ctx) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, p, q };
}

describe('0104: o tipo "parecer" (spec v0.5, §10)', () => {
  it('signed_documents e document_verifications aceitam "receita" e "parecer" e nada mais', async () => {
    const { T, p, q } = await cenario();
    await documentoNoBanco(app.db, T.ctx, p.id, { tipo: 'parecer' });
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, tipo) values (${T.tenantId}, ${p.id}, 'atestado')`)).rejects.toSatisfy(violaCheck('signed_documents_tipo_valido'));
    const verificacao = (tipo: string, d: { id: string; codigo: string | null }) =>
      app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
        values (${d.codigo}, ${T.tenantId}, ${d.id}, ${tipo}, now(), 'Debby Silva', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    await verificacao('parecer', await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', tipo: 'parecer' }));
    await expect(verificacao('atestado', await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' }))).rejects.toSatisfy(violaCheck('document_verifications_tipo_valido'));
  });
});

describe('0105: app_documento_versao — o INSERT da versão nova (RN-146)', () => {
  it('sem retifica_id, só a versão 1; com retifica_id, só em rascunho, da original "assinado" do mesmo tipo e paciente, com a versão seguinte', async () => {
    const { T, p } = await cenario();
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { versao: 2 })).rejects.toSatisfy(negadoPor('versão sem retificação'));
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 3 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2, tipo: 'parecer' })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    const rascunho = await documentoNoBanco(app.db, T.ctx, p.id);
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: rascunho.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    const cancelado = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: cancelado.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(documentoNoBanco(app.db, T.ctx, outro.id, { retificaId: v1.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    // revisão do plano: a versão nova só nasce em rascunho (sem isso, pularia o motivo e ficariam duas "assinado" em vigor)
    for (const status of ['preparando', 'assinado'] as const)
      await expect(documentoNoBanco(app.db, T.ctx, p.id, { status, retificaId: v1.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    expect((await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 })).id).toBeTruthy();
  });

  it('outro consultório (desvio 11 do plano): B não retifica nem substitui um documento de A', async () => {
    const { T, p } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const B = await novoTenant(app.db);
    const pb = await novoPaciente(app.db, B.ctx);
    await expect(documentoNoBanco(app.db, B.ctx, pb.id, { retificaId: v1.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    const r = await withTenant(B.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'substituido', substituido_em = now() where id = ${v1.id}`), app.db);
    expect(r.rowCount).toBe(0); // RLS: B não vê a linha
    expect((await withTenant(T.ctx, (tx) => tx.execute(sql`select status from signed_documents where id = ${v1.id}`), app.db)).rows).toEqual([{ status: 'assinado' }]);
  });

  it('a original anonimizada não é retificada', async () => {
    const { T, p, q } = await cenario();
    const [{ id }] = (await q(sql`insert into signed_documents (tenant_id, patient_id, status, codigo, anonimizado_em) values (${T.tenantId}, ${p.id}, 'assinado', ${codigoAleatorio()}, now()) returning id`)).rows as { id: string }[];
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
  });

  it('uma retificação em andamento por documento (índice da 0089): a segunda bate no 23505; apagada a primeira, outra nasce', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 });
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 })).rejects.toSatisfy(unico);
    await q(sql`delete from signed_documents where id = ${v2.id}`);
    expect((await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 })).id).toBeTruthy();
  });
});

describe('0105: app_documento_imutavel — substituir, cancelar e preparar com a retificação (RN-146, RN-147, Q13-1)', () => {
  it('assinado → substituido só com uma retificação dela já "assinado" (nem sem retificação, nem com ela em rascunho)', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const substituir = sql`update signed_documents set status = 'substituido', substituido_em = now() where id = ${v1.id}`;
    await expect(q(substituir)).rejects.toSatisfy(negadoPor('substituição só com a retificação assinada'));
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 });
    await expect(q(substituir)).rejects.toSatisfy(negadoPor('substituição só com a retificação assinada'));
    await q(sql`delete from signed_documents where id = ${v2.id}`);
    // a retificação assinada pelo caminho dos gatilhos (rascunho → nota com o motivo → preparo → worker → assinado)
    await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: v1.id, versao: 1 }, { substituir: false });
    await q(substituir);
  });

  it('assinado → cancelado recusado com uma retificação em andamento; sem ela, passa (RN-147 também no banco)', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 });
    const cancelar = sql`update signed_documents set status = 'cancelado', cancelado_em = now() where id = ${v1.id}`;
    await expect(q(cancelar)).rejects.toSatisfy(negadoPor('cancelamento com retificação em andamento'));
    await q(sql`delete from signed_documents where id = ${v2.id}`);
    await q(cancelar);
  });

  it('a retificação só vai a "preparando" com o motivo na nota (1–500, sem só espaços); depois o motivo é fixo', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 });
    await q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id) values (${T.tenantId}, ${p.id}, ${v2.id})`);
    const preparar = sql`update signed_documents set status = 'preparando', codigo = ${codigoAleatorio()}, declaracao_em = now(), pdf_status = 'pendente', pdf_pedido_em = now() where id = ${v2.id}`;
    await expect(q(preparar)).rejects.toSatisfy(negadoPor('retificação sem motivo'));
    await q(sql`update signed_document_notes set motivo_retificacao = '   ' where documento_id = ${v2.id}`);
    await expect(q(preparar)).rejects.toSatisfy(negadoPor('retificação sem motivo'));
    await q(sql`update signed_document_notes set motivo_retificacao = ${'\n\t \r\n'} where documento_id = ${v2.id}`); // só quebras e tabulações
    await expect(q(preparar)).rejects.toSatisfy(negadoPor('retificação sem motivo'));
    await q(sql`update signed_document_notes set motivo_retificacao = 'Ferritina lançada depois do parecer' where documento_id = ${v2.id}`);
    await q(preparar);
    await expect(q(sql`update signed_document_notes set motivo_retificacao = 'outro' where documento_id = ${v2.id}`)).rejects.toSatisfy(negadoPor('nota congelada'));
    // a versão 1 (sem retificação) prepara sem motivo, como no 10A
    const r = await documentoNoBanco(app.db, T.ctx, p.id);
    await q(sql`update signed_documents set status = 'preparando', codigo = ${codigoAleatorio()}, declaracao_em = now(), pdf_status = 'pendente', pdf_pedido_em = now() where id = ${r.id}`);
  });
});

describe('0105: app_notas_imutaveis e app_anonimizar_documentos — o motivo da retificação', () => {
  it('o motivo só numa versão nova (com retifica_id) e com até 500 caracteres', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id);
    await expect(q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_retificacao) values (${T.tenantId}, ${p.id}, ${v1.id}, 'x')`)).rejects.toSatisfy(negadoPor('motivo de retificação só numa retificação'));
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: a.id, versao: 2 });
    await expect(q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_retificacao) values (${T.tenantId}, ${p.id}, ${v2.id}, ${'x'.repeat(501)})`)).rejects.toSatisfy(violaCheck('signed_document_notes_tamanhos'));
    await q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_retificacao) values (${T.tenantId}, ${p.id}, ${v2.id}, 'Ferritina')`);
  });

  it('a anonimização (worker, paciente bloqueado) limpa também o motivo da retificação', async () => {
    const { T, p, q } = await cenario({ bloqueado: true });
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: v1.id, versao: 1 }, { motivo: 'Ferritina lançada depois' });
    await q(sql`select app_anonimizar_documentos(${v2.id})`, worker(T.tenantId));
    expect((await q(sql`select motivo_retificacao, justificativa_uso from signed_document_notes where documento_id = ${v2.id}`)).rows).toEqual([{ motivo_retificacao: null, justificativa_uso: null }]);
    expect((await q(sql`select status from signed_documents where id = ${v1.id}`)).rows).toEqual([{ status: 'substituido' }]);
  });
});
