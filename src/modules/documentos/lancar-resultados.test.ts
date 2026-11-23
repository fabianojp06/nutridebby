import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos } from '../../../test/documentos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { linhasParaLancar } from '@/app/painel/pacientes/[id]/exames/lancar';
import { auditLog } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { StatusDocumento } from './constantes';
import { salvarExameDoCatalogo } from '@/modules/exames/catalogo';
import { examesParaLancar } from './lancar-resultados';
import { MSG_SOLICITACAO } from './solicitacao';

// Plano 22 (T8, US-377 "Lançar resultados", RN-390, EP-D47, EP-D50): o que o "Novo exame" recebe de uma solicitação
// assinada — o título com a data do preparo e uma linha por exame, com os painéis expandidos pelo catálogo atual.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const FUSO = { fuso: 'America/Sao_Paulo' };

const CONTEUDO = {
  versao: 1, tipo: 'solicitacao_exames',
  exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'glicemia de jejum' }, { nome: 'Exame fora do catálogo' }],
  indicacaoClinica: 'Acompanhar a resposta à dieta.', orientacoes: 'Jejum de 8 horas.', orientacoesFormato: 'marcacao',
};

async function cenario() {
  const T = await novoTenant(app.db);
  await liberarDocumentos(app.db, T.tenantId);
  await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Hemograma completo', componentes: ['Hemoglobina', 'Hematócrito'] }, deps);
  await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Hemoglobina', unidade: 'g/dL' }, deps);
  await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Glicemia de jejum', unidade: 'mg/dL' }, deps);
  const p = await novoPaciente(app.db, T.ctx);
  return { T, p };
}

/** A solicitação com a data do preparo: 02h UTC de 10/11 = 23h de 09/11 em São Paulo (a data do título é a do fuso). */
const PREPARO = new Date('2026-11-10T02:00:00Z');
async function solicitacao(ctx: TenantContext, patientId: string, status: StatusDocumento, o: { tipo?: 'receita'; conteudo?: Record<string, unknown> } = {}) {
  const d = await documentoNoBanco(app.db, ctx, patientId, { status, tipo: o.tipo ?? 'solicitacao_exames', conteudo: o.conteudo ?? CONTEUDO, declaracaoEm: status === 'rascunho' ? undefined : PREPARO });
  return d.id;
}

const leituras = (ctx: TenantContext, docId: string) =>
  withTenant(ctx, (tx) => tx.select({ acao: auditLog.acao }).from(auditLog).where(and(eq(auditLog.entidade, 'documentos'), eq(auditLog.acao, 'ler'), eq(auditLog.entidadeId, docId))), app.db);

