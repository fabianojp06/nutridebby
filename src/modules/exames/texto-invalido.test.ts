import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco } from '../../../test/erros-do-banco';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { examInterpretacoes, exams } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { numeroParaCampo } from '@/lib/numero';
import { criarExame, ExameError } from '@/modules/pacientes/exames';
import { abrirExameDoCatalogo, salvarExameDoCatalogo } from './catalogo';
import { MSG_EXAMES } from './constantes';
import { editarExame, exameParaEditar, type LinhaEditada } from './edicao';
import { salvarNota } from './interpretacao';
import { abrirModeloSolicitacao, salvarModeloSolicitacao } from './modelos-solicitacao';

/**
 * SUS-109 (regra 3): o NUL e o surrogate UTF-16 sem par digitados nos exames (catálogo, modelos de solicitação, nota de
 * interpretação, edição) não chegam ao banco — o Postgres recusaria (22P05/22P02 no jsonb, 22021 no text) com um trecho
 * do texto no log e no erro do app. O espião anota o SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(() => app.pool.end());
const deps = { db: app.db };
const FUSO = { fuso: 'America/Sao_Paulo' };

const INVALIDOS = [
  ['NUL', '\u0000'],
  ['surrogate alto sem par', '\ud800'],
  ['surrogate baixo sem par', '\udc00'],
] as const;
/** "Ferritina<c> baixa 🙂" → "Ferritina baixa 🙂". */
const sujo = (t: string, c: string) => `${t}${c} baixa 🙂`;
const limpo = (t: string) => `${t} baixa 🙂`;

async function semErroDoBanco<T>(f: () => Promise<T>): Promise<T> {
  errosDoBanco.length = 0;
  const r = await f().then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  expect(errosDoBanco).toEqual([]);
  if (!r.ok) throw r.e;
  return r.v;
}

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
    const id = await semErroDoBanco(() =>
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
    const painel = await semErroDoBanco(() => salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: sujo('Lipidograma', ch), componentes: `${sujo('HDL', ch)}\nLDL${ch}` }, deps));
    expect(await abrirExameDoCatalogo(T.ctx, painel, deps)).toMatchObject({ nome: limpo('Lipidograma'), componentes: [limpo('HDL'), 'LDL'] });
  });

  it.each(INVALIDOS)('modelo de solicitação: nome, exames e orientações com %s', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const id = await semErroDoBanco(() =>
      salvarModeloSolicitacao(T.ctx, null, { nome: sujo('Rotina', ch), exames: [{ nome: sujo('Ferritina', ch) }], orientacoes: sujo('Jejum de 8 h\r\n', ch) }, deps),
    );
    expect(await abrirModeloSolicitacao(T.ctx, id, deps)).toMatchObject({ nome: limpo('Rotina'), exames: [{ nome: limpo('Ferritina') }], orientacoes: limpo('Jejum de 8 h\n') });
  });

  it.each(INVALIDOS)('nota de interpretação com %s', async (_nome, ch) => {
    const { T, p, exameId } = await exameDeTeste();
    await semErroDoBanco(() => salvarNota(T.ctx, p.id, exameId, sujo('Investigar ingestão de ferro', ch), deps));
    const [n] = await withTenant(T.ctx, (tx) => tx.select({ texto: examInterpretacoes.texto }).from(examInterpretacoes).where(eq(examInterpretacoes.examId, exameId)), app.db);
    expect(n.texto).toBe(limpo('Investigar ingestão de ferro'));
  });

  it.each(INVALIDOS)('edição do exame: o título vai limpo; a justificativa com %s é recusada pela mensagem, sem erro do banco', async (_nome, ch) => {
    const { T, p, exameId } = await exameDeTeste();
    const aberto = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
    const linhas: LinhaEditada[] = aberto.valores.map((v, i) => ({ origem: i, nome: v.nome, valor: numeroParaCampo(v.valor), unidade: v.unidade ?? '', referencia: v.referencia ?? '', refMin: '', refMax: '' }));
    const base = { data: '2026-09-01', linhas, lidoEm: aberto.updatedAt };
    errosDoBanco.length = 0;
    const recusa = await editarExame(T.ctx, FUSO, p.id, exameId, { ...base, titulo: 'Rotina 2026', justificativa: sujo('Título padronizado', ch) }, deps).catch((e: unknown) => e);
    expect(errosDoBanco).toEqual([]);
    expect(recusa instanceof ExameError && recusa.erros).toEqual({ justificativa: MSG_EXAMES.lancamentoErros.justificativa });
    await semErroDoBanco(() => editarExame(T.ctx, FUSO, p.id, exameId, { ...base, titulo: sujo('Rotina', ch), justificativa: 'Título padronizado 🙂' }, deps));
    const [e] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo }).from(exams).where(eq(exams.id, exameId)), app.db);
    expect(e.titulo).toBe(limpo('Rotina'));
  });
});
