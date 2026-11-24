import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco } from '../../../test/erros-do-banco';
import { envioRecebido } from '../../../test/exames-enviados';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { anamneses, anamnesisTemplates, consultationNotes, consultations, examSubmissions, exams, patientCadastro, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { preencherAnamnese, salvarModelo } from './anamnese';
import { registrarAtendimento } from './atendimentos';
import { MSG_CADASTRO } from './cadastro-textos';
import { aceitarEnvio, recusarEnvio } from './exames-enviados';
import { criarPaciente, PacienteError } from './pacientes';

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par digitados nos campos de dado de saúde do prontuário (evolução,
 * anamnese, cadastro, nome do paciente, título e motivo da revisão do exame enviado) não chegam ao banco — o Postgres
 * recusaria (22021 no text, 22P05/22P02 no jsonb) com um trecho do texto no log e no erro do app. O espião anota o SQLSTATE
 * de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-texto-invalido-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const now = new Date('2026-11-17T15:00:00Z');

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

const ana = (extra: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza',
  dataNascimento: '1991-03-10',
  sexo: 'F',
  email: `ana-${randomUUID().slice(0, 8)}@ex.com`,
  telefone: '(11) 91234-5678',
  whatsappAutorizado: false,
  ...extra,
});

describe('SUS-110: texto com NUL ou surrogate sem par no prontuário', () => {
  it.each(INVALIDOS)('atendimento: notas privadas (evolução) e orientações com %s vão limpas', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await semErroDoBanco(() =>
      registrarAtendimento(T.ctx, SP, p.id, { data: '2026-11-17', notasPrivadas: sujo('Refere cansaço\r\n', ch), orientacoes: sujo('Beber água', ch) }, { db: app.db, now }),
    );
    const [c] = await withTenant(T.ctx, (tx) => tx.select({ o: consultations.orientacoesPaciente }).from(consultations).where(eq(consultations.id, id)), app.db);
    const [n] = await withTenant(T.ctx, (tx) => tx.select({ t: consultationNotes.texto }).from(consultationNotes).where(eq(consultationNotes.consultationId, id)), app.db);
    expect({ orientacoes: c.o, notas: n.t }).toEqual({ orientacoes: limpo('Beber água'), notas: limpo('Refere cansaço\n') });
  });

  it.each(INVALIDOS)('anamnese: nome, pergunta, unidade e opções do modelo, e as respostas (texto e lista) com %s', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const modeloId = await semErroDoBanco(() =>
      salvarModelo(
        T.ctx,
        null,
        {
          nome: sujo('Anamnese', ch),
          perguntas: [
            { tipo: 'texto_longo', rotulo: sujo('Queixa', ch), obrigatoria: true },
            { tipo: 'numero', rotulo: 'Peso habitual', obrigatoria: false, unidade: `kg${ch}` },
            { tipo: 'multipla_escolha', rotulo: 'Sintomas', obrigatoria: false, opcoes: [sujo('Azia', ch), 'Refluxo'] },
          ],
        },
        app.db,
      ),
    );
    const [m] = await withTenant(T.ctx, (tx) => tx.select().from(anamnesisTemplates).where(eq(anamnesisTemplates.id, modeloId)), app.db);
    const [queixa, peso, sintomas] = m.schema.perguntas;
    expect(m.nome).toBe(limpo('Anamnese'));
    expect([queixa.rotulo, peso.unidade, sintomas.opcoes]).toEqual([limpo('Queixa'), 'kg', [limpo('Azia'), 'Refluxo']]);
    const id = await semErroDoBanco(() =>
      preencherAnamnese(T.ctx, SP, p.id, modeloId, { [queixa.id]: sujo('Dor no estômago\r\n', ch), [peso.id]: '70', [sintomas.id]: [sujo('Azia', ch)] }, { db: app.db, now }),
    );
    const [a] = await withTenant(T.ctx, (tx) => tx.select({ r: anamneses.respostas }).from(anamneses).where(eq(anamneses.id, id)), app.db);
    expect(a.r).toEqual({ [queixa.id]: limpo('Dor no estômago\n'), [peso.id]: 70, [sintomas.id]: [limpo('Azia')] });
  });

  it('anamnese: o corte do nome (80), da pergunta (200) e da unidade (20) não deixa meio emoji no jsonb', async () => {
    const T = await novoTenant(app.db);
    const id = await semErroDoBanco(() =>
      salvarModelo(T.ctx, null, { nome: `${'x'.repeat(79)}🙂`, perguntas: [{ tipo: 'numero', rotulo: `${'y'.repeat(199)}🙂`, obrigatoria: false, unidade: `${'z'.repeat(19)}🙂` }] }, app.db),
    );
    const [m] = await withTenant(T.ctx, (tx) => tx.select().from(anamnesisTemplates).where(eq(anamnesisTemplates.id, id)), app.db);
    expect([m.nome, m.schema.perguntas[0].rotulo, m.schema.perguntas[0].unidade]).toEqual(['x'.repeat(79), 'y'.repeat(199), 'z'.repeat(19)]);
  });

  it.each(INVALIDOS)('paciente e cadastro: nome, nome social, ocupação, endereço e observação com %s vão limpos', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const p = await semErroDoBanco(() =>
      criarPaciente(
        T.ctx,
        T.tenant,
        ana({ nome: sujo('Ana', ch), nomeSocial: sujo('Ana', ch), ocupacao: sujo('Professora', ch), logradouro: sujo('Rua A', ch), observacao: sujo('Prefere manhã\r\n', ch) }),
        { db: app.db, now, appUrl: 'http://localhost:3104' },
      ),
    );
    const [linha] = await withTenant(T.ctx, (tx) => tx.select({ nome: patients.nome }).from(patients).where(eq(patients.id, p.id)), app.db);
    expect(linha.nome).toBe(limpo('Ana'));
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(patientCadastro).where(eq(patientCadastro.patientId, p.id)), app.db);
    expect(c).toMatchObject({ nomeSocial: limpo('Ana'), ocupacao: limpo('Professora'), logradouro: limpo('Rua A'), observacao: limpo('Prefere manhã\n') });
  });

  it('cadastro: nos campos de formato (CPF, CEP, telefone fixo, listas) o NUL continua recusado com a mensagem do campo', async () => {
    const T = await novoTenant(app.db);
    errosDoBanco.length = 0;
    const e = await criarPaciente(T.ctx, T.tenant, ana({ cpf: '529.982.247-25\u0000', cep: '13015\u0000-904', estadoCivil: 'casado\u0000' }), { db: app.db, now, appUrl: 'http://localhost:3104' }).catch(
      (x: unknown) => x,
    );
    expect(errosDoBanco).toEqual([]);
    expect(e instanceof PacienteError && e.erros).toMatchObject({ cpf: MSG_CADASTRO.cpfInvalido, cep: MSG_CADASTRO.cepInvalido, estadoCivil: MSG_CADASTRO.escolhaDaLista });
  });

  it.each(INVALIDOS)('exame enviado pelo paciente: título do aceite e motivo "outro" da recusa com %s vão limpos', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const deps = { db: app.db, dataDir };
    const a = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    const { examId } = await semErroDoBanco(() => aceitarEnvio(T.ctx, SP, a.id, { titulo: sujo('Hemograma', ch), data: '2026-09-28' }, deps));
    const [e] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo }).from(exams).where(eq(exams.id, examId)), app.db);
    expect(e.titulo).toBe(limpo('Hemograma'));
    const r = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await semErroDoBanco(() => recusarEnvio(T.ctx, r.id, { motivo: 'outro', texto: sujo('Foto cortada', ch) }, deps));
    const [s] = await withTenant(T.ctx, (tx) => tx.select({ t: examSubmissions.motivoRecusaTexto }).from(examSubmissions).where(eq(examSubmissions.id, r.id)), app.db);
    expect(s.t).toBe(limpo('Foto cortada'));
  });

  it('exame enviado: o corte do título em 120 não deixa meio emoji no fim', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const a = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    const { examId } = await semErroDoBanco(() => aceitarEnvio(T.ctx, SP, a.id, { titulo: `${'x'.repeat(119)}🙂`, data: '2026-09-28' }, { db: app.db, dataDir }));
    const [e] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo }).from(exams).where(eq(exams.id, examId)), app.db);
    expect(e.titulo).toBe('x'.repeat(119));
  });
});
