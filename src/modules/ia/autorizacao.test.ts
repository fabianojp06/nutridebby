import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, exameComLaudo, IA_TESTE, iaPronta, pacienteAutorizado, tarefaNoBanco } from '../../../test/ia';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { iaAutorizacoes, iaTarefas, iaUso, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { autorizacaoDaTarefa, autorizacaoDoPaciente, motivoDoPaciente, registrarRetiradaPelaNutri, situacaoDaAutorizacao, situacaoParaTarefa, ultimaDecisao, vigentePara, type EventoDeDecisao } from './autorizacao';
import { pedirLeituraExame } from './tarefas';
import { AUTORIZACAO_IA_VERSAO } from './textos-legais';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-aut-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
const evento = (o: Partial<EventoDeDecisao> = {}): EventoDeDecisao => ({
  id: 'e1', evento: 'autorizou', versao: AUTORIZACAO_IA_VERSAO, usos: ['leitura_laudos'], destino: 'teste', canal: 'link',
  em: new Date('2026-10-09T12:00:00Z'), registradoEm: new Date('2026-10-09T12:00:00Z'), ...o,
});

describe('situacaoDaAutorizacao (RN-107, RN-109, D7) — sem banco', () => {
  it('nunca, vigente, retirada, versão antiga, outro destino; destino nulo (IA desligada) não confere o destino', () => {
    expect(situacaoDaAutorizacao(null, 'teste')).toEqual({ tipo: 'nunca' });
    expect(situacaoDaAutorizacao(evento(), 'teste')).toMatchObject({ tipo: 'vigente', versao: AUTORIZACAO_IA_VERSAO, destino: 'teste', canal: 'link' });
    // Plano 14B (RN-109): a 1.0 (só a leitura) ficou abaixo do mínimo da 1.1 — deixa de valer, inclusive para a leitura de laudos
    expect(situacaoDaAutorizacao(evento({ versao: '1.0' }), 'teste')).toMatchObject({ tipo: 'versao_antiga', versao: '1.0' });
    expect(situacaoDaAutorizacao(evento({ evento: 'retirou', versao: null, usos: null, destino: null, canal: 'app' }), 'teste')).toMatchObject({ tipo: 'retirada', canal: 'app' });
    expect(situacaoDaAutorizacao(evento({ versao: '0.0.9-velha' }), 'teste')).toMatchObject({ tipo: 'versao_antiga', versao: '0.0.9-velha' });
    expect(situacaoDaAutorizacao(evento({ destino: 'anthropic-us' }), 'bedrock-eu')).toMatchObject({ tipo: 'outro_destino', destino: 'anthropic-us' });
    expect(situacaoDaAutorizacao(evento({ destino: 'anthropic-us' }), null)).toMatchObject({ tipo: 'vigente' });
  });

  it('vigentePara confere o uso; motivoDoPaciente: bloqueado, arquivado ou anonimizado antes da autorização', () => {
    const s = situacaoDaAutorizacao(evento({ usos: ['resumo_historico'] }), 'teste');
    expect(vigentePara(s, 'leitura_laudos')).toBe(false);
    expect(vigentePara(s, 'resumo_historico')).toBe(true);
    expect(vigentePara(situacaoDaAutorizacao(evento(), 'teste'), 'resumo_historico')).toBe(false); // F2: uma autorização só com a leitura não cobre os usos da 14B
    const ativo = { status: 'ativo', anonimizadoEm: null };
    expect(motivoDoPaciente(ativo, situacaoDaAutorizacao(evento(), 'teste'), 'leitura_laudos')).toBeNull();
    expect(motivoDoPaciente(ativo, { tipo: 'nunca' }, 'leitura_laudos')).toBe('sem_autorizacao');
    expect(motivoDoPaciente(ativo, s, 'leitura_laudos')).toBe('sem_autorizacao');
    for (const p of [{ status: 'bloqueado', anonimizadoEm: null }, { status: 'arquivado', anonimizadoEm: null }, { status: 'ativo', anonimizadoEm: new Date() }]) {
      expect(motivoDoPaciente(p, situacaoDaAutorizacao(evento(), 'teste'), 'leitura_laudos')).toBe('paciente_indisponivel');
    }
  });
});

describe('situacaoParaTarefa (RN-108, D14) — sem banco', () => {
  it('vigente + tarefa criada antes da última retirada → retirada (a da retirada); depois dela, ou sem retirada → a situação do paciente', () => {
    const vigente = situacaoDaAutorizacao(evento({ registradoEm: new Date('2026-10-09T12:10:00Z') }), 'teste');
    const retirada = { id: 'r1', canal: 'app', em: new Date('2026-10-09T12:05:00Z'), registradoEm: new Date('2026-10-09T12:05:00Z') };
    expect(situacaoParaTarefa(vigente, retirada, new Date('2026-10-09T12:04:59Z'))).toEqual({ tipo: 'retirada', id: 'r1', em: retirada.em, canal: 'app' });
    expect(situacaoParaTarefa(vigente, retirada, new Date('2026-10-09T12:05:01Z'))).toBe(vigente);
    expect(situacaoParaTarefa(vigente, null, new Date('2026-10-01T00:00:00Z'))).toBe(vigente);
    const antiga = situacaoDaAutorizacao(evento({ versao: '0.0.9-velha' }), 'teste');
    expect(situacaoParaTarefa(antiga, retirada, new Date('2026-10-09T12:04:59Z'))).toBe(antiga);
  });
});

describe('ultimaDecisao e autorizacaoDoPaciente — no banco', () => {
  it('o último autorizou/retirou decide (por registrado_em); pedido por e-mail não conta; a reautorização volta a valer', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ler = () => withTenant(T.ctx, (tx) => autorizacaoDoPaciente(tx, p.id, 'teste'), app.db);
    expect(await ler()).toEqual({ tipo: 'nunca' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    expect((await ler()).tipo).toBe('vigente');
    await withTenant(T.ctx, (tx) => tx.insert(iaAutorizacoes).values({ tenantId: T.tenantId, patientId: p.id, evento: 'pedido_email', versao: '0.1-provisorio', canal: 'link', registradoPor: T.nutriId, emailHmac: 'h' }), app.db);
    expect((await ler()).tipo).toBe('vigente');
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    expect((await ler()).tipo).toBe('retirada');
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    expect((await ler()).tipo).toBe('vigente');
    expect((await withTenant(T.ctx, (tx) => ultimaDecisao(tx, p.id), app.db))?.evento).toBe('autorizou');
  });
});

describe('autorizacaoDaTarefa (RN-108, D14) — no banco', () => {
  it('criado_em pelo relógio do banco, depois da trava: a tarefa pedida antes da retirada vale como retirada mesmo reautorizado; a pedida depois, vigente', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId);
    const p = await pacienteAutorizado(app.db, T.ctx);
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    // o `agora` do app num passado distante: não é ele que vale para a comparação com a retirada
    const pedir = async () => pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir }), { db: app.db, agora: new Date('2026-01-01T00:00:00Z'), ia: IA_TESTE, avisarTeto: async () => 0 });
    const ler = (id: string) =>
      withTenant(T.ctx, async (tx) => {
        const [t] = await tx.select({ patientId: iaTarefas.patientId, criadoEm: iaTarefas.criadoEm }).from(iaTarefas).where(eq(iaTarefas.id, id));
        return autorizacaoDaTarefa(tx, t, 'teste');
      }, app.db);
    const antes = await pedir();
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    const depois = await pedir();
    expect((await ler(antes)).tipo).toBe('retirada');
    expect((await ler(depois)).tipo).toBe('vigente');
  });
});

