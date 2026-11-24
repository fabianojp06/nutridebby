import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, novoConsultorio } from '../../../test/documentos';
import { textoDoPdf } from '../../../test/pdf';
import { novoPaciente } from '../../../test/pacientes';
import { tenants, type TenantRow } from '@/db/schema';
import { renderizarDocumento } from './documento-pdf';
import { lerDocumento, salvarRascunhoReceita } from './documentos';
import type { ConteudoReceita } from './prescricao';

// Plano 22 (T9, RN-395, RNF-374, Review Focus 5): a marcação mínima das orientações nunca vira HTML nem conteúdo ativo —
// no PDF da receita e da solicitação o texto malicioso sai literal (sem link, sem anotação); a receita antiga (sem
// `orientacoesFormato`) continua em texto puro; o rascunho antigo salvo de novo no editor passa a `'marcacao'`.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const copia = { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'debby@consultorio.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false }, paciente: { nome: 'Ana Souza' } };
const dados = { codigo: 'ABCDEFGHJKMN', urlVerificacao: 'https://x/v/ABCDEFGHJKMN', data: '01/10/2026', cor: '#0f766e', logo: null, nomeConsultorio: 'Consultório Debby' };
const MALICIOSA = 'Tome **com água** & coma bem.\n\n- <script>alert(1)</script>\n- [site](https://mal.example) <b>x</b>\n\nVeja https://mal.example';
const vitD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia', duracao: '', manipulado: false };

/** O PDF não tem link nem ação (nenhuma anotação /Link, /URI ou /JavaScript): a marcação só desenha texto. */
const semConteudoAtivo = (pdf: Buffer) => {
  const bruto = pdf.toString('latin1');
  for (const ativo of ['/Link', '/URI', '/JavaScript', '/Annots', '/OpenAction']) expect(bruto, ativo).not.toContain(ativo);
};

describe('marcação no PDF (RN-395, RNF-374)', () => {
  it('receita: negrito e lista viram texto; "<script>", tags, o link em marcação e a URL saem literais, sem anotação de link', async () => {
    const pdf = await renderizarDocumento({ conteudo: { versao: 1, tipo: 'receita', itens: [vitD], orientacoes: MALICIOSA, orientacoesFormato: 'marcacao', copia } as never, ...dados });
    const t = textoDoPdf(pdf);
    for (const trecho of ['Orientações gerais', 'Tome ', 'com água', ' & coma bem.', '<script>alert(1)</script>', '[site](https://mal.example) <b>x</b>', 'Veja https://mal.example']) expect(t, trecho).toContain(trecho);
    expect(t).not.toContain('**'); // a marca do negrito não sai
    expect(t).not.toContain('- <script>'); // o hífen da lista vira o marcador "•" (0x95 no WinAnsi; o textoDoPdf lê em latin1)
    expect(t).toContain('\x95 <script>alert(1)</script>');
    semConteudoAtivo(pdf);
  });

  it('solicitação: o mesmo para as orientações ao paciente', async () => {
    const conteudo = { versao: 1, tipo: 'solicitacao_exames', exames: [{ nome: 'Glicose' }], indicacaoClinica: null, orientacoes: MALICIOSA, orientacoesFormato: 'marcacao', copia };
    const pdf = await renderizarDocumento({ conteudo: conteudo as never, ...dados });
    const t = textoDoPdf(pdf);
    for (const trecho of ['Orientações', 'com água', '<script>alert(1)</script>', '<b>x</b>']) expect(t, trecho).toContain(trecho);
    expect(t).not.toContain('**');
    semConteudoAtivo(pdf);
  });

  it('receita antiga (sem orientacoesFormato): texto puro como antes — os "**" e o hífen ficam como foram escritos', async () => {
    const t = textoDoPdf(await renderizarDocumento({ conteudo: { versao: 1, tipo: 'receita', itens: [vitD], orientacoes: 'Tome **com água**.', copia } as never, ...dados }));
    expect(t).toContain('Orientações gerais: Tome **com água**.');
    expect(t).not.toContain('\x95');
  });
});

describe('marcação no rascunho (RN-395)', () => {
  it('um rascunho antigo (sem a chave) salvo de novo no editor passa a orientacoesFormato "marcacao"; as quebras de linha ficam', async () => {
    const c = await novoConsultorio(app.db);
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.T.tenantId));
    const p = await novoPaciente(app.db, c.T.ctx);
    const antigo = await documentoNoBanco(app.db, c.T.ctx, p.id, { conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: 'Com água.' } });
    expect((await lerDocumento(c.T.ctx, p.id, antigo.id, app.db))!.conteudo).not.toHaveProperty('orientacoesFormato');
    await salvarRascunhoReceita(c.T.ctx, t as TenantRow, p.id, antigo.id, { conteudo: { itens: [], orientacoes: 'Com **água**.\r\n\r\n- de manhã\n- à noite' }, justificativa: '' }, { db: app.db });
    expect((await lerDocumento(c.T.ctx, p.id, antigo.id, app.db))!.conteudo as ConteudoReceita).toEqual({
      versao: 1, tipo: 'receita', itens: [], orientacoes: 'Com **água**.\n\n- de manhã\n- à noite', orientacoesFormato: 'marcacao',
    });
  });
});
