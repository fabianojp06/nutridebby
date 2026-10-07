import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { exameComLaudo, fotoDeTeste, iaPronta, pacienteInformado, tarefaNoBanco } from '../../../test/ia';
import { closeDb } from '@/db/client';
import { auditLog, exams, iaTarefas, iaUso, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { desativarIa } from './ativacao';
import { MSG_IA } from './constantes';
import type { ConfigIA } from './modo';
import { reservaDaLeitura } from './precos';
import { estadoDaTarefa, marcasDeIa, pedirLeituraExame, PedidoIaError, tarefasDosExames } from './tarefas';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-pedido-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const agora = new Date('2026-10-06T15:00:00Z');
const IA: ConfigIA = { modo: 'fake', modelo: 'claude-opus-5-5', geo: 'us', tetoGlobalMicroUsd: 50_000_000_000 };
const tenantDe = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0] as TenantRow;
const mensagem = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PedidoIaError) return e.mensagem;
    throw e;
  }
  return 'sem erro';
};

async function cenario(o: { cotaUsd?: number; paciente?: Parameters<typeof pacienteInformado>[2] } = {}) {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId, { cotaUsd: o.cotaUsd });
  const p = await pacienteInformado(app.db, T.ctx, o.paciente);
  const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
  return { T, p, examId, tenant: await tenantDe(T.tenantId) };
}
const deps = (extra: Partial<Parameters<typeof pedirLeituraExame>[4]> = {}) => ({ db: app.db, agora, ia: IA, avisarTeto: vi.fn(async () => 0), ...extra });

