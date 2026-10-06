import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos } from '../../../test/documentos';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { cancelarDocumento, MSG_CANCELAMENTO } from './cancelamento';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import { confirmarRecebimentoNoPortal } from './portal';
import { consultarVerificacao } from './verificacao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

describe('cancelar documento (US-149, RN-147)', () => {
  it('sem motivo → texto da spec; com motivo → cancelado no prontuário, no portal e na verificação; e-mail neutro (D11)', async () => {
    const T = await novoTenant(app.db, 'Consultório Debby');
    await liberarDocumentos(app.db, T.tenantId); // D20 ligado: o "não confirma" do fim é pelo cancelamento, não pelo interruptor
    const { paciente, email } = await pacienteComConta(app.db, T, { nome: 'Ana Souza' });
    const d = await documentoNoBanco(app.db, T.ctx, paciente.id, { status: 'assinado' });
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
      values (${d.codigo}, ${T.tenantId}, ${d.id}, 'receita', now(), 'Débora', 'CRN-3 12345', null, 'digitalizada', ${'a'.repeat(64)})`);
    await expect(cancelarDocumento(T.ctx, paciente.id, d.id, '  ', { db: app.db, appUrl: 'https://x' })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.motivo === MSG_CANCELAMENTO.motivo);
    await cancelarDocumento(T.ctx, paciente.id, d.id, 'Dose digitada errada', { db: app.db, appUrl: 'https://x' });
    const [linha] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select d.status, n.motivo_cancelamento from signed_documents d left join signed_document_notes n on n.documento_id = d.id where d.id = ${d.id}`), app.db)).rows;
    expect(linha).toEqual({ status: 'cancelado', motivo_cancelamento: 'Dose digitada errada' });
    expect(await consultarVerificacao(d.codigo, { db: app.db, ipDoLimite: '192.0.2.77' })).toMatchObject({ tipo: 'ok', v: { situacao: 'cancelado' } });
    const [m] = await emailsNaFila('documento_atualizado', email);
    expect(m).toMatchObject({ nome: 'Ana', consultorio: 'Consultório Debby' });
    expect(JSON.stringify(m)).not.toContain('Dose');
    expect(await confirmarRecebimentoNoPortal(ctxPaciente(T.tenantId, paciente.id), d.id, app.db)).toBeNull();
  });

  it('com conta: o push neutro; sem conta: o link de uso único; arquivado: ninguém é avisado', async () => {
    const T = await novoTenant(app.db, 'Consultório Debby');
    await liberarDocumentos(app.db, T.tenantId);
    const { paciente: comConta } = await pacienteComConta(app.db, T);
    const d1 = await documentoNoBanco(app.db, T.ctx, comConta.id, { status: 'assinado' });
    await cancelarDocumento(T.ctx, comConta.id, d1.id, 'Motivo A', { db: app.db, appUrl: 'https://x' });
    const pushes = (await withTenant(T.ctx, (tx) => tx.execute(sql`select canal, tipo from notifications where patient_id = ${comConta.id}`), app.db)).rows;
    expect(pushes).toEqual([{ canal: 'push', tipo: 'documento_atualizado' }]);

    const semConta = await novoPaciente(app.db, T.ctx);
    const d2 = await documentoNoBanco(app.db, T.ctx, semConta.id, { status: 'assinado' });
    await cancelarDocumento(T.ctx, semConta.id, d2.id, 'Motivo B', { db: app.db, appUrl: 'https://x' });
    const [m] = await emailsNaFila('documento_atualizado', semConta.email);
    expect(m.link).toMatch(/^https:\/\/x\/documento\/[A-Za-z0-9_-]{92}$/);
    expect((await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from notifications where patient_id = ${semConta.id}`), app.db)).rows).toEqual([]);

    const arquivado = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const d3 = await documentoNoBanco(app.db, T.ctx, arquivado.id, { status: 'assinado' });
    await cancelarDocumento(T.ctx, arquivado.id, d3.id, 'Motivo C', { db: app.db, appUrl: 'https://x' });
    expect(await emailsNaFila('documento_atualizado', arquivado.email)).toEqual([]);
    const [l3] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status from signed_documents where id = ${d3.id}`), app.db)).rows;
    expect(l3).toEqual({ status: 'cancelado' });
  });

  it('só de "assinado"; motivo acima de 500 caracteres recusado; nada muda nem sai e-mail', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const assinado = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    await expect(cancelarDocumento(T.ctx, p.id, assinado.id, 'x'.repeat(501), { db: app.db, appUrl: 'https://x' })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.motivo === MSG_CANCELAMENTO.motivo);
    await cancelarDocumento(T.ctx, p.id, assinado.id, ` ${'x'.repeat(500)} `, { db: app.db, appUrl: 'https://x' }); // 500 depois do trim: vale
    for (const status of ['rascunho', 'aguardando_assinatura', 'cancelado'] as const) {
      const d = status === 'cancelado' ? assinado : await documentoNoBanco(app.db, T.ctx, p.id, { status });
      await expect(cancelarDocumento(T.ctx, p.id, d.id, 'Outro motivo', { db: app.db, appUrl: 'https://x' })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    }
    const notas = (await withTenant(T.ctx, (tx) => tx.execute(sql`select motivo_cancelamento from signed_document_notes where documento_id = ${assinado.id}`), app.db)).rows;
    expect(notas).toEqual([{ motivo_cancelamento: 'x'.repeat(500) }]);
    expect(await emailsNaFila('documento_atualizado', p.email)).toHaveLength(1); // só o do cancelamento que valeu
  });
});
