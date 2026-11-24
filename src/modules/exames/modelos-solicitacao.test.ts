import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { salvarExameDoCatalogo } from './catalogo';
import { MSG_EXAMES, PAINEIS_PARA_COMECAR } from './constantes';
import {
  abrirModeloSolicitacao,
  bibliotecasParaExames,
  exameDosModelos,
  excluirModeloSolicitacao,
  listarModelosSolicitacao,
  ModeloSolicitacaoError,
  salvarModeloSolicitacao,
} from './modelos-solicitacao';

/** Plano 22 (T3, US-376, RN-391): modelos de solicitação do consultório pelo módulo, no Postgres do Testcontainers. */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const M = MSG_EXAMES.modelosSolicitacao.erros;
const FUSO = { fuso: 'America/Sao_Paulo' };

const erros = async (p: Promise<unknown>): Promise<Record<string, string>> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ModeloSolicitacaoError) return e.erros;
    throw e;
  }
  throw new Error('esperava ModeloSolicitacaoError');
};
const lista = (n: number) => Array.from({ length: n }, (_, i) => ({ nome: `Exame ${i + 1}` }));

describe('modelos de solicitação (US-376)', () => {
  it('cria "Check-up anual" com exames do catálogo e livres, sem indicação clínica; outro consultório não vê', async () => {
    const T = await novoTenant(app.db);
    await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Hemograma completo', componentes: PAINEIS_PARA_COMECAR[0].componentes }, deps);
    const id = await salvarModeloSolicitacao(
      T.ctx,
      null,
      { nome: ' Check-up anual ', exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'Ferritina' }], orientacoes: 'Jejum de **8 horas**.', indicacaoClinica: 'não entra' },
      deps,
    );
    const m = await abrirModeloSolicitacao(T.ctx, id, deps);
    expect(m).toMatchObject({ id, nome: 'Check-up anual', exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'Ferritina' }], orientacoes: 'Jejum de **8 horas**.' });
    expect(m).not.toHaveProperty('indicacaoClinica');
    expect((await listarModelosSolicitacao(T.ctx, deps)).map((x) => x.nome)).toEqual(['Check-up anual']);
    const B = await novoTenant(app.db);
    expect(await listarModelosSolicitacao(B.ctx, deps)).toEqual([]);
    expect(await abrirModeloSolicitacao(B.ctx, id, deps)).toBeNull();
    expect(await exameDosModelos(B.ctx, id, deps)).toBeNull();
    expect(await excluirModeloSolicitacao(B.ctx, id, deps)).toBe(false);
    expect(await erros(salvarModeloSolicitacao(B.ctx, id, { nome: 'X', exames: lista(1) }, deps))).toEqual({ geral: M.naoEncontrado });
  });

  it('limites e repetição: 41 exames, exame repetido (normalizado), sem exames, nome vazio, nome repetido sem diferença de maiúsculas, orientações longas', async () => {
    const T = await novoTenant(app.db);
    expect(await erros(salvarModeloSolicitacao(T.ctx, null, { nome: 'Grande', exames: lista(41) }, deps))).toEqual({ exames: M.max });
    expect(await erros(salvarModeloSolicitacao(T.ctx, null, { nome: 'Rep', exames: [{ nome: 'Glicose' }, { nome: 'GLICOSE' }] }, deps))).toEqual({ 'exames.1.nome': M.exameRepetido });
    expect(await erros(salvarModeloSolicitacao(T.ctx, null, { nome: 'Vazio', exames: [] }, deps))).toEqual({ exames: M.semExames });
    expect(await erros(salvarModeloSolicitacao(T.ctx, null, { nome: '  ', exames: lista(1) }, deps))).toEqual({ nome: M.nome });
    expect(await erros(salvarModeloSolicitacao(T.ctx, null, { nome: 'x'.repeat(81), exames: lista(1) }, deps))).toEqual({ nome: M.nome });
    expect(await erros(salvarModeloSolicitacao(T.ctx, null, { nome: 'Longo', exames: lista(1), orientacoes: 'a'.repeat(1001) }, deps))).toEqual({ orientacoes: M.orientacoes });
    await salvarModeloSolicitacao(T.ctx, null, { nome: 'Check-up anual', exames: lista(40) }, deps);
    expect(await erros(salvarModeloSolicitacao(T.ctx, null, { nome: 'CHECK-UP ANUAL', exames: lista(1) }, deps))).toEqual({ nome: M.repetido });
    expect(await listarModelosSolicitacao(T.ctx, deps)).toHaveLength(1);
  });

  it('editar e excluir', async () => {
    const T = await novoTenant(app.db);
    const id = await salvarModeloSolicitacao(T.ctx, null, { nome: 'Ferro', exames: [{ nome: 'Ferritina' }] }, deps);
    await expect(salvarModeloSolicitacao(T.ctx, id, { nome: 'Ferro', exames: [{ nome: 'Ferritina' }, { nome: 'Ferro sérico' }], orientacoes: '' }, deps)).resolves.toBe(id);
    expect((await abrirModeloSolicitacao(T.ctx, id, deps))?.exames).toEqual([{ nome: 'Ferritina' }, { nome: 'Ferro sérico' }]);
    expect(await excluirModeloSolicitacao(T.ctx, id, deps)).toBe(true);
    expect(await excluirModeloSolicitacao(T.ctx, id, deps)).toBe(false);
    expect(await abrirModeloSolicitacao(T.ctx, id, deps)).toBeNull();
  });

  it('exameDosModelos expande o painel nas linhas (com a unidade do catálogo) e mantém o painel nos exames', async () => {
    const T = await novoTenant(app.db);
    await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Hemograma completo', componentes: ['Hemácias', 'Hemoglobina'] }, deps);
    await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Hemoglobina', unidade: 'g/dL' }, deps);
    const id = await salvarModeloSolicitacao(T.ctx, null, { nome: 'Check-up', exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'Ferritina' }], orientacoes: 'Jejum.' }, deps);
    expect(await exameDosModelos(T.ctx, id, deps)).toEqual({
      exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'Ferritina' }],
      linhas: [
        { nome: 'Hemácias', unidade: null },
        { nome: 'Hemoglobina', unidade: 'g/dL' },
        { nome: 'Ferritina', unidade: null },
      ],
      orientacoes: 'Jejum.',
    });
    expect(await exameDosModelos(T.ctx, 'x', deps)).toBeNull();
  });

  it('bibliotecasParaExames devolve os modelos e o catálogo numa transação só', async () => {
    const T = await novoTenant(app.db);
    const cat = await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Ferritina', unidade: 'ng/mL' }, deps);
    const id = await salvarModeloSolicitacao(T.ctx, null, { nome: 'Ferro', exames: [{ nome: 'Ferritina' }] }, deps);
    let transacoes = 0;
    const contando = { ...app.db, transaction: ((fn: never, cfg?: never) => ((transacoes += 1), app.db.transaction(fn, cfg))) as typeof app.db.transaction } as typeof app.db;
    const b = await bibliotecasParaExames(T.ctx, { db: contando });
    expect(transacoes).toBe(1);
    expect(b.catalogo).toEqual([{ id: cat, nome: 'Ferritina', unidade: 'ng/mL', sinonimos: [], componentes: [], faixas: [] }]);
    expect(b.modelos).toEqual([{ id, nome: 'Ferro', exames: [{ nome: 'Ferritina' }], orientacoes: '' }]);
  });

  it('funciona com os documentos desligados no consultório (RN-391)', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ documentosLiberados: false }).where(eq(tenants.id, T.tenantId));
    const id = await salvarModeloSolicitacao(T.ctx, null, { nome: 'Ferro', exames: [{ nome: 'Ferritina' }] }, deps);
    expect(await abrirModeloSolicitacao(T.ctx, id, deps)).toMatchObject({ nome: 'Ferro' });
    expect((await bibliotecasParaExames(T.ctx, deps)).modelos).toHaveLength(1);
  });

  it('sessão de paciente: erro do assert antes da transação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const P = ctxPaciente(T.tenantId, p.id);
    const msg = 'exames: só a sessão nutri';
    const UUID = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
    await expect(listarModelosSolicitacao(P, deps)).rejects.toThrow(msg);
    await expect(abrirModeloSolicitacao(P, UUID, deps)).rejects.toThrow(msg);
    await expect(salvarModeloSolicitacao(P, null, { nome: 'X', exames: lista(1) }, deps)).rejects.toThrow(msg);
    await expect(excluirModeloSolicitacao(P, UUID, deps)).rejects.toThrow(msg);
    await expect(exameDosModelos(P, UUID, deps)).rejects.toThrow(msg);
    await expect(bibliotecasParaExames(P, deps)).rejects.toThrow(msg);
  });
});
