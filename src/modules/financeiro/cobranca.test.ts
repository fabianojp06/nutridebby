import { setTimeout as esperar } from 'node:timers/promises';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { consultaDireta, em } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { buscarConsulta, ConsultaNaoEncontradaError } from '@/modules/agenda/consultas';
import { registrarPresenca } from '@/modules/agenda/presenca';
import {
  aoCorrigirParaFaltou,
  cobrancaDaConsulta,
  cobrarConsultaRealizada,
  ConsultaNaoRealizadaError,
  registrarCobrancaManual,
} from './cobranca';
import { listarCategorias, salvarConfiguracoes } from './configuracoes';
import { MSG_FINANCEIRO } from './constantes';
import { FinanceiroError, FinanceiroNaoConfiguradoError, LancamentoNaoEncontradoError } from './erros';
import { ajustarValor, cancelarLancamento, criarLancamento, marcarRecebido } from './lancamentos';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});

const M = MSG_FINANCEIRO.erros;
const SP = 'America/Sao_Paulo';
/** A consulta começa às 22:30 de 30/11 em São Paulo (01:30 de 01/12 em UTC): vence em 30/11. */
const inicio = em('2026-11-30', '22:30');
const agora = em('2026-12-01', '10:00');
const deps = { db: app.db, agora };
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });

type Cenario = TenantDeTeste & { p: string; c: string; consultas: string };
async function cenario(o: { configurar?: boolean; valorConsulta?: string } = {}): Promise<Cenario> {
  const T = await novoTenant(app.db);
  if (o.configurar !== false)
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '0', valorConsulta: o.valorConsulta ?? '250,00' }, deps);
  const consultas = o.configurar === false ? '' : (await listarCategorias(T.ctx, deps)).find((x) => x.chave === 'consultas')!.id;
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  const c = await consultaDireta(app.db, T.ctx, p, inicio);
  return { ...T, p, c, consultas };
}
const presenca = (C: Cenario, situacao: 'realizada' | 'faltou', c = C.c) => registrarPresenca(C.ctx, c, situacao, { db: app.db, now: agora });
const linhas = async (C: Cenario) =>
  (await owner.pool.query('select to_jsonb(l) as r from fin_lancamentos l where tenant_id = $1 order by created_at', [C.tenantId])).rows.map((x) => x.r);