describe('US-110 — pedir a leitura (RN-100, RN-103, RN-104)', () => {
  it('cria a tarefa na fila com a reserva do PDF, enfileira { tenantId, tarefaId } e o histórico registra "criar" da IA com o ator', async () => {
    const { T, p, examId, tenant } = await cenario();
    const id = await pedirLeituraExame(T.ctx, tenant, p.id, examId, deps());
    const [t] = await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, id)), app.db);
    const reserva = reservaDaLeitura('claude-opus-5-5', 'us', 'pdf');
    expect(t).toMatchObject({ status: 'na_fila', examId, pedidoPor: T.nutriId, modelo: 'claude-opus-5-5', reservaMicroUsd: reserva, resultado: null });
    const [u] = await withTenant(T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, id)), app.db);
    expect(u).toMatchObject({ situacao: 'reservado', custoMicroUsd: reserva, mes: '2026-10' });
    const jobs = await (await getBoss()).findJobs<{ tenantId: string; tarefaId: string }>('ia');
    expect(jobs.find((j) => j.data.tarefaId === id)?.data).toEqual({ tenantId: T.tenantId, tarefaId: id });
    const [a] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, id)), app.db);
    expect(a).toMatchObject({ acao: 'criar', entidade: 'ia', actorUserId: T.nutriId, patientId: p.id });
    expect(await estadoDaTarefa(T.ctx, id, app.db)).toEqual({ status: 'na_fila', erro: null });
    expect((await tarefasDosExames(T.ctx, p.id, app.db)).get(examId)).toMatchObject({ id, status: 'na_fila' });
  });

  it('foto: reserva menor (teto de uma imagem)', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId);
    const p = await pacienteInformado(app.db, T.ctx);
    const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir, conteudo: await fotoDeTeste({ largura: 400, altura: 300 }) });
    const id = await pedirLeituraExame(T.ctx, await tenantDe(T.tenantId), p.id, examId, deps());
    const [t] = await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, id)), app.db);
    expect(t.reservaMicroUsd).toBe(reservaDaLeitura('claude-opus-5-5', 'us', 'imagem'));
  });

  it('"A leitura deste laudo já está em andamento." no segundo clique', async () => {
    const { T, p, examId, tenant } = await cenario();
    await pedirLeituraExame(T.ctx, tenant, p.id, examId, deps());
    expect(await mensagem(pedirLeituraExame(T.ctx, tenant, p.id, examId, deps()))).toBe(MSG_IA.emAndamento);
  });

  it('code review do PR #23 (item 1): com sugestão "pronta" não vencida do mesmo exame, recusa o novo pedido sem reserva nem fila; vencida ou descartada, aceita', async () => {
    const { T, p, examId, tenant } = await cenario();
    const pronta = await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'pronta', expiraEm: new Date(agora.getTime() + 86_400_000) });
    expect(await mensagem(pedirLeituraExame(T.ctx, tenant, p.id, examId, deps()))).toBe(MSG_IA.jaTemSugestao);
    const linhas = await withTenant(T.ctx, (tx) => tx.select({ id: iaTarefas.id }).from(iaTarefas), app.db);
    expect(linhas).toEqual([{ id: pronta }]);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(iaUso), app.db)).toEqual([]);
    // a nutricionista descarta; uma pronta vencida (expira_em ≤ agora, antes da varredura) também não barra
    await withTenant(T.ctx, (tx) => tx.update(iaTarefas).set({ status: 'descartada', resultado: null }).where(eq(iaTarefas.id, pronta)), app.db);
    await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'pronta', expiraEm: agora });
    const nova = await pedirLeituraExame(T.ctx, tenant, p.id, examId, deps());
    expect(await estadoDaTarefa(T.ctx, nova, app.db)).toEqual({ status: 'na_fila', erro: null });
  });

  it('RN-103: 2 em andamento no consultório ou 30 pedidos da usuária na hora → "Muitos pedidos…"', async () => {
    const { T, p, tenant } = await cenario();
    const e1 = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const e2 = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const e3 = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    await pedirLeituraExame(T.ctx, tenant, p.id, e1, deps());
    await pedirLeituraExame(T.ctx, tenant, p.id, e2, deps());
    expect(await mensagem(pedirLeituraExame(T.ctx, tenant, p.id, e3, deps()))).toBe(MSG_IA.muitosPedidos);
    const U = await cenario();
    for (let i = 0; i < 30; i++) await tarefaNoBanco(app.db, U.T.ctx, U.p.id, null, { status: 'falhou', erro: 'interrompida', criadoEm: new Date(agora.getTime() - 10 * 60_000) });
    expect(await mensagem(pedirLeituraExame(U.T.ctx, U.tenant, U.p.id, U.examId, deps()))).toBe(MSG_IA.muitosPedidos);
  });

  it('US-102: sem saldo → "O limite de uso da IA deste mês acabou…" e nenhuma tarefa; teto global → "indisponível" + alerta', async () => {
    const { T, p, examId, tenant } = await cenario({ cotaUsd: 0.5 });
    expect(await mensagem(pedirLeituraExame(T.ctx, tenant, p.id, examId, deps()))).toBe(MSG_IA.cotaAcabou);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas), app.db)).toEqual([]);
    const C = await cenario();
    const avisarTeto = vi.fn(async () => 1);
    expect(await mensagem(pedirLeituraExame(C.T.ctx, C.tenant, C.p.id, C.examId, deps({ ia: { ...IA, tetoGlobalMicroUsd: 1 }, avisarTeto })))).toBe(MSG_IA.indisponivel);
    expect(avisarTeto).toHaveBeenCalledTimes(1);
  });

  it('RN-100 no app: sem ciência, com recusa, bloqueado, exame sem laudo, IA não ativa', async () => {
    const semCiencia = await cenario({ paciente: { iaAvisoVersao: null, iaAvisoEm: null, iaAvisoCanal: null } });
    expect(await mensagem(pedirLeituraExame(semCiencia.T.ctx, semCiencia.tenant, semCiencia.p.id, semCiencia.examId, deps()))).toBe(MSG_IA.semCiencia);
    const recusou = await cenario({ paciente: { iaRecusadaEm: agora } });
    expect(await mensagem(pedirLeituraExame(recusou.T.ctx, recusou.tenant, recusou.p.id, recusou.examId, deps()))).toBe(MSG_IA.recusou);
    const bloq = await cenario();
    await withTenant(bloq.T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: agora }).where(eq(patients.id, bloq.p.id)), app.db);
    await expect(pedirLeituraExame(bloq.T.ctx, bloq.tenant, bloq.p.id, bloq.examId, deps())).rejects.toBeInstanceOf(PacienteBloqueadoError);
    const semLaudo = await cenario();
    const [semArquivo] = await withTenant(semLaudo.T.ctx, (tx) => tx.insert(exams).values({ tenantId: semLaudo.T.tenantId, patientId: semLaudo.p.id, data: '2026-09-01', titulo: 'Sem laudo' }).returning({ id: exams.id }), app.db);
    expect(await mensagem(pedirLeituraExame(semLaudo.T.ctx, semLaudo.tenant, semLaudo.p.id, semArquivo.id, deps()))).toBe('Este exame não está mais disponível.');
    const desativada = await cenario();
    expect(await mensagem(pedirLeituraExame(desativada.T.ctx, { ...desativada.tenant, iaAtivadaEm: null }, desativada.p.id, desativada.examId, deps()))).toBe(MSG_IA.indisponivel);
    expect(await mensagem(pedirLeituraExame(desativada.T.ctx, desativada.tenant, desativada.p.id, desativada.examId, deps({ ia: { ...IA, modo: 'emergencia' } })))).toBe(MSG_IA.indisponivel);
    expect(await mensagem(pedirLeituraExame(desativada.T.ctx, { ...desativada.tenant, iaAditivoVersao: '0.0' }, desativada.p.id, desativada.examId, deps()))).toBe(MSG_IA.aditivoDesatualizado);
    expect(await withTenant(desativada.T.ctx, (tx) => tx.select().from(iaTarefas), app.db)).toEqual([]);
  });

  it('D16/US-101: decide com a linha do tenant travada — desativada, bloqueada, suspensa ou aditivo velho depois da leitura da action → nada é criado', async () => {
    const semRastro = async (c: Awaited<ReturnType<typeof cenario>>) => {
      expect(await withTenant(c.T.ctx, (tx) => tx.select().from(iaTarefas), app.db)).toEqual([]);
      expect(await withTenant(c.T.ctx, (tx) => tx.select().from(iaUso), app.db)).toEqual([]);
    };
    const desativada = await cenario(); // a action leu o tenant com a IA ativa; outra aba desativa antes da trava
    await desativarIa(desativada.T.ctx, { db: app.db, agora });
    expect(await mensagem(pedirLeituraExame(desativada.T.ctx, desativada.tenant, desativada.p.id, desativada.examId, deps()))).toBe(MSG_IA.indisponivel);
    await semRastro(desativada);
    const bloqueada = await cenario(); // D19: o bloqueio da admin impede novos pedidos
    await app.db.update(tenants).set({ iaLiberada: false }).where(eq(tenants.id, bloqueada.T.tenantId));
    expect(await mensagem(pedirLeituraExame(bloqueada.T.ctx, bloqueada.tenant, bloqueada.p.id, bloqueada.examId, deps()))).toBe(MSG_IA.indisponivel);
    await semRastro(bloqueada);
    const suspensa = await cenario();
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, suspensa.T.tenantId));
    expect(await mensagem(pedirLeituraExame(suspensa.T.ctx, suspensa.tenant, suspensa.p.id, suspensa.examId, deps()))).toBe(MSG_IA.indisponivel);
    await semRastro(suspensa);
    const aditivo = await cenario();
    await app.db.update(tenants).set({ iaAditivoVersao: '0.0' }).where(eq(tenants.id, aditivo.T.tenantId));
    expect(await mensagem(pedirLeituraExame(aditivo.T.ctx, aditivo.tenant, aditivo.p.id, aditivo.examId, deps()))).toBe(MSG_IA.aditivoDesatualizado);
    await semRastro(aditivo);
    const outro = await cenario(); // a linha passada é de outro consultório (IA ativa): vale a do ctx
    await desativarIa(outro.T.ctx, { db: app.db, agora });
    const ativo = await cenario();
    expect(await mensagem(pedirLeituraExame(outro.T.ctx, ativo.tenant, outro.p.id, outro.examId, deps()))).toBe(MSG_IA.indisponivel);
    await semRastro(outro);
  });

  it('exame de outro paciente ou id inválido: "Este exame não está mais disponível."', async () => {
    const A = await cenario();
    const B = await pacienteInformado(app.db, A.T.ctx);
    expect(await mensagem(pedirLeituraExame(A.T.ctx, A.tenant, B.id, A.examId, deps()))).toBe('Este exame não está mais disponível.');
    expect(await mensagem(pedirLeituraExame(A.T.ctx, A.tenant, A.p.id, 'nao-e-uuid', deps()))).toBe('Este exame não está mais disponível.');
  });
});