describe('registrarRetiradaPelaNutri (US-109, RN-108)', () => {
  it('grava a retirada (canal "a pedido, pela nutricionista") e, na mesma transação, cancela a fila (estorno) e esvazia a pronta', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId);
    const p = await pacienteAutorizado(app.db, T.ctx);
    const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    const naFila = await pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, examId, { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 });
    const pronta = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'pronta', expiraEm: new Date(agora.getTime() + 86_400_000), resultado: { versao: 1, dataColeta: null, linhas: [], descartadas: 0 } });
    expect(await registrarRetiradaPelaNutri(T.ctx, p.id, { db: app.db, agora })).toBe(true);
    const ts = await withTenant(T.ctx, (tx) => tx.select({ id: iaTarefas.id, status: iaTarefas.status, resultado: iaTarefas.resultado, encerradoPor: iaTarefas.encerradoPor }).from(iaTarefas), app.db);
    expect(ts.find((t) => t.id === naFila)).toMatchObject({ status: 'cancelada', encerradoPor: T.nutriId });
    expect(ts.find((t) => t.id === pronta)).toMatchObject({ status: 'cancelada', resultado: null });
    expect((await withTenant(T.ctx, (tx) => tx.select({ s: iaUso.situacao }).from(iaUso).where(eq(iaUso.tarefaId, naFila)), app.db))[0].s).toBe('estornado');
    const [r] = await withTenant(T.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.evento, 'retirou')), app.db);
    expect(r).toMatchObject({ canal: 'nutricionista', registradoPor: T.nutriId, patientId: p.id, ip: null });
    expect((await withTenant(T.ctx, (tx) => autorizacaoDoPaciente(tx, p.id, 'teste'), app.db)).tipo).toBe('retirada');
    // nada a retirar: não grava outro evento
    expect(await registrarRetiradaPelaNutri(T.ctx, p.id, { db: app.db, agora })).toBe(false);
  });

  it('paciente bloqueado (exclusão atendida): PacienteBloqueadoError, nada gravado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await expect(registrarRetiradaPelaNutri(T.ctx, p.id, { db: app.db, agora })).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});