const contar = async (q: string, ...params: unknown[]) => (await owner.pool.query(q, params)).rows[0].n as number;
const bloquear = (C: Cenario, anonimizarApos = '2046-01-01') =>
  withTenant(worker(C), (tx) => tx.execute(sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = ${anonimizarApos} where id = ${C.p}`), app.db);
const leituras = (tenantId: string) =>
  owner.pool.query(`select entidade, entidade_id, patient_id from audit_log where tenant_id = $1 and acao = 'ler' and entidade = 'financeiro'`, [tenantId]).then((r) => r.rows);
async function errosDe(p: Promise<unknown>): Promise<Record<string, string>> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(FinanceiroError);
  return (e as FinanceiroError).erros;
}
/** Espera até alguma sessão ficar presa numa trava cuja consulta casa com `padrao` (ILIKE). */
async function esperarTrava(padrao: string): Promise<boolean> {
  for (let i = 0; i < 200; i++) {
    await esperar(25);
    if ((await contar(`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike $1`, padrao)) > 0) return true;
  }
  return false;
}

describe('cobrarConsultaRealizada (US-303, RN-310, F-D13)', () => {
  it('"Realizada" cria a entrada: valor da configuração, vencimento na data da consulta no fuso, "Consultas", paciente e consulta ligados, autora = quem marcou', async () => {
    const C = await cenario();
    expect(await presenca(C, 'realizada')).toEqual({ cobranca: { tipo: 'criada', valorCentavos: 25000 } });
    const [l] = await linhas(C);
    expect(l).toMatchObject({
      tipo: 'entrada',
      valor_centavos: 25000,
      vencimento: '2026-11-30',
      categoria_id: C.consultas,
      patient_id: C.p,
      appointment_id: C.c,
      criado_por: C.nutriId,
      pago_em: null,
      forma_pagamento: null,
      descricao: null,
      cancelado_em: null,
    });
    expect((await buscarConsulta(C.ctx, C.c, app.db))?.status).toBe('realizada');
  });

  it('sem configuração ou sem valor da consulta (F-D21) → sem_valor; a presença fica registrada', async () => {
    const semConfig = await cenario({ configurar: false });
    expect(await presenca(semConfig, 'realizada')).toEqual({ cobranca: { tipo: 'sem_valor' } });
    expect((await buscarConsulta(semConfig.ctx, semConfig.c, app.db))?.status).toBe('realizada');
    const semValor = await cenario({ valorConsulta: '' });
    expect(await presenca(semValor, 'realizada')).toEqual({ cobranca: { tipo: 'sem_valor' } });
    expect([...(await linhas(semConfig)), ...(await linhas(semValor))]).toEqual([]);
  });

  it('paciente bloqueado ou anonimizado (F-D20) → bloqueado; a presença fica registrada', async () => {
    const C = await cenario();
    await bloquear(C);
    expect(await presenca(C, 'realizada')).toEqual({ cobranca: { tipo: 'bloqueado' } });
    expect((await buscarConsulta(C.ctx, C.c, app.db))?.status).toBe('realizada');
    expect(await linhas(C)).toEqual([]);
  });

  it('bloqueio confirmado no meio de "Realizada" → bloqueado, sem 42501, e a presença gravada (o estado é lido sob a trava)', async () => {
    const C = await cenario();
    const cliente = await app.pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true), set_config('app.patient_id', '', true),
                set_config('app.user_id', $2, true), set_config('app.ip', '', true)`,
        [C.tenantId, C.nutriId],
      );
      await cliente.query('select id from patients where id = $1 for update', [C.p]);
      await cliente.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = $1`, [C.p]);
      const marcando = presenca(C, 'realizada').then(
        (r) => r,
        (e: unknown) => e,
      );
      expect(await esperarTrava('%from "patients"%for key share%'), 'a presença esperou a trava do bloqueio').toBe(true);
      await cliente.query('commit');
      expect(await marcando).toEqual({ cobranca: { tipo: 'bloqueado' } });
    } finally {
      cliente.release();
    }
    expect((await buscarConsulta(C.ctx, C.c, app.db))?.status).toBe('realizada');
    expect(await linhas(C)).toEqual([]);
  });

  it('Review Focus 3: duas transações cobrando a mesma consulta → uma linha só (a outra devolve ja_existia)', async () => {
    const C = await cenario();
    const consulta = { id: C.c, patientId: C.p, inicio };
    let soltar!: () => void;
    const portao = new Promise<void>((r) => (soltar = r));
    let cobrou!: () => void;
    const cobrouA = new Promise<void>((r) => (cobrou = r));
    const a = withTenant(
      C.ctx,
      async (tx) => {
        const r = await cobrarConsultaRealizada(tx, { tenantId: C.tenantId, fuso: SP, consulta });
        cobrou();
        await portao;
        return r;
      },
      app.db,
    );
    await cobrouA;
    const b = withTenant(C.ctx, (tx) => cobrarConsultaRealizada(tx, { tenantId: C.tenantId, fuso: SP, consulta }), app.db);
    expect(await esperarTrava('%insert into "fin_lancamentos"%'), 'a segunda esperou o índice único').toBe(true);
    soltar();
    expect(await a).toEqual({ tipo: 'criada', valorCentavos: 25000 });
    expect(await b).toEqual({ tipo: 'ja_existia' });
    expect(await linhas(C)).toHaveLength(1);
  });

  it('"Realizada" de novo (a mesma situação) → { cobranca: null }, sem tocar no Financeiro', async () => {
    const C = await cenario();
    await presenca(C, 'realizada');
    const antes = await linhas(C);
    expect(await presenca(C, 'realizada')).toEqual({ cobranca: null });
    expect(await linhas(C)).toEqual(antes);
  });
});

describe('aoCorrigirParaFaltou (RN-312, F-D19 v0.2: só lê)', () => {
  it('com a cobrança em aberto → aberta; recebida → recebida; nenhuma linha muda', async () => {
    const C = await cenario();
    await presenca(C, 'realizada');
    const antes = await linhas(C);
    expect(await presenca(C, 'faltou')).toEqual({ cobranca: { tipo: 'aberta' } });
    expect(await linhas(C)).toEqual(antes);

    const R = await cenario();
    await presenca(R, 'realizada');
    const [l] = await linhas(R);
    await marcarRecebido(R.ctx, R.tenant, l.id, { pagoEm: '2026-12-01', forma: 'pix' }, deps);
    const recebida = await linhas(R);
    expect(await presenca(R, 'faltou')).toEqual({ cobranca: { tipo: 'recebida' } });
    expect(await linhas(R)).toEqual(recebida);
  });

  it('sem cobrança → nenhuma; direto pela função, sem gravar', async () => {
    const C = await cenario({ valorConsulta: '' });
    await presenca(C, 'realizada');
    expect(await presenca(C, 'faltou')).toEqual({ cobranca: { tipo: 'nenhuma' } });
    expect(await withTenant(C.ctx, (tx) => aoCorrigirParaFaltou(tx, { consultaId: C.c }), app.db)).toEqual({ tipo: 'nenhuma' });
    expect(await linhas(C)).toEqual([]);
  });

  it('"Faltou" numa consulta que não era Realizada não cobra nem lê (null); cobrança cancelada não conta', async () => {
    const C = await cenario();
    expect(await presenca(C, 'faltou')).toEqual({ cobranca: null });
    expect(await linhas(C)).toEqual([]);
    await presenca(C, 'realizada');
    const [l] = await linhas(C);
    await cancelarLancamento(C.ctx, l.id, 'Não vou cobrar', deps);
    expect(await presenca(C, 'faltou')).toEqual({ cobranca: { tipo: 'nenhuma' } });
  });
});

describe('cobrancaDaConsulta e registrarCobrancaManual (US-303, RN-314, RN-318)', () => {
  it('a seção: sem cobrança, sem `ler` e com o motivo; com cobrança, um `ler` com o id do lançamento', async () => {
    const C = await cenario();
    expect(await cobrancaDaConsulta(C.ctx, C.tenant, C.c, deps)).toEqual({ cobranca: null, podeRegistrar: false, motivo: 'nao_realizada', valorSugerido: 25000 });
    await withTenant(C.ctx, (tx) => tx.execute(sql`update appointments set status = 'realizada' where id = ${C.c}`), app.db);
    expect(await cobrancaDaConsulta(C.ctx, C.tenant, C.c, deps)).toEqual({ cobranca: null, podeRegistrar: true, motivo: null, valorSugerido: 25000 });
    expect(await leituras(C.tenantId)).toEqual([]);
    const { id } = await registrarCobrancaManual(C.ctx, C.tenant, C.c, '180,00', deps);
    const s = await cobrancaDaConsulta(C.ctx, C.tenant, C.c, deps);
    expect(s).toMatchObject({ cobranca: { id, valorCentavos: 18000, situacao: 'em_atraso', vencimento: '2026-11-30' }, podeRegistrar: false, motivo: null });
    expect(await leituras(C.tenantId)).toEqual([{ entidade: 'financeiro', entidade_id: id, patient_id: C.p }]);
  });

  it('registrar à mão: cria como na passagem para Realizada, com o valor informado', async () => {
    const C = await cenario();
    await withTenant(C.ctx, (tx) => tx.execute(sql`update appointments set status = 'realizada' where id = ${C.c}`), app.db);
    const { id } = await registrarCobrancaManual(C.ctx, C.tenant, C.c, 'R$ 1.250,50', deps);
    expect(await linhas(C)).toEqual([
      expect.objectContaining({ id, tipo: 'entrada', valor_centavos: 125050, vencimento: '2026-11-30', categoria_id: C.consultas, patient_id: C.p, appointment_id: C.c, criado_por: C.nutriId }),
    ]);
    expect(await errosDe(registrarCobrancaManual(C.ctx, C.tenant, C.c, '250', deps))).toEqual({ geral: M.jaTemCobranca });
  });

  it('RN-314: só consulta realizada, Financeiro configurado, paciente não bloqueado; valor obrigatório e na faixa', async () => {
    const C = await cenario();
    await expect(registrarCobrancaManual(C.ctx, C.tenant, C.c, '250', deps)).rejects.toBeInstanceOf(ConsultaNaoRealizadaError);
    await withTenant(C.ctx, (tx) => tx.execute(sql`update appointments set status = 'realizada' where id = ${C.c}`), app.db);
    expect(await errosDe(registrarCobrancaManual(C.ctx, C.tenant, C.c, '', deps))).toEqual({ valor: M.informeValor });
    expect(await errosDe(registrarCobrancaManual(C.ctx, C.tenant, C.c, 'abc', deps))).toEqual({ valor: M.valorInvalido });
    expect(await errosDe(registrarCobrancaManual(C.ctx, C.tenant, C.c, '0', deps))).toEqual({ valor: M.valorFaixa });
    await bloquear(C);
    expect(await errosDe(registrarCobrancaManual(C.ctx, C.tenant, C.c, '250', deps))).toEqual({ geral: MSG_FINANCEIRO.consulta.bloqueado });
    expect(await cobrancaDaConsulta(C.ctx, C.tenant, C.c, deps)).toMatchObject({ podeRegistrar: false, motivo: 'bloqueado' });

    const S = await cenario({ configurar: false });
    await withTenant(S.ctx, (tx) => tx.execute(sql`update appointments set status = 'realizada' where id = ${S.c}`), app.db);
    await expect(registrarCobrancaManual(S.ctx, S.tenant, S.c, '250', deps)).rejects.toBeInstanceOf(FinanceiroNaoConfiguradoError);
    expect(await cobrancaDaConsulta(S.ctx, S.tenant, S.c, deps)).toEqual({ cobranca: null, podeRegistrar: false, motivo: 'nao_configurado', valorSugerido: null });
    expect([...(await linhas(C)), ...(await linhas(S))]).toEqual([]);
  });

  it('consulta de outro consultório ou id inválido → ConsultaNaoEncontradaError, sem gravar', async () => {
    const A = await cenario();
    const B = await cenario();
    await withTenant(B.ctx, (tx) => tx.execute(sql`update appointments set status = 'realizada' where id = ${B.c}`), app.db);
    await expect(registrarCobrancaManual(A.ctx, A.tenant, B.c, '250', deps)).rejects.toBeInstanceOf(ConsultaNaoEncontradaError);
    await expect(registrarCobrancaManual(A.ctx, A.tenant, 'nao-e-uuid', '250', deps)).rejects.toBeInstanceOf(ConsultaNaoEncontradaError);
    expect(await linhas(B)).toEqual([]);
  });

  it('duas abas registrando à mão ao mesmo tempo → uma cobrança só; a outra vê "Esta consulta já tem uma cobrança."', async () => {
    const C = await cenario();
    await withTenant(C.ctx, (tx) => tx.execute(sql`update appointments set status = 'realizada' where id = ${C.c}`), app.db);
    const r = await Promise.allSettled([registrarCobrancaManual(C.ctx, C.tenant, C.c, '250', deps), registrarCobrancaManual(C.ctx, C.tenant, C.c, '260', deps)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(FinanceiroError);
    expect((recusa.reason as FinanceiroError).erros).toEqual({ geral: M.jaTemCobranca });
    expect(await linhas(C)).toHaveLength(1);
  });

  it('"Salvar valor" (ajustarValor): só o valor muda; paciente bloqueado só para menor ou igual (RN-315)', async () => {
    const C = await cenario();
    await presenca(C, 'realizada');
    const [antes] = await linhas(C);
    await ajustarValor(C.ctx, antes.id, '300,00', deps);
    const [depois] = await linhas(C);
    expect(depois).toEqual({ ...antes, valor_centavos: 30000, updated_at: depois.updated_at });
    expect(await errosDe(ajustarValor(C.ctx, antes.id, '', deps))).toEqual({ valor: M.informeValor });
    await bloquear(C);
    expect(await errosDe(ajustarValor(C.ctx, antes.id, '300,01', deps))).toEqual({ geral: M.bloqueadoAlterar });
    await ajustarValor(C.ctx, antes.id, '200', deps);
    expect((await linhas(C))[0].valor_centavos).toBe(20000);
  });

  it('daConsulta (a seção da consulta): lançamento que não é a cobrança desta consulta → não encontrado, nada muda', async () => {
    const C = await cenario();
    await presenca(C, 'realizada');
    const outra = await consultaDireta(app.db, C.ctx, C.p, em('2026-11-29', '10:00'));
    await presenca(C, 'realizada', outra);
    const avulsa = await criarLancamento(C.ctx, C.tenant, { tipo: 'entrada', valor: '90,00', categoriaId: C.consultas, vencimento: '2026-11-30', pacienteId: C.p }, deps);
    const todas = await linhas(C);
    const daOutra = todas.find((l) => l.appointment_id === outra)!.id as string;
    const desta = todas.find((l) => l.appointment_id === C.c)!.id as string;
    for (const id of [daOutra, avulsa.id]) {
      await expect(ajustarValor(C.ctx, id, '1,00', { ...deps, daConsulta: C.c })).rejects.toBeInstanceOf(LancamentoNaoEncontradoError);
      await expect(marcarRecebido(C.ctx, C.tenant, id, { pagoEm: '2026-11-30', forma: 'pix' }, { ...deps, daConsulta: C.c })).rejects.toBeInstanceOf(
        LancamentoNaoEncontradoError,
      );
      await expect(cancelarLancamento(C.ctx, id, 'Não é desta consulta', { ...deps, daConsulta: C.c })).rejects.toBeInstanceOf(LancamentoNaoEncontradoError);
    }
    expect(await linhas(C)).toEqual(todas);
    // controle: a cobrança desta consulta segue
    await ajustarValor(C.ctx, desta, '200,00', { ...deps, daConsulta: C.c });
    expect((await linhas(C)).find((l) => l.id === desta).valor_centavos).toBe(20000);
  });

  it('só a sessão nutri (RN-300)', async () => {
    const C = await cenario();
    await expect(cobrancaDaConsulta(worker(C), C.tenant, C.c, deps)).rejects.toThrow('só a sessão nutri');
    await expect(registrarCobrancaManual(worker(C), C.tenant, C.c, '250', deps)).rejects.toThrow('só a sessão nutri');
  });
});
