import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos, retificacaoAssinadaNoBanco } from '../../../test/documentos';
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
    expect(Object.keys(lista[0]).sort()).toEqual(['aberto', 'assinaturaTipo', 'data', 'id', 'recebidoEm', 'status', 'tipo', 'titulo', 'versao']);
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

  it('Plano 13 (US-146 v0.5): parecer com o título dele; a versão 1 substituída e a 2 vigente aparecem as duas, cada uma com a sua versão', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', tipo: 'parecer' });
    const v2 = await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: v1.id, versao: 1 }, { tipo: 'parecer' });
    const lista = await documentosDoPaciente(ctxPaciente(T.tenantId, p.id), app.db);
    expect(lista.map((d) => ({ id: d.id, tipo: d.tipo, titulo: d.titulo, versao: d.versao, status: d.status })).sort((a, b) => a.versao - b.versao)).toEqual([
      { id: v1.id, tipo: 'parecer', titulo: 'Parecer nutricional', versao: 1, status: 'substituido' },
      { id: v2.id, tipo: 'parecer', titulo: 'Parecer nutricional', versao: 2, status: 'assinado' },
    ]);
    // o substituído não conta como novo (só "assinado" não aberto) e não confirma recebimento
    expect(await novosNoPortal(ctxPaciente(T.tenantId, p.id), app.db)).toBe(1);
    expect(await confirmarRecebimentoNoPortal(ctxPaciente(T.tenantId, p.id), v1.id, app.db)).toBeNull();
  });

  it('Plano 22 (T9, RN-395, D17 do 10A): com uma solicitação e uma receita com fórmula e orientações formatadas, as chaves continuam as de hoje — nada dos itens nem das orientações', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const formula = {
      tipo: 'formula_fitoterapica', formaFarmaceutica: 'Cápsula', via: 'oral', posologia: '1 cápsula à noite', duracao: '30 dias',
      compostos: [{ nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', padronizacao: '', quantidade: 200, unidade: 'mg' }, { nomenclatura: 'Melissa officinalis L.', parte: 'Folhas', extracao: 'Extrato seco', padronizacao: '', quantidade: 200, unidade: 'mg' }],
    };
    await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', conteudo: { versao: 1, tipo: 'receita', itens: [formula], orientacoes: '**Tomar à noite**', orientacoesFormato: 'marcacao' } });
    await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', tipo: 'solicitacao_exames', conteudo: { versao: 1, tipo: 'solicitacao_exames', exames: [{ nome: 'Glicose' }], indicacaoClinica: 'Acompanhar a dieta.', orientacoes: '- Jejum de 8 h', orientacoesFormato: 'marcacao' } });
    const lista = await documentosDoPaciente(ctxPaciente(T.tenantId, p.id), app.db);
    expect(lista.map((d) => d.titulo).sort()).toEqual(['Receita', 'Solicitação de exames laboratoriais']);
    for (const d of lista) expect(Object.keys(d).sort()).toEqual(['aberto', 'assinaturaTipo', 'data', 'id', 'recebidoEm', 'status', 'tipo', 'titulo', 'versao']);
    for (const fora of ['Passiflora', 'Tomar', 'Glicose', 'Jejum', 'Acompanhar', 'marcacao']) expect(JSON.stringify(lista)).not.toContain(fora);
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
    // regra 8 / RNF-142: cada abertura do PDF é uma leitura auditada do documento (o rascunho, que não abre, não audita)
    const leituras = async (id: string) =>
      (await withTenant(T.ctx, (tx) => tx.execute(sql`select patient_id from audit_log where acao = 'ler' and entidade = 'documentos' and entidade_id = ${id}`), app.db)).rows;
    expect(await caminhoDoPdfNoPortal(ctx, a.id, app.db)).toBe(a.pdfPath);
    expect(await leituras(a.id)).toEqual([{ patient_id: p.id }]);
    expect(await caminhoDoPdfNoPortal(ctx, a.id, app.db)).toBe(a.pdfPath);
    expect(await leituras(a.id)).toHaveLength(2);
    expect(await caminhoDoPdfNoPortal(ctx, r.id, app.db)).toBeNull();
    expect(await leituras(r.id)).toEqual([]);
    const recibos = await withTenant(T.ctx, (tx) => tx.execute(sql`select evento, via from signed_document_receipts where documento_id = ${a.id}`), app.db);
    expect(recibos.rows).toEqual([{ evento: 'aberto', via: 'portal' }]);
    const em = await confirmarRecebimentoNoPortal(ctx, a.id, app.db);
    expect(em).toBeInstanceOf(Date);
    expect(await confirmarRecebimentoNoPortal(ctx, a.id, app.db)).toEqual(em); // a mesma data, sem linha nova
    expect(await confirmarRecebimentoNoPortal(ctx, c.id, app.db)).toBeNull();
  });
});
