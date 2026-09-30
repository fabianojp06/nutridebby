import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { anamneses, auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import {
  AnamneseError,
  arquivarModelo,
  atualizarAnamnese,
  buscarAnamnese,
  buscarModelo,
  listarAnamneses,
  listarModelos,
  preencherAnamnese,
  salvarModelo,
} from './anamnese';
import { NOME_MODELO_PADRAO } from './anamnese-padrao';
import { PacienteNaoEncontradoError } from './base';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
afterAll(() => app.pool.end());

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AnamneseError) return e.erros;
    throw e;
  }
  throw new Error('esperava AnamneseError');
};

describe('modelos de anamnese (US-012)', () => {
  it('"Modelo padrão": a conta nova já tem "Anamnese geral" com as seções da spec — uma vez só, mesmo com chamadas simultâneas', async () => {
    const T = await novoTenant(app.db);
    const listas = await Promise.all([listarModelos(T.ctx, app.db), listarModelos(T.ctx, app.db), listarModelos(T.ctx, app.db)]);
    for (const l of listas) expect(l.map((m) => m.nome)).toEqual([NOME_MODELO_PADRAO]);
    const [resumo] = listas[0];
    const modelo = await buscarModelo(T.ctx, resumo.id, app.db);
    expect(modelo?.schema.perguntas.map((p) => p.rotulo)).toEqual([
      // texto exato da spec (US-012 "Modelo padrão"; CLAUDE.md regra 4), só com a inicial maiúscula
      'Queixa principal', 'Histórico clínico', 'Medicamentos', 'Alergias/intolerâncias', 'Hábitos intestinais',
      'Sono', 'Atividade física', 'Consumo de água', 'Álcool/tabaco', 'Preferências e aversões',
    ]);
  });

  it('cria, edita e arquiva; o padrão arquivado não volta; modelo inválido devolve os erros', async () => {
    const T = await novoTenant(app.db);
    const [padrao] = await listarModelos(T.ctx, app.db);
    const id = await salvarModelo(T.ctx, null, { nome: 'Retorno', perguntas: [{ tipo: 'texto_curto', rotulo: 'Como foi a semana?', obrigatoria: false }] }, app.db);
    await salvarModelo(T.ctx, id, { nome: 'Retorno mensal', perguntas: [{ tipo: 'texto_curto', rotulo: 'Como foi o mês?', obrigatoria: true }] }, app.db);
    expect((await buscarModelo(T.ctx, id, app.db))?.nome).toBe('Retorno mensal');
    await arquivarModelo(T.ctx, padrao.id, app.db);
    expect((await listarModelos(T.ctx, app.db)).map((m) => m.nome)).toEqual(['Retorno mensal']);
    expect(await erros(salvarModelo(T.ctx, null, { nome: '', perguntas: [] }, app.db))).toEqual({ nome: 'Informe o nome do modelo', perguntas: 'Inclua pelo menos uma pergunta' });
  });
});

describe('preencher anamnese', () => {
  async function comModelo(perguntas: unknown[]) {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const modeloId = await salvarModelo(T.ctx, null, { nome: 'Consulta', perguntas }, app.db);
    const modelo = (await buscarModelo(T.ctx, modeloId, app.db))!;
    return { T, p, modeloId, perguntas: modelo.schema.perguntas };
  }

  it('"Obrigatória não preenchida": "Responda: Alergias" e nada é salvo', async () => {
    const { T, p, modeloId, perguntas } = await comModelo([{ tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: true }]);
    expect(await erros(preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, {}, { db: app.db, now }))).toEqual({ [perguntas[0].id]: 'Responda: Alergias' });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(anamneses).where(eq(anamneses.patientId, p.id)), app.db)).toEqual([]);
  });

  it('editar e esvaziar uma obrigatória: "Responda: Alergias" e a resposta gravada continua a mesma', async () => {
    const { T, p, modeloId, perguntas } = await comModelo([{ tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: true }]);
    const id = await preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, { [perguntas[0].id]: 'Lactose' }, { db: app.db, now });
    expect(await erros(atualizarAnamnese(T.ctx, p.id, id, { [perguntas[0].id]: '  ' }, app.db))).toEqual({ [perguntas[0].id]: 'Responda: Alergias' });
    expect((await buscarAnamnese(T.ctx, p.id, id, app.db))?.respostas).toEqual({ [perguntas[0].id]: 'Lactose' });
  });

  it('"Snapshot do modelo": alterar ou excluir pergunta depois não muda a anamnese já preenchida', async () => {
    const { T, p, modeloId, perguntas } = await comModelo([
      { tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: false },
      { tipo: 'numero', rotulo: 'Água', obrigatoria: false, unidade: 'litros por dia' },
    ]);
    const id = await preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, { [perguntas[0].id]: 'Lactose', [perguntas[1].id]: '2,5' }, { db: app.db, now });
    await salvarModelo(T.ctx, modeloId, { nome: 'Consulta v2', perguntas: [{ ...perguntas[0], rotulo: 'Alergias alimentares' }] }, app.db);
    await arquivarModelo(T.ctx, modeloId, app.db);
    const a = await buscarAnamnese(T.ctx, p.id, id, app.db);
    expect(a?.templateSnapshot).toEqual({ nome: 'Consulta', perguntas });
    expect(a?.respostas).toEqual({ [perguntas[0].id]: 'Lactose', [perguntas[1].id]: 2.5 });
    expect(a?.data).toBe('2026-10-01');
    // editar valida contra o snapshot, não contra o modelo atual
    await atualizarAnamnese(T.ctx, p.id, id, { [perguntas[0].id]: 'Glúten', [perguntas[1].id]: '3' }, app.db);
    expect((await buscarAnamnese(T.ctx, p.id, id, app.db))?.respostas).toEqual({ [perguntas[0].id]: 'Glúten', [perguntas[1].id]: 3 });
  });

  it('auditoria: preencher = "criar" e abrir = "ler", com a nutricionista, no histórico do paciente', async () => {
    const { T, p, modeloId } = await comModelo([{ tipo: 'texto_curto', rotulo: 'Queixa', obrigatoria: false }]);
    const id = await preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, {}, { db: app.db, now });
    await buscarAnamnese(T.ctx, p.id, id, app.db);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.entidade, 'anamnese'))), app.db);
    expect(log.map((l) => l.acao).sort()).toEqual(['criar', 'ler']);
    expect((await listarAnamneses(T.ctx, p.id, app.db)).map((a) => a.nomeModelo)).toEqual(['Consulta']);
  });

  it('paciente ou modelo de outro tenant: recusado', async () => {
    const A = await comModelo([{ tipo: 'texto_curto', rotulo: 'Q', obrigatoria: false }]);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(preencherAnamnese(A.T.ctx, A.T.tenant, pB.id, A.modeloId, {}, { db: app.db, now })).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await erros(preencherAnamnese(B.ctx, B.tenant, pB.id, A.modeloId, {}, { db: app.db, now }))).toEqual({ geral: 'Modelo de anamnese não encontrado.' });
    expect(await buscarAnamnese(B.ctx, pB.id, 'abc', app.db)).toBeNull();
  });
});
