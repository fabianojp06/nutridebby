import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { logger } from '@/lib/logger';
import { filtrarEvento } from '@/lib/sentry-filtro';
import { criarExame } from '@/modules/pacientes/exames';
import { salvarExameDoCatalogo } from './catalogo';
import { editarExame, exameParaEditar } from './edicao';
import { salvarNota } from './interpretacao';
import { salvarModeloSolicitacao } from './modelos-solicitacao';

/**
 * Plano 22 (T5b, RNF-370, regra 3): nome de exame, valor, faixa, nota, justificativa e orientações nunca vão a log, ao
 * Sentry nem à mensagem técnica do erro. Força erros nos módulos novos com textos marcadores conhecidos e confere o que o
 * logger recebeu, a mensagem de cada erro e o evento que o `beforeSend` (`filtrarEvento`) deixaria sair.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
});
const deps = { db: app.db };
const FUSO = { fuso: 'America/Sao_Paulo' };
const M = 'MARCADORSAUDE';
const NOME = `Exame ${M} nome`;
const VALOR = '987654321';
const FAIXA = '123456789';
const NOTA = `Nota ${M} texto`;
const JUSTIFICATIVA = `Justificativa ${M}`;
const ORIENTACOES = `Orientação ${M} `;
const PROIBIDOS = [M, VALOR, FAIXA];

/** O erro que a promessa lança (o teste força um erro em cada caso). */
async function erroDe(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('esperava um erro');
}

describe('RNF-370: nada de dado de saúde em log, Sentry ou mensagem de erro (módulos de exames do Plano 22)', () => {
  it('editarExame, salvarNota, salvarExameDoCatalogo e salvarModeloSolicitacao com erro: os marcadores não saem', async () => {
    const espioes = (['info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(logger, n));
    try {
      const T = await novoTenant(app.db);
      const p = await novoPaciente(app.db, T.ctx);
      const exameId = await criarExame(T.ctx, T.tenant, p.id, { titulo: NOME, data: '2026-09-01', valores: [{ nome: NOME, valor: VALOR, unidade: 'mg/dL', refMin: '1', refMax: FAIXA }], arquivo: null }, deps);
      const aberto = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
      const linha = { origem: 0, nome: NOME, valor: VALOR, unidade: 'mg/dL', referencia: '', refMin: '1', refMax: FAIXA };
      await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: NOME, unidade: 'mg/dL' }, deps);

      const erros: Error[] = [
        // editar: valor inválido com o marcador; faixa invertida; sem justificativa; o exame mudou; nada mudou
        await erroDe(editarExame(T.ctx, FUSO, p.id, exameId, { titulo: NOME, data: '2026-09-01', linhas: [{ ...linha, valor: `${M}${VALOR}` }], justificativa: JUSTIFICATIVA, lidoEm: aberto.updatedAt }, deps)),
        await erroDe(editarExame(T.ctx, FUSO, p.id, exameId, { titulo: NOME, data: '2026-09-01', linhas: [{ ...linha, refMin: FAIXA, refMax: '1' }], justificativa: JUSTIFICATIVA, lidoEm: aberto.updatedAt }, deps)),
        await erroDe(editarExame(T.ctx, FUSO, p.id, exameId, { titulo: `${NOME} novo`, data: '2026-09-01', linhas: [linha], justificativa: '', lidoEm: aberto.updatedAt }, deps)),
        await erroDe(editarExame(T.ctx, FUSO, p.id, exameId, { titulo: `${NOME} novo`, data: '2026-09-01', linhas: [linha], justificativa: JUSTIFICATIVA, lidoEm: new Date(0).toISOString() }, deps)),
        await erroDe(editarExame(T.ctx, FUSO, p.id, exameId, { titulo: NOME, data: '2026-09-01', linhas: [linha], justificativa: JUSTIFICATIVA, lidoEm: aberto.updatedAt }, deps)),
        // nota longa demais e nota num exame que não é do paciente
        await erroDe(salvarNota(T.ctx, p.id, exameId, `${NOTA} ${'x'.repeat(2001)}`, deps)),
        await erroDe(salvarNota(T.ctx, (await novoPaciente(app.db, T.ctx)).id, exameId, NOTA, deps)),
        // catálogo: nome repetido (a mensagem do campo cita o nome; a mensagem técnica, não) e faixa sem fonte
        await erroDe(salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: NOME, unidade: 'mg/dL' }, deps)),
        await erroDe(salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: `${NOME} 2`, unidade: 'mg/dL', faixas: [{ sexo: 'todos', idadeMin: '', idadeMax: '', aPartirDe: '', abaixoDe: FAIXA, categoria: 'Baixo', fonte: '' }], modeloNotaAbaixo: NOTA }, deps)),
        // modelo de solicitação: exame repetido, orientações longas demais
        await erroDe(salvarModeloSolicitacao(T.ctx, null, { nome: `Modelo ${M}`, exames: [{ nome: NOME }, { nome: NOME }], orientacoes: ORIENTACOES }, deps)),
        await erroDe(salvarModeloSolicitacao(T.ctx, null, { nome: `Modelo ${M}`, exames: [{ nome: NOME }], orientacoes: ORIENTACOES.repeat(100) }, deps)),
      ];
      expect(erros).toHaveLength(11);
      for (const e of erros) {
        // a mensagem técnica (e a pilha, que a repete) é fixa; o texto de cada campo fica só em `erros`, para a tela
        for (const t of PROIBIDOS) {
          expect(e.message, `${e.name}: ${e.message}`).not.toContain(t);
          expect(String(e.stack), e.name).not.toContain(t);
        }
        const evento = filtrarEvento({
          message: e.message,
          exception: { values: [{ type: e.name, value: `${e.message} ${JSON.stringify((e as { erros?: unknown }).erros ?? {})}` }] },
          extra: { erros: (e as { erros?: unknown }).erros, nota: NOTA, justificativa: JUSTIFICATIVA },
          // `motivo` com cara de código passa no filtro de propósito (é o código que escolhe o valor); o texto de saúde, não
          tags: { motivo: NOME, rota: NOME },
          breadcrumbs: [{ message: `${NOME} ${VALOR}`, data: { faixa: FAIXA, orientacoes: ORIENTACOES } }],
        });
        for (const t of PROIBIDOS) expect(JSON.stringify(evento), `beforeSend com ${e.name}`).not.toContain(t);
      }
      // controle positivo: o marcador está nos erros dos campos (o teste não passa por não haver marcador nenhum)
      expect(JSON.stringify(erros.map((e) => (e as { erros?: unknown }).erros))).toContain(M);

      const logs = JSON.stringify(espioes.map((s) => s.mock.calls));
      for (const t of [...PROIBIDOS, 'Orientação', 'Justificativa']) expect(logs).not.toContain(t);
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });
});
