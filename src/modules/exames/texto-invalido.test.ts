import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco, INVALIDOS, limpo, semErroDoBanco, sujo } from '../../../test/erros-do-banco';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { examInterpretacoes, exams, examVersoes } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { numeroParaCampo } from '@/lib/numero';
import { criarExame, ExameError, lerValores } from '@/modules/pacientes/exames';
import { abrirExameDoCatalogo, salvarExameDoCatalogo } from './catalogo';
import { MSG_EXAMES } from './constantes';
import { editarExame, exameParaEditar, type LinhaEditada } from './edicao';
import { salvarNota } from './interpretacao';
import { abrirModeloSolicitacao, salvarModeloSolicitacao } from './modelos-solicitacao';

/**
 * SUS-109 (regra 3): o NUL e o surrogate UTF-16 sem par digitados nos exames (catálogo, modelos de solicitação, nota de
 * interpretação, edição e criação do exame com as linhas) não chegam ao banco — o Postgres recusaria (22P05/22P02 no jsonb, 22021 no text) com um trecho
 * do texto no log e no erro do app. O espião anota o SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(() => app.pool.end());
const deps = { db: app.db };
const FUSO = { fuso: 'America/Sao_Paulo' };

/** Uma linha do formulário com o caractere inválido no nome, na unidade e na referência (e um emoji em cada). */
const linhaSuja = (c: string): LinhaEditada => ({ origem: null, nome: sujo('Hemoglobina', c), valor: '13,5', unidade: `g${c}/dL 🙂`, referencia: sujo('12 a 16', c), refMin: '', refMax: '' });
const LINHA_LIMPA = { nome: limpo('Hemoglobina'), valor: 13.5, unidade: 'g/dL 🙂', referencia: limpo('12 a 16') };

async function exameDeTeste() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const exameId = await criarExame(
    T.ctx,
    T.tenant,
    p.id,
    { titulo: 'Rotina', data: '2026-09-01', valores: [{ nome: 'Glicemia de jejum', valor: '95', unidade: 'mg/dL', referencia: '70 a 99' }], arquivo: null },
    { db: app.db, now: new Date('2026-09-02T12:00:00Z') },
  );
  return { T, p, exameId };
}