describe('examesParaLancar (RN-390)', () => {
  it('a solicitação assinada em vigor: "Exames solicitados em {data do preparo, no fuso}", painel expandido com as unidades do catálogo e um `ler` gravado', async () => {
    const { T, p } = await cenario();
    const id = await solicitacao(T.ctx, p.id, 'assinado');
    expect(await leituras(T.ctx, id)).toEqual([]);
    const r = await examesParaLancar(T.ctx, p.id, id, deps);
    expect(r).toEqual({
      titulo: MSG_SOLICITACAO.examesSolicitadosEm('09/11/2026'),
      linhas: [
        { nome: 'Hemoglobina', unidade: 'g/dL' },
        { nome: 'Hematócrito', unidade: null },
        { nome: 'glicemia de jejum', unidade: 'mg/dL' },
        { nome: 'Exame fora do catálogo', unidade: null },
      ],
    });
    expect(r!.titulo).toBe('Exames solicitados em 09/11/2026');
    expect(await leituras(T.ctx, id)).toEqual([{ acao: 'ler' }]);
  });

  it('o painel expande com o catálogo ATUAL (o conteúdo assinado não muda); um painel que saiu do catálogo vira uma linha só', async () => {
    const { T, p } = await cenario();
    const id = await solicitacao(T.ctx, p.id, 'assinado', { conteudo: { ...CONTEUDO, exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'Perfil lipídico', painel: true }] } });
    const r = await examesParaLancar(T.ctx, p.id, id, deps);
    expect(r!.linhas).toEqual([{ nome: 'Hemoglobina', unidade: 'g/dL' }, { nome: 'Hematócrito', unidade: null }, { nome: 'Perfil lipídico', unidade: null }]);
  });

  it('rascunho, preparando, cancelada, substituída, de outro tipo, de outro paciente ou id inválido → null e nenhum `ler`', async () => {
    const { T, p } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const ids = [
      await solicitacao(T.ctx, p.id, 'rascunho'),
      await solicitacao(T.ctx, p.id, 'cancelado'),
      await solicitacao(T.ctx, p.id, 'substituido'),
      await solicitacao(T.ctx, p.id, 'assinado', { tipo: 'receita', conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: '' } }),
    ];
    for (const id of ids) expect(await examesParaLancar(T.ctx, p.id, id, deps), id).toBeNull();
    const deOutro = await solicitacao(T.ctx, outro.id, 'assinado');
    expect(await examesParaLancar(T.ctx, p.id, deOutro, deps)).toBeNull();
    expect(await examesParaLancar(T.ctx, p.id, 'nao-e-uuid', deps)).toBeNull();
    expect(await examesParaLancar(T.ctx, p.id, randomUUID(), deps)).toBeNull();
    for (const id of [...ids, deOutro]) expect(await leituras(T.ctx, id), id).toEqual([]);
    // controle positivo: a mesma consulta acha a leitura quando ela existe
    expect(await examesParaLancar(T.ctx, outro.id, deOutro, deps)).not.toBeNull();
    expect(await leituras(T.ctx, deOutro)).toEqual([{ acao: 'ler' }]);
  });

  it('T12 (Minor da T8): a coluna diz solicitação, mas o conteúdo é de outro tipo → null e nenhum `ler` (a conferência vem antes da leitura auditada)', async () => {
    const { T, p } = await cenario();
    const id = await solicitacao(T.ctx, p.id, 'assinado', { conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: '' } });
    expect(await examesParaLancar(T.ctx, p.id, id, deps)).toBeNull();
    expect(await leituras(T.ctx, id)).toEqual([]);
    // controle positivo: a solicitação de verdade grava o `ler`
    const certo = await solicitacao(T.ctx, p.id, 'assinado');
    expect(await examesParaLancar(T.ctx, p.id, certo, deps)).not.toBeNull();
    expect(await leituras(T.ctx, certo)).toEqual([{ acao: 'ler' }]);
  });

  it('só a sessão nutri (o catálogo é staff_only): outro papel lança antes da transação', async () => {
    const { T, p } = await cenario();
    const id = await solicitacao(T.ctx, p.id, 'assinado');
    await expect(examesParaLancar(ctxPaciente(T.tenantId, p.id), p.id, id, deps)).rejects.toThrow('exames: só a sessão nutri');
    expect(await leituras(T.ctx, id)).toEqual([]);
  });
});

describe('linhasParaLancar (a decisão da página de exames, RN-398)', () => {
  const ID = randomUUID();
  it('com os documentos liberados, o id do `?solicitacao=`', () => {
    expect(linhasParaLancar({ documentosLiberados: true }, { solicitacao: ID })).toBe(ID);
  });
  it('documentos desligados: o parâmetro é ignorado (sem linhas pré-preenchidas e sem leitura)', () => {
    expect(linhasParaLancar({ documentosLiberados: false }, { solicitacao: ID })).toBeNull();
  });
  it('sem o parâmetro, repetido ou vazio: nada', () => {
    expect(linhasParaLancar({ documentosLiberados: true }, {})).toBeNull();
    expect(linhasParaLancar({ documentosLiberados: true }, { solicitacao: [ID, ID] })).toBeNull();
    expect(linhasParaLancar({ documentosLiberados: true }, { solicitacao: '' })).toBeNull();
  });
});
