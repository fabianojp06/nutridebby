import { afterAll, describe, expect, it, vi } from 'vitest';
import { novoTenant } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { listarModelosSolicitacao } from '@/modules/exames/modelos-solicitacao';

// Plano 22 (T3, US-376): as actions dos modelos de solicitação pelo caminho real (módulo → Postgres do Testcontainers).
const sessao = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: async () => sessao.atual }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { excluirModeloSolicitacaoAction, salvarModeloSolicitacaoAction } = await import('./actions');
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
const destino = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const M = MSG_EXAMES.modelosSolicitacao.erros;

describe('actions dos modelos de solicitação (US-376)', () => {
  it('erro devolve as mensagens e os valores (a lista em JSON); sucesso volta à lista com "Modelo salvo."; excluir', async () => {
    const T = await novoTenant(db);
    sessao.atual = { ctx: T.ctx, tenant: T.tenant };
    const f = new FormData();
    f.set('nome', 'Check-up anual');
    f.set('exames', '[{"nome":"Glicose"},{"nome":"glicose"}]');
    f.set('orientacoes', 'Jejum de 8 horas.');
    f.set('indicacaoClinica', 'não existe no modelo');
    const s = await salvarModeloSolicitacaoAction(null, {}, f);
    expect(s.erros).toEqual({ 'exames.1.nome': M.exameRepetido });
    expect(s.valores).toEqual({ nome: 'Check-up anual', exames: '[{"nome":"Glicose"},{"nome":"glicose"}]', orientacoes: 'Jejum de 8 horas.' });
    f.set('exames', 'não é JSON');
    expect((await salvarModeloSolicitacaoAction(null, {}, f)).erros).toEqual({ exames: M.semExames });
    f.set('exames', '[{"nome":"Hemograma completo","painel":true},{"nome":"Ferritina"}]');
    expect(await destino(salvarModeloSolicitacaoAction(null, {}, f))).toMatch(/^redirect \/painel\/exames\/modelos\?ok=salvo&r=[0-9a-f]{8}$/);
    const [m] = await listarModelosSolicitacao(T.ctx, { db });
    expect(m).toMatchObject({ nome: 'Check-up anual', exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'Ferritina' }], orientacoes: 'Jejum de 8 horas.' });
    expect(await destino(excluirModeloSolicitacaoAction(m.id))).toMatch(/^redirect \/painel\/exames\/modelos\?ok=excluido&r=/);
    expect(await listarModelosSolicitacao(T.ctx, { db })).toEqual([]);
  });
});
