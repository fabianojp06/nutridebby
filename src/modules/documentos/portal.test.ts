import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos } from '../../../test/documentos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { linhaDaAssinatura } from './constantes';
import { caminhoDoPdfNoPortal, confirmarRecebimentoNoPortal, documentosDoPaciente, novosNoPortal } from './portal';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
/** D20 ligado (o novoTenant nasce desligado, como em produção). */
const consultorioLiberado = async () => {
  const T = await novoTenant(app.db);
  await liberarDocumentos(app.db, T.tenantId);
  return T;
};

describe('documentos no portal (US-146)', () => {
  it('só os emitidos do próprio paciente, do mais novo para o mais antigo; a lista não audita', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    await documentoNoBanco(app.db, T.ctx, p.id);
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const c = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    await documentoNoBanco(app.db, T.ctx, outro.id, { status: 'assinado' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    const lista = await documentosDoPaciente(ctx, app.db);
    expect(lista.map((d) => d.id).sort()).toEqual([a.id, c.id].sort());
    // D17 / regra 8 do CLAUDE.md: a lista não audita porque não devolve conteúdo — só estas chaves
    expect(Object.keys(lista[0]).sort()).toEqual(['aberto', 'assinaturaTipo', 'data', 'id', 'recebidoEm', 'status', 'titulo']);
    expect(await novosNoPortal(ctx, app.db)).toBe(1); // o assinado ainda não aberto (o cancelado não conta)
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where entidade = 'documentos' and acao = 'ler'`), app.db);
    expect(audit.rows).toEqual([]);
  });

  it('D20: com o interruptor do admin desligado, o portal não mostra nem entrega nada (lista vazia, 0 novos, sem PDF, sem recibo)', async () => {
    const T = await novoTenant(app.db); // documentos_liberados = false (padrão)
    const p = await novoPaciente(app.db, T.ctx);
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await documentosDoPaciente(ctx, app.db)).toEqual([]);
    expect(await novosNoPortal(ctx, app.db)).toBe(0);
    expect(await caminhoDoPdfNoPortal(ctx, a.id, app.db)).toBeNull();
    expect(await confirmarRecebimentoNoPortal(ctx, a.id, app.db)).toBeNull();
    const recibos = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from signed_document_receipts where documento_id = ${a.id}`), app.db);
    expect(recibos.rows).toEqual([]);
  });

  it('RN-157: a digitalizada aparece como "Assinatura: Digitalizado" (o Plano 10B acrescenta o caso do gov.br)', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const dig = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', assinaturaTipo: 'digitalizada' });
    const lista = await documentosDoPaciente(ctxPaciente(T.tenantId, p.id), app.db);
    expect(linhaDaAssinatura(lista.find((d) => d.id === dig.id)!.assinaturaTipo)).toBe('Assinatura: Digitalizado');
  });

  it('abrir o PDF audita e grava "aberto" uma vez; confirmar grava "recebido" uma vez; cancelado não confirma; rascunho dá 404', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const c = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    const r = await documentoNoBanco(app.db, T.ctx, p.id);
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await caminhoDoPdfNoPortal(ctx, a.id, app.db)).toBe(a.pdfPath);
    expect(await caminhoDoPdfNoPortal(ctx, a.id, app.db)).toBe(a.pdfPath);
    expect(await caminhoDoPdfNoPortal(ctx, r.id, app.db)).toBeNull();
    const recibos = await withTenant(T.ctx, (tx) => tx.execute(sql`select evento, via from signed_document_receipts where documento_id = ${a.id}`), app.db);
    expect(recibos.rows).toEqual([{ evento: 'aberto', via: 'portal' }]);
    const em = await confirmarRecebimentoNoPortal(ctx, a.id, app.db);
    expect(em).toBeInstanceOf(Date);
    expect(await confirmarRecebimentoNoPortal(ctx, a.id, app.db)).toEqual(em); // a mesma data, sem linha nova
    expect(await confirmarRecebimentoNoPortal(ctx, c.id, app.db)).toBeNull();
  });
});
