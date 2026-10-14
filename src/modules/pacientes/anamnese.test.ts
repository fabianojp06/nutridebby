import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { geracaoNoBanco } from '../../../test/ia';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { anamneses, anamnesisTemplates, auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import {
  AnamneseError,
  aprovarModeloAnamnese,
  arquivarModelo,
  atualizarAnamnese,
  buscarAnamnese,
  buscarModelo,
  buscarModeloUsavel,
  listarAnamneses,
  perguntasDaAnamnese,
  listarModelos,
  listarModelosUsaveis,
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

  it('salvar uma edição não soma "Visualizou" falso: as perguntas do formulário vêm sem auditoria de leitura', async () => {
    const { T, p, modeloId } = await comModelo([{ tipo: 'texto_curto', rotulo: 'Queixa', obrigatoria: false }]);
    const id = await preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, {}, { db: app.db, now });
    const perguntas = await perguntasDaAnamnese(T.ctx, p.id, id, app.db);
    expect(perguntas?.map((q) => q.rotulo)).toEqual(['Queixa']);
    expect(await perguntasDaAnamnese(T.ctx, p.id, '00000000-0000-4000-8000-000000000000', app.db)).toBeNull();
    const leituras = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'ler'))), app.db);
    expect(leituras).toEqual([]);
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

describe('modelos de anamnese sugeridos pela IA (US-123, RN-125)', () => {
  async function modeloSugerido(T: TenantDeTeste) {
    const g = await geracaoNoBanco(app.db, T.ctx, { status: 'pronta', itensDescartados: 2 });
    const [m] = await withTenant(
      { tenantId: T.tenantId, role: 'worker' },
      (tx) =>
        tx
          .insert(anamnesisTemplates)
          .values({ tenantId: T.tenantId, nome: 'Diabetes: Anamnese sugerida', schema: { perguntas: [{ id: randomUUID(), tipo: 'texto_curto', rotulo: 'Glicemia', obrigatoria: false }] }, iaGeracaoId: g })
          .returning({ id: anamnesisTemplates.id }),
      app.db,
    );
    return m.id;
  }

  it('não aprovado: listado com a marca, fora das escolhas, buscarModeloUsavel nulo e preencherAnamnese recusa', async () => {
    const T = await novoTenant(app.db);
    const id = await modeloSugerido(T);
    const p = await novoPaciente(app.db, T.ctx);
    expect((await listarModelos(T.ctx, app.db)).find((m) => m.id === id)).toMatchObject({ sugestaoIa: true, aprovadoEm: null });
    expect((await listarModelosUsaveis(T.ctx, app.db)).map((m) => m.id)).not.toContain(id);
    expect(await buscarModeloUsavel(T.ctx, id, app.db)).toBeNull();
    expect(await buscarModelo(T.ctx, id, app.db)).not.toBeNull(); // a página de edição do modelo continua abrindo
    expect(await erros(preencherAnamnese(T.ctx, T.tenant, p.id, id, {}, { db: app.db, now }))).toEqual({ geral: 'Aprove o modelo antes de usá-lo com pacientes.' });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(anamneses).where(eq(anamneses.patientId, p.id)), app.db)).toEqual([]);
  });

  it('aprovar grava quem e quando (idempotente); depois é usável e preenche; o "Anamnese geral" segue padrão e usável', async () => {
    const T = await novoTenant(app.db);
    const id = await modeloSugerido(T);
    await aprovarModeloAnamnese(T.ctx, id, { db: app.db, agora: new Date('2026-10-10T13:00:00Z') });
    const ler = async () => (await withTenant(T.ctx, (tx) => tx.select().from(anamnesisTemplates).where(eq(anamnesisTemplates.id, id)), app.db))[0];
    expect(await ler()).toMatchObject({ aprovadoPor: T.nutriId, aprovadoEm: new Date('2026-10-10T13:00:00Z') });
    await aprovarModeloAnamnese(T.ctx, id, { db: app.db });
    expect(await ler()).toMatchObject({ aprovadoPor: T.nutriId, aprovadoEm: new Date('2026-10-10T13:00:00Z') });
    expect((await listarModelos(T.ctx, app.db)).find((m) => m.id === id)).toMatchObject({ sugestaoIa: false, aprovadoEm: '2026-10-10T13:00:00.000Z' });
    const usaveis = await listarModelosUsaveis(T.ctx, app.db);
    expect(usaveis.map((m) => m.id)).toContain(id);
    expect(usaveis.find((m) => m.padrao)).toMatchObject({ nome: NOME_MODELO_PADRAO, sugestaoIa: false, aprovadoEm: null });
    expect(await buscarModeloUsavel(T.ctx, id, app.db)).toMatchObject({ id });
    const p = await novoPaciente(app.db, T.ctx);
    expect(await preencherAnamnese(T.ctx, T.tenant, p.id, id, {}, { db: app.db, now })).toEqual(expect.any(String));
  });

  it('aprovar: modelo à mão, arquivado, de outro tenant, id inválido ou sessão sem usuária → não encontrado', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const sugerido = await modeloSugerido(A);
    const aMao = await salvarModelo(A.ctx, null, { nome: 'À mão', perguntas: [{ tipo: 'texto_curto', rotulo: 'Q', obrigatoria: false }] }, app.db);
    const arquivado = await modeloSugerido(A);
    await arquivarModelo(A.ctx, arquivado, app.db);
    const naoEncontrado = { geral: 'Modelo de anamnese não encontrado.' };
    for (const id of ['abc', aMao, arquivado]) expect(await erros(aprovarModeloAnamnese(A.ctx, id, { db: app.db }))).toEqual(naoEncontrado);
    expect(await erros(aprovarModeloAnamnese(B.ctx, sugerido, { db: app.db }))).toEqual(naoEncontrado);
    expect(await erros(aprovarModeloAnamnese({ tenantId: A.tenantId, role: 'nutri' }, sugerido, { db: app.db }))).toEqual(naoEncontrado);
    expect(await buscarModeloUsavel(A.ctx, sugerido, app.db)).toBeNull();
    expect(await buscarModeloUsavel(A.ctx, aMao, app.db)).toMatchObject({ id: aMao });
    expect(await buscarModeloUsavel(A.ctx, 'abc', app.db)).toBeNull();
  });
});