describe('situação dos exames e marcas da IA (sem auditoria)', () => {
  it('tarefasDosExames devolve a última tarefa de cada exame; marcasDeIa só as aplicadas, com a data da conferência', async () => {
    const { T, p, examId } = await cenario();
    const outro = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const conferida = new Date('2026-10-05T12:00:00Z');
    const aplicada = await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'aplicada', linhasAplicadas: 3, encerradoEm: conferida, criadoEm: new Date('2026-10-05T10:00:00Z') });
    const ultima = await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'falhou', erro: 'nada_encontrado', criadoEm: new Date('2026-10-06T10:00:00Z') });
    const doOutro = await tarefaNoBanco(app.db, T.ctx, p.id, outro, { status: 'pronta', expiraEm: new Date('2026-10-13T10:00:00Z') });
    await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'falhou', erro: 'interrompida' });
    const m = await tarefasDosExames(T.ctx, p.id, app.db);
    expect(m.size).toBe(2);
    expect(m.get(examId)).toEqual({ id: ultima, status: 'falhou', erro: 'nada_encontrado', expiraEm: null });
    expect(m.get(outro)).toEqual({ id: doOutro, status: 'pronta', erro: null, expiraEm: new Date('2026-10-13T10:00:00Z') });
    expect(await marcasDeIa(T.ctx, p.id, app.db)).toEqual(new Map([[aplicada, conferida]]));
    expect(await tarefasDosExames(T.ctx, 'nao-e-uuid', app.db)).toEqual(new Map());
    const leituras = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.acao, 'ler')), app.db);
    expect(leituras).toEqual([]);
  });
});
