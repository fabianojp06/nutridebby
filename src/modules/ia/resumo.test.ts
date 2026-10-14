import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, IA_TESTE, iaPronta, prontuarioCompleto } from '../../../test/ia';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { anthropometry, iaTarefas, iaUso, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { excluirAntropometria } from '@/modules/pacientes/antropometria';
import { listAccessHistory, rotuloDaAcao } from '@/modules/plataforma/audit';
import { MSG_IA, MSG_RESUMO } from './constantes';
import type { DepsJobAssistente } from './modelos-job';
import type { ProvedorIA } from './provedor';
import { provedorSandbox } from './provedor-sandbox';
import { MAX_TOKENS_RESUMO, TOKENS_INSTRUCOES_TETO, custoMaximoMicroUsd, tokensDeBytes } from './precos';
import { pedirResumo, reservaDoResumo, ultimaTarefaDoTipo } from './resumo';
import { montarPedidoDoResumo } from './resumo-dados';
import { processarResumo } from './resumo-job';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
const deps = { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 };
const jobDeps = (provedor: ProvedorIA | null): DepsJobAssistente => ({
  db: app.db,
  modo: 'fake',
  provedor,
  geo: 'us',
  destino: 'teste',
  retencao: 'zero',
  tetoGlobalMicroUsd: IA_TESTE.tetoGlobalMicroUsd,
  appUrl: 'https://x',
  agora: () => agora,
  ultimaTentativa: false,
  alertas: { credencial: async () => 0, teto: async () => 0 },
  modeloAssistente: IA_TESTE.modeloAssistente,
  tetoRascunhoMicroUsd: IA_TESTE.tetoRascunhoMicroUsd,
});

async function cenario(o: { autorizacao?: { versao?: string; usos?: string[] }; semProntuario?: boolean } = {}) {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx);
  await autorizacaoNoBanco(app.db, T.tenantId, p.id, o.autorizacao ?? {});
  if (!o.semProntuario) await prontuarioCompleto(app.db, T.ctx, p.id);
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return { T, p, tenant: tenant as TenantRow };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;
const tarefa = async (C: Cenario, id: string) => (await withTenant(C.T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, id)), app.db))[0];
const uso = async (C: Cenario, id: string) => (await withTenant(C.T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, id)), app.db))[0];
const SEM_NOTAS = { notasPrivadas: false, gerarDeNovo: false };