describe('SUS-109: texto com NUL ou surrogate sem par nos exames', () => {
  it.each(INVALIDOS)('catálogo: nome, unidade, outros nomes, faixa (fonte), modelos de nota e componentes do painel com %s', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const faixa = { sexo: 'todos', idadeMin: '18', idadeMax: '120', aPartirDe: '', abaixoDe: '20', categoria: 'Deficiência', fonte: sujo('Diretriz X', ch) };
    const id = await semErroDoBanco(errosDoBanco, () =>
      salvarExameDoCatalogo(
        T.ctx,
        FUSO,
        null,
        { nome: sujo('Ferritina', ch), unidade: `ng/mL${ch}`, sinonimos: `${sujo('ferritina sérica', ch)}\n`, faixas: [faixa], modeloNotaAbaixo: sujo('Abaixo\r\n', ch), modeloNotaAcima: sujo('Acima', ch) },
        deps,
      ),
    );
    expect(await abrirExameDoCatalogo(T.ctx, id, deps)).toMatchObject({
      nome: limpo('Ferritina'),
      unidade: 'ng/mL',
      sinonimos: [limpo('ferritina sérica')],
      faixas: [{ fonte: limpo('Diretriz X') }],
      modeloNotaAbaixo: limpo('Abaixo\n'),
      modeloNotaAcima: limpo('Acima'),
    });
    const painel = await semErroDoBanco(errosDoBanco, () => salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: sujo('Lipidograma', ch), componentes: `${sujo('HDL', ch)}\nLDL${ch}` }, deps));
    expect(await abrirExameDoCatalogo(T.ctx, painel, deps)).toMatchObject({ nome: limpo('Lipidograma'), componentes: [limpo('HDL'), 'LDL'] });
  });

  it.each(INVALIDOS)('modelo de solicitação: nome, exames e orientações com %s', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const id = await semErroDoBanco(errosDoBanco, () =>
      salvarModeloSolicitacao(T.ctx, null, { nome: sujo('Rotina', ch), exames: [{ nome: sujo('Ferritina', ch) }], orientacoes: sujo('Jejum de 8 h\r\n', ch) }, deps),
    );
    expect(await abrirModeloSolicitacao(T.ctx, id, deps)).toMatchObject({ nome: limpo('Rotina'), exames: [{ nome: limpo('Ferritina') }], orientacoes: limpo('Jejum de 8 h\n') });
  });

  it.each(INVALIDOS)('nota de interpretação com %s', async (_nome, ch) => {
    const { T, p, exameId } = await exameDeTeste();
    await semErroDoBanco(errosDoBanco, () => salvarNota(T.ctx, p.id, exameId, sujo('Investigar ingestão de ferro', ch), deps));
    const [n] = await withTenant(T.ctx, (tx) => tx.select({ texto: examInterpretacoes.texto }).from(examInterpretacoes).where(eq(examInterpretacoes.examId, exameId)), app.db);
    expect(n.texto).toBe(limpo('Investigar ingestão de ferro'));
  });

  it.each(INVALIDOS)('edição do exame: título, justificativa e uma linha nova (nome, unidade, referência) com %s vão limpos', async (_nome, ch) => {
    const { T, p, exameId } = await exameDeTeste();
    const aberto = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
    const linhas: LinhaEditada[] = aberto.valores.map((v, i) => ({ origem: i, nome: v.nome, valor: numeroParaCampo(v.valor), unidade: v.unidade ?? '', referencia: v.referencia ?? '', refMin: '', refMax: '' }));
    linhas.push(linhaSuja(ch));
    const base = { data: '2026-09-01', linhas, lidoEm: aberto.updatedAt };
    // curta demais depois da limpeza: a mensagem de tamanho continua valendo, sem erro do banco
    errosDoBanco.length = 0;
    const recusa = await editarExame(T.ctx, FUSO, p.id, exameId, { ...base, titulo: 'Rotina 2026', justificativa: `ab${ch}c${ch} ` }, deps).catch((e: unknown) => e);
    expect(errosDoBanco).toEqual([]);
    expect(recusa instanceof ExameError && recusa.erros).toEqual({ justificativa: MSG_EXAMES.lancamentoErros.justificativa });
    await semErroDoBanco(errosDoBanco, () => editarExame(T.ctx, FUSO, p.id, exameId, { ...base, titulo: sujo('Rotina', ch), justificativa: sujo('Título padronizado', ch) }, deps));
    const [e] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo, valores: exams.valores }).from(exams).where(eq(exams.id, exameId)), app.db);
    expect(e.titulo).toBe(limpo('Rotina'));
    expect(e.valores[1]).toEqual(LINHA_LIMPA);
    const [v] = await withTenant(T.ctx, (tx) => tx.select({ justificativa: examVersoes.justificativa }).from(examVersoes).where(eq(examVersoes.examId, exameId)), app.db);
    expect(v.justificativa).toBe(limpo('Título padronizado'));
  });

  it.each(INVALIDOS)('criação do exame: título e linha (nome, unidade, referência) com %s vão limpos', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const exameId = await semErroDoBanco(errosDoBanco, () =>
      criarExame(T.ctx, T.tenant, p.id, { titulo: sujo('Rotina', ch), data: '2026-09-01', valores: [linhaSuja(ch)], arquivo: null }, { db: app.db, now: new Date('2026-09-02T12:00:00Z') }),
    );
    const [e] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo, valores: exams.valores }).from(exams).where(eq(exams.id, exameId)), app.db);
    expect(e).toEqual({ titulo: limpo('Rotina'), valores: [LINHA_LIMPA] });
    // a conferência da IA lê as linhas pelo mesmo `lerValores`
    expect(lerValores([linhaSuja(ch)])).toEqual([LINHA_LIMPA]);
  });

  it('criação do exame: o corte do título em 120 não deixa meio emoji (surrogate sem par) no fim', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const exameId = await semErroDoBanco(errosDoBanco, () =>
      criarExame(T.ctx, T.tenant, p.id, { titulo: `${'x'.repeat(119)}🙂`, data: '2026-09-01', valores: [], arquivo: null }, { db: app.db, now: new Date('2026-09-02T12:00:00Z') }),
    );
    const [e] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo }).from(exams).where(eq(exams.id, exameId)), app.db);
    expect(e.titulo).toBe('x'.repeat(119));
    // SUS-110: com um espaço antes do emoji cortado, o espaço também sai
    const outro = await semErroDoBanco(errosDoBanco, () =>
      criarExame(T.ctx, T.tenant, p.id, { titulo: `${'x'.repeat(118)} 🙂`, data: '2026-09-01', valores: [], arquivo: null }, { db: app.db, now: new Date('2026-09-02T12:00:00Z') }),
    );
    const [e2] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo }).from(exams).where(eq(exams.id, outro)), app.db);
    expect(e2.titulo).toBe('x'.repeat(118));
  });
});