describe('pedirResumo (US-120, RN-100, RN-103, D12)', () => {
  it('cria a tarefa com o carimbo, a escolha das notas e a reserva pelo pedido montado; "Pediu resumo à IA" no histórico; a fila só com ids', async () => {
    const C = await cenario();
    const { tarefaId, reaproveitada } = await pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps);
    expect(reaproveitada).toBe(false);
    const t = await tarefa(C, tarefaId);
    expect(t).toMatchObject({ tipo: 'resumo_historico', status: 'na_fila', examId: null, modelo: 'claude-sonnet-5-5', parametros: { notasPrivadas: false } });
    expect(t.carimboDados).toMatch(/^[0-9a-f]{64}$/);
    expect(t.reservaMicroUsd).toBeGreaterThan(0);
    // D12: a reserva é o teto do pedido montado com a margem de 1,5 (maior que o teto sem a margem); o carimbo é o do pedido
    const pedido = await withTenant(
      C.T.ctx,
      async (tx) => montarPedidoDoResumo(tx, (await tx.select().from(patients).where(eq(patients.id, C.p.id)))[0], { notasPrivadas: false, agora, fuso: C.tenant.fuso }),
      app.db,
    );
    expect(t.carimboDados).toBe(pedido.carimbo);
    expect(t.reservaMicroUsd).toBe(reservaDoResumo('claude-sonnet-5-5', 'us', pedido.bytes));
    expect(t.reservaMicroUsd).toBeGreaterThan(custoMaximoMicroUsd('claude-sonnet-5-5', 'us', tokensDeBytes(pedido.bytes) + TOKENS_INSTRUCOES_TETO, MAX_TOKENS_RESUMO));
    expect(await uso(C, tarefaId)).toMatchObject({ situacao: 'reservado', tipo: 'resumo_historico', custoMicroUsd: t.reservaMicroUsd });
    const h = await listAccessHistory(C.T.ctx, C.p.id, 1, app.db);
    expect(h.itens.map(rotuloDaAcao)).toContain('Pediu resumo à IA');
    const jobs = await (await getBoss()).findJobs<Record<string, unknown>>('ia-assistente');
    const job = jobs.find((j) => j.data.tarefaId === tarefaId);
    expect(job?.data).toEqual({ tenantId: C.T.tenantId, tarefaId });
  });

  it('sem autorização para o resumo (autorização 1.0 só de leitura, ou retirada) → texto da US-105/US-109, nada criado', async () => {
    const C = await cenario({ autorizacao: { versao: '1.0', usos: ['leitura_laudos'] } });
    await expect(pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps)).rejects.toMatchObject({ mensagem: MSG_IA.semAutorizacao });
    await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
    await expect(pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps)).rejects.toMatchObject({ mensagem: MSG_IA.retirouAutorizacao });
    expect(await withTenant(C.T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.patientId, C.p.id)), app.db)).toEqual([]);
  });

  it('autorização 1.1 vigente só para a leitura (sem o uso do resumo) → semAutorizacao', async () => {
    const C = await cenario({ autorizacao: { usos: ['leitura_laudos'] } });
    await expect(pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps)).rejects.toMatchObject({ mensagem: MSG_IA.semAutorizacao });
  });

  it('IA sem a retenção aceita ou aditivo desatualizado → recusa sem tarefa', async () => {
    const C = await cenario();
    await expect(pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, { ...deps, ia: { ...IA_TESTE, retencao: null } })).rejects.toMatchObject({ mensagem: MSG_IA.indisponivel });
    await expect(pedirResumo(C.T.ctx, { ...C.tenant, iaAditivoVersao: '1.0' }, C.p.id, SEM_NOTAS, deps)).rejects.toMatchObject({ mensagem: MSG_IA.aditivoDesatualizado });
    // a cópia da action diz "ativa", mas o tenant travado já não está: D16
    await app.db.update(tenants).set({ iaAditivoVersao: '1.0' }).where(eq(tenants.id, C.T.tenantId));
    await expect(pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps)).rejects.toMatchObject({ mensagem: MSG_IA.aditivoDesatualizado });
    expect(await withTenant(C.T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.patientId, C.p.id)), app.db)).toEqual([]);
  });

  it('prontuário vazio → "Ainda não há histórico para resumir." sem reserva', async () => {
    const C = await cenario({ semProntuario: true });
    await expect(pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps)).rejects.toMatchObject({ mensagem: MSG_RESUMO.vazio });
    expect(await withTenant(C.T.ctx, (tx) => tx.select().from(iaUso), app.db)).toEqual([]);
  });

  it('cota do mês sem saldo → texto da US-102, nada criado', async () => {
    const C = await cenario();
    await app.db.update(tenants).set({ iaCotaMensalUsd: 0 }).where(eq(tenants.id, C.T.tenantId));
    await expect(pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps)).rejects.toMatchObject({ mensagem: MSG_IA.cotaAcabou });
  });

  it('Reaproveitar: pronta não vencida com o mesmo carimbo e a mesma escolha → a mesma, sem cobrança; "Gerar de novo" descarta a anterior', async () => {
    const C = await cenario();
    const a = await pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps);
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId: a.tarefaId }, jobDeps(provedorSandbox()))).toBe('pronta');
    expect(await pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps)).toEqual({ tarefaId: a.tarefaId, reaproveitada: true });
    expect(await withTenant(C.T.ctx, (tx) => tx.select().from(iaUso), app.db)).toHaveLength(1); // sem cobrança nova
    const outra = await pedirResumo(C.T.ctx, C.tenant, C.p.id, { notasPrivadas: true, gerarDeNovo: false }, deps); // outra escolha = outro carimbo
    expect(outra.reaproveitada).toBe(false);
    await processarResumo({ tenantId: C.T.tenantId, tarefaId: outra.tarefaId }, jobDeps(provedorSandbox()));
    const nova = await pedirResumo(C.T.ctx, C.tenant, C.p.id, { notasPrivadas: false, gerarDeNovo: true }, deps);
    expect(nova.reaproveitada).toBe(false);
    expect(await tarefa(C, a.tarefaId)).toMatchObject({ status: 'descartada', resultado: null, parametros: null, encerradoPor: C.T.nutriId });
    expect(await ultimaTarefaDoTipo(C.T.ctx, C.p.id, 'resumo_historico', app.db)).toEqual({ id: nova.tarefaId, status: 'na_fila', erro: null });
  });

  it('revisão da T7 (RN-120): registro lançado com a tarefa na fila e apagado depois do resumo → o carimbo da pronta é o do pedido que saiu', async () => {
    const C = await cenario();
    const a = await pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps);
    const c0 = (await tarefa(C, a.tarefaId)).carimboDados;
    const [m] = await withTenant(
      { tenantId: C.T.tenantId, role: 'worker' },
      (tx) => tx.insert(anthropometry).values({ tenantId: C.T.tenantId, patientId: C.p.id, data: '2026-09-15', pesoKg: 78, alturaCm: 165 }).returning({ id: anthropometry.id }),
      app.db,
    );
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId: a.tarefaId }, jobDeps(provedorSandbox()))).toBe('pronta');
    const t = await tarefa(C, a.tarefaId);
    expect(t.carimboDados).not.toBe(c0);
    expect(await excluirAntropometria(C.T.ctx, C.p.id, m.id, app.db)).toBe(true);
    const deNovo = await pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps);
    expect(deNovo.reaproveitada).toBe(false);
    expect((await tarefa(C, deNovo.tarefaId)).carimboDados).toBe(c0); // os dados voltaram aos do primeiro pedido
  });

  it('um resumo em andamento por paciente (RN-103)', async () => {
    const C = await cenario();
    await pedirResumo(C.T.ctx, C.tenant, C.p.id, SEM_NOTAS, deps);
    await expect(pedirResumo(C.T.ctx, C.tenant, C.p.id, { notasPrivadas: true, gerarDeNovo: false }, deps)).rejects.toMatchObject({ mensagem: MSG_RESUMO.emAndamento });
  });
});
