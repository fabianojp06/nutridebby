import { randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { consultaDireta, novoLocal } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { finLancamentos } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { locaisParaFiltro } from '@/modules/agenda/locais';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { gravarCadastro } from '@/modules/pacientes/cadastro';
import { listarCategorias, salvarConfiguracoes } from './configuracoes';
import { MSG_FINANCEIRO } from './constantes';
import { FinanceiroError, FinanceiroNaoConfiguradoError, LancamentoNaoEncontradoError, LocalDoFiltroInvalidoError } from './erros';
import { exportarLancamentosCsv } from './exportacao';
import {
  abrirLancamento,
  cancelarLancamento,
  criarLancamento,
  desfazerRecebimento,
  editarLancamento,
  listarLancamentos,
  marcarRecebido,
  pacienteDoFinanceiro,
  pacientesParaLancamento,
} from './lancamentos';
import { pagamentosPendentes, pendenciasDoPaciente } from './resumo';
import { SEM_LOCAL } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const M = MSG_FINANCEIRO.erros;
/** 17/11/2026 22:30 em São Paulo; o servidor (UTC) já está no dia 18 às 01:30. */
const agora = new Date('2026-11-18T01:30:00Z');
const deps = { db: app.db, agora };
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });

async function errosDe(p: Promise<unknown>): Promise<Record<string, string>> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(FinanceiroError);
  return (e as FinanceiroError).erros;
}

type Cenario = TenantDeTeste & { p: string; consultas: string; outrasEntradas: string; aluguel: string; material: string };
async function cenario(): Promise<Cenario> {
  const T = await novoTenant(app.db);
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00', valorConsulta: '250,00' }, deps);
  const cats = await listarCategorias(T.ctx, deps);
  const id = (nome: string) => cats.find((c) => c.nome === nome)!.id;
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  return { ...T, p, consultas: id('Consultas'), outrasEntradas: id('Outras entradas'), aluguel: id('Aluguel e condomínio'), material: id('Material e insumos') };
}
const entrada = (C: Cenario, extra: Record<string, unknown> = {}) =>
  criarLancamento(C.ctx, C.tenant, { tipo: 'entrada', valor: '250,00', categoriaId: C.consultas, vencimento: '2026-11-20', pacienteId: C.p, descricao: 'Retorno', ...extra }, deps);
const saida = (C: Cenario, extra: Record<string, unknown> = {}) =>
  criarLancamento(C.ctx, C.tenant, { tipo: 'saida', valor: '1.200,00', categoriaId: C.aluguel, vencimento: '2026-11-05', ...extra }, deps);
/** A linha como JSON: datas 'AAAA-MM-DD' (o driver pg converteria `date` em Date à meia-noite UTC). */
const ler = async (id: string) => (await owner.pool.query('select to_jsonb(l) as r from fin_lancamentos l where id = $1', [id])).rows[0]?.r;
const contar = async (q: string, ...params: unknown[]) => (await owner.pool.query(q, params)).rows[0].n as number;
const leituras = (tenantId: string) =>
  owner.pool
    .query(`select acao, entidade, entidade_id, patient_id, actor_user_id from audit_log where tenant_id = $1 and acao = 'ler' order by criado_em`, [tenantId])
    .then((r) => r.rows);

const bloquear = (C: Cenario, paciente = C.p, anonimizarApos = '2046-01-01') =>
  withTenant(worker(C), (tx) => tx.execute(sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = ${anonimizarApos} where id = ${paciente}`), app.db);
async function anonimizar(C: Cenario, paciente = C.p) {
  await bloquear(C, paciente, '2020-01-01');
  await withTenant(worker(C), (tx) => tx.execute(sql`select app_anonimizar_financeiro(${paciente})`), app.db);
}

describe('criarLancamento (US-301, RN-304, RN-317)', () => {
  it('entrada com paciente e saída sem: gravadas com a autora da sessão; mês de referência e antesDoSaldo', async () => {
    const C = await cenario();
    const e = await entrada(C);
    expect(e).toEqual({ id: expect.any(String), antesDoSaldo: false, mes: '2026-11' });
    expect(await ler(e.id)).toMatchObject({
      tipo: 'entrada', valor_centavos: 25000, categoria_id: C.consultas, vencimento: '2026-11-20', pago_em: null, forma_pagamento: null,
      patient_id: C.p, descricao: 'Retorno', criado_por: C.nutriId,
    });
    const s = await saida(C, { pagoEm: '2026-11-05', forma: 'pix', descricao: '' });
    expect(s).toMatchObject({ antesDoSaldo: false, mes: '2026-11' });
    expect(await ler(s.id)).toMatchObject({ tipo: 'saida', valor_centavos: 120000, patient_id: null, pago_em: '2026-11-05', forma_pagamento: 'pix', descricao: null });
  });

  it('antesDoSaldo: recebido antes da data do saldo; o mês é o do recebimento', async () => {
    const C = await cenario();
    expect(await entrada(C, { vencimento: '2026-10-20', pagoEm: '2026-10-28', forma: 'dinheiro' })).toMatchObject({ antesDoSaldo: true, mes: '2026-10' });
    expect(await entrada(C, { vencimento: '2026-10-20', pagoEm: '2026-11-01', forma: 'dinheiro' })).toMatchObject({ antesDoSaldo: false, mes: '2026-11' });
    // em aberto não altera o saldo nunca: sem aviso, mês do vencimento
    expect(await entrada(C, { vencimento: '2026-10-20' })).toMatchObject({ antesDoSaldo: false, mes: '2026-10' });
  });

  it('vencimento de 01/01/2000 até 31/12 do ano de hoje + 5 (no fuso)', async () => {
    const C = await cenario();
    await saida(C, { vencimento: '2031-12-31' });
    await saida(C, { vencimento: '2000-01-01' });
    expect(await errosDe(saida(C, { vencimento: '2032-01-01' }))).toEqual({ vencimento: M.dataInvalida });
    expect(await errosDe(saida(C, { vencimento: '1999-12-31' }))).toEqual({ vencimento: M.dataInvalida });
    expect(await errosDe(saida(C, { vencimento: '2026-02-29' }))).toEqual({ vencimento: M.dataInvalida });
    expect(await errosDe(saida(C, { vencimento: ' ' }))).toEqual({ vencimento: M.informeVencimento });
  });

  it('recebimento de 01/01/2000 até hoje no fuso: às 01:30 UTC do dia 18, o dia 18 ainda é amanhã', async () => {
    const C = await cenario();
    expect(await errosDe(entrada(C, { pagoEm: '2026-11-18', forma: 'pix' }))).toEqual({ pagoEm: M.recebimentoFuturo });
    expect(await errosDe(saida(C, { pagoEm: '2026-11-18', forma: 'pix' }))).toEqual({ pagoEm: M.pagamentoFuturo });
    expect(await errosDe(saida(C, { pagoEm: '1999-12-31', forma: 'pix' }))).toEqual({ pagoEm: M.dataInvalida });
    expect(await entrada(C, { pagoEm: '2026-11-17', forma: 'pix' })).toMatchObject({ mes: '2026-11' });
  });

  it('forma obrigatória com a data do recebimento; valor, categoria e descrição com os textos exatos', async () => {
    const C = await cenario();
    expect(await errosDe(entrada(C, { pagoEm: '2026-11-17', forma: '' }))).toEqual({ forma: M.escolhaForma });
    expect(await errosDe(entrada(C, { pagoEm: '2026-11-17', forma: 'cheque' }))).toEqual({ forma: M.escolhaForma });
    expect(await errosDe(entrada(C, { valor: '', categoriaId: '', descricao: 'x'.repeat(201) }))).toEqual({
      valor: M.informeValor,
      categoriaId: M.escolhaCategoria,
      descricao: M.descricaoLonga,
    });
    expect(await errosDe(entrada(C, { valor: 'abc' }))).toEqual({ valor: M.valorInvalido });
    expect(await errosDe(entrada(C, { valor: '0,00' }))).toEqual({ valor: M.valorFaixa });
    expect(await errosDe(entrada(C, { valor: '-10,00' }))).toEqual({ valor: M.valorFaixa });
    expect(await errosDe(entrada(C, { valor: '1.000.000,01' }))).toEqual({ valor: M.valorFaixa });
    await entrada(C, { valor: '1.000.000,00', descricao: 'é'.repeat(200) });
  });

  it('categoria: do mesmo tipo e não arquivada', async () => {
    const C = await cenario();
    expect(await errosDe(entrada(C, { categoriaId: C.aluguel }))).toEqual({ categoriaId: M.escolhaCategoria });
    await owner.pool.query('update fin_categorias set arquivada_em = now() where id = $1', [C.outrasEntradas]);
    expect(await errosDe(entrada(C, { categoriaId: C.outrasEntradas }))).toEqual({ categoriaId: M.escolhaCategoria });
    expect(await errosDe(entrada(C, { categoriaId: randomUUID() }))).toEqual({ categoriaId: M.escolhaCategoria });
  });

  it('saída com paciente é recusada e nada é gravado', async () => {
    const C = await cenario();
    await expect(saida(C, { pacienteId: C.p })).rejects.toThrow();
    expect(await contar('select count(*)::int as n from fin_lancamentos where tenant_id = $1', C.tenantId)).toBe(0);
  });

  it('sem configuração: FinanceiroNaoConfiguradoError (RN-301)', async () => {
    const T = await novoTenant(app.db);
    await expect(criarLancamento(T.ctx, T.tenant, { tipo: 'saida', valor: '10', categoriaId: randomUUID(), vencimento: '2026-11-05' }, deps)).rejects.toBeInstanceOf(
      FinanceiroNaoConfiguradoError,
    );
  });

  it('paciente bloqueado recusa a criação com a mensagem exata; arquivado pode; de outro consultório não é encontrado', async () => {
    const C = await cenario();
    const arquivado = (await novoPaciente(app.db, C.ctx, { nome: 'Carla Dias', status: 'arquivado' })).id;
    await entrada(C, { pacienteId: arquivado });
    await bloquear(C);
    expect(await errosDe(entrada(C))).toEqual({ pacienteId: M.bloqueadoNovo });
    const B = await cenario();
    await expect(entrada(C, { pacienteId: B.p })).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(entrada(C, { pacienteId: 'nao-e-uuid' })).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
  });

  it('Review Focus 3: bloqueio confirmado no meio da criação → FinanceiroError do bloqueado (trava FOR KEY SHARE + conferência sob a trava)', async () => {
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
      const criando = entrada(C).then(
        () => null,
        (e: unknown) => e,
      );
      let esperando = false;
      for (let i = 0; i < 200 && !esperando; i++) {
        await esperar(25);
        esperando =
          (await contar(`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%from "patients"%for key share%'`)) > 0;
      }
      expect(esperando, 'a criação esperou a trava do bloqueio').toBe(true);
      await cliente.query('commit');
      const e = await criando;
      expect(e).toBeInstanceOf(FinanceiroError);
      expect((e as FinanceiroError).erros).toEqual({ pacienteId: M.bloqueadoNovo });
    } finally {
      cliente.release();
    }
    expect(await contar('select count(*)::int as n from fin_lancamentos where tenant_id = $1', C.tenantId)).toBe(0);
  });
});

describe('editar, receber, desfazer e cancelar (US-302, RN-308, RN-309, RN-315, RN-316)', () => {
  it('editar muda valor, categoria, vencimento, recebimento e descrição; devolve o mês de referência', async () => {
    const C = await cenario();
    const { id } = await entrada(C, { pacienteId: '' });
    expect(
      await editarLancamento(C.ctx, C.tenant, id, { valor: '200', categoriaId: C.outrasEntradas, vencimento: '2026-10-10', pagoEm: '2026-10-30', forma: 'boleto', descricao: '' }, deps),
    ).toEqual({ antesDoSaldo: true, mes: '2026-10' });
    expect(await ler(id)).toMatchObject({ valor_centavos: 20000, categoria_id: C.outrasEntradas, vencimento: '2026-10-10', pago_em: '2026-10-30', forma_pagamento: 'boleto', descricao: null });
    // tipo e paciente do formulário são ignorados (fixos)
    await editarLancamento(C.ctx, C.tenant, id, { tipo: 'saida', pacienteId: C.p, valor: '200', categoriaId: C.outrasEntradas, vencimento: '2026-10-10' }, deps);
    expect(await ler(id)).toMatchObject({ tipo: 'entrada', patient_id: null, pago_em: null, forma_pagamento: null });
  });

  it('editar com a categoria atual arquivada mantém a categoria; trocar para uma arquivada ou do outro tipo é recusado', async () => {
    const C = await cenario();
    const { id } = await saida(C);
    await owner.pool.query('update fin_categorias set arquivada_em = now() where id = $1', [C.aluguel]);
    await editarLancamento(C.ctx, C.tenant, id, { valor: '1.100,00', categoriaId: C.aluguel, vencimento: '2026-11-05' }, deps);
    expect(await errosDe(editarLancamento(C.ctx, C.tenant, id, { valor: '1.100,00', categoriaId: C.consultas, vencimento: '2026-11-05' }, deps))).toEqual({
      categoriaId: M.escolhaCategoria,
    });
    const outra = await saida(C, { categoriaId: C.material });
    expect(await errosDe(editarLancamento(C.ctx, C.tenant, outra.id, { valor: '1', categoriaId: C.aluguel, vencimento: '2026-11-05' }, deps))).toEqual({
      categoriaId: M.escolhaCategoria,
    });
  });

  it('marcar como recebido e desfazer', async () => {
    const C = await cenario();
    const { id } = await entrada(C, { vencimento: '2026-11-10' });
    expect(await errosDe(marcarRecebido(C.ctx, C.tenant, id, { pagoEm: '2026-11-18', forma: 'pix' }, deps))).toEqual({ pagoEm: M.recebimentoFuturo });
    expect(await errosDe(marcarRecebido(C.ctx, C.tenant, id, { pagoEm: '2026-11-17', forma: '' }, deps))).toEqual({ forma: M.escolhaForma });
    expect(await marcarRecebido(C.ctx, C.tenant, id, { pagoEm: '2026-11-17', forma: 'dinheiro' }, deps)).toEqual({ mes: '2026-11', tipo: 'entrada' });
    expect(await ler(id)).toMatchObject({ pago_em: '2026-11-17', forma_pagamento: 'dinheiro' });
    await desfazerRecebimento(C.ctx, id, deps);
    expect(await ler(id)).toMatchObject({ pago_em: null, forma_pagamento: null });
  });

  it('cancelar pede motivo de 1 a 200 caracteres; grava quem e quando (gatilho)', async () => {
    const C = await cenario();
    const { id } = await entrada(C);
    expect(await errosDe(cancelarLancamento(C.ctx, id, '  ', deps))).toEqual({ motivo: M.informeMotivo });
    expect(await errosDe(cancelarLancamento(C.ctx, id, 'x'.repeat(201), deps))).toEqual({ motivo: M.motivoLongo });
    await cancelarLancamento(C.ctx, id, ' Lançado em duplicidade ', deps);
    const l = await ler(id);
    expect(l).toMatchObject({ motivo_cancelamento: 'Lançado em duplicidade', cancelado_por: C.nutriId });
    expect(l.cancelado_em).not.toBeNull();
  });

  it('cancelado não muda mais (mensagem exata)', async () => {
    const C = await cenario();
    const { id } = await entrada(C);
    await cancelarLancamento(C.ctx, id, 'Duplicado', deps);
    const cancelado = { geral: M.cancelado };
    expect(await errosDe(editarLancamento(C.ctx, C.tenant, id, { valor: '1', categoriaId: C.consultas, vencimento: '2026-11-20' }, deps))).toEqual(cancelado);
    expect(await errosDe(marcarRecebido(C.ctx, C.tenant, id, { pagoEm: '2026-11-17', forma: 'pix' }, deps))).toEqual(cancelado);
    expect(await errosDe(desfazerRecebimento(C.ctx, id, deps))).toEqual(cancelado);
    expect(await errosDe(cancelarLancamento(C.ctx, id, 'De novo', deps))).toEqual(cancelado);
  });

  it('anonimizado não muda mais (mensagem exata)', async () => {
    const C = await cenario();
    const { id } = await entrada(C, { pagoEm: '2026-11-10', forma: 'pix' });
    await anonimizar(C);
    const anonimizado = { geral: M.anonimizado };
    expect(await errosDe(editarLancamento(C.ctx, C.tenant, id, { valor: '1', categoriaId: C.consultas, vencimento: '2026-11-20' }, deps))).toEqual(anonimizado);
    expect(await errosDe(marcarRecebido(C.ctx, C.tenant, id, { pagoEm: '2026-11-17', forma: 'pix' }, deps))).toEqual(anonimizado);
    expect(await errosDe(desfazerRecebimento(C.ctx, id, deps))).toEqual(anonimizado);
    expect(await errosDe(cancelarLancamento(C.ctx, id, 'Devolução', deps))).toEqual(anonimizado);
  });

  it('paciente bloqueado: recebe, desfaz, reduz e cancela; aumentar o valor ou mudar categoria, vencimento ou descrição → mensagem exata', async () => {
    const C = await cenario();
    const { id } = await entrada(C, { valor: '250,00', descricao: 'Retorno' });
    const outro = await entrada(C);
    await bloquear(C);
    const base = { valor: '250,00', categoriaId: C.consultas, vencimento: '2026-11-20', descricao: 'Retorno' };
    await marcarRecebido(C.ctx, C.tenant, id, { pagoEm: '2026-11-17', forma: 'pix' }, deps);
    await desfazerRecebimento(C.ctx, id, deps);
    expect(await editarLancamento(C.ctx, C.tenant, id, { ...base, valor: '200,00' }, deps)).toEqual({ antesDoSaldo: false, mes: '2026-11' });
    // pela edição também pode receber (data e forma)
    await editarLancamento(C.ctx, C.tenant, id, { ...base, valor: '200,00', pagoEm: '2026-11-16', forma: 'pix' }, deps);
    expect(await ler(id)).toMatchObject({ valor_centavos: 20000, pago_em: '2026-11-16', forma_pagamento: 'pix' });
    const bloqueado = { geral: M.bloqueadoAlterar };
    expect(await errosDe(editarLancamento(C.ctx, C.tenant, id, { ...base, valor: '300,00' }, deps))).toEqual(bloqueado);
    expect(await errosDe(editarLancamento(C.ctx, C.tenant, id, { ...base, valor: '200,00', vencimento: '2026-11-21' }, deps))).toEqual(bloqueado);
    expect(await errosDe(editarLancamento(C.ctx, C.tenant, id, { ...base, valor: '200,00', descricao: 'Outra' }, deps))).toEqual(bloqueado);
    expect(await errosDe(editarLancamento(C.ctx, C.tenant, id, { ...base, valor: '200,00', categoriaId: C.outrasEntradas }, deps))).toEqual(bloqueado);
    expect(await ler(id)).toMatchObject({ valor_centavos: 20000, vencimento: '2026-11-20', descricao: 'Retorno', categoria_id: C.consultas });
    await cancelarLancamento(C.ctx, outro.id, 'Devolução', deps);
    expect((await ler(outro.id)).cancelado_em).not.toBeNull();
  });

  it('lançamento de outro consultório ou id inválido: não encontrado', async () => {
    const A = await cenario();
    const B = await cenario();
    const { id } = await entrada(A);
    await expect(editarLancamento(B.ctx, B.tenant, id, { valor: '1', categoriaId: B.consultas, vencimento: '2026-11-20' }, deps)).rejects.toBeInstanceOf(LancamentoNaoEncontradoError);
    await expect(marcarRecebido(B.ctx, B.tenant, id, { pagoEm: '2026-11-17', forma: 'pix' }, deps)).rejects.toBeInstanceOf(LancamentoNaoEncontradoError);
    await expect(cancelarLancamento(B.ctx, id, 'x', deps)).rejects.toBeInstanceOf(LancamentoNaoEncontradoError);
    await expect(desfazerRecebimento(B.ctx, 'nao-e-uuid', deps)).rejects.toBeInstanceOf(LancamentoNaoEncontradoError);
    expect(await abrirLancamento(B.ctx, B.tenant, id, deps)).toBeNull();
    expect(await ler(id)).toMatchObject({ valor_centavos: 25000, cancelado_em: null });
  });
});

describe('listarLancamentos e abrirLancamento (RN-305, RN-306, RN-318)', () => {
  it('sem mês: o mês atual no fuso, pela data de referência, mais recentes primeiro, com situação e totais sem os cancelados', async () => {
    const C = await cenario();
    const previsto = (await entrada(C, { vencimento: '2026-11-25' })).id;
    const atraso = (await entrada(C, { vencimento: '2026-11-03', pacienteId: '' })).id;
    const recebidoEmNov = (await entrada(C, { vencimento: '2026-10-15', pagoEm: '2026-11-02', forma: 'pix' })).id;
    const pago = (await saida(C, { pagoEm: '2026-11-05', forma: 'boleto' })).id;
    const aPagar = (await saida(C, { valor: '80,00', vencimento: '2026-11-30', categoriaId: C.material })).id;
    const cancelado = (await saida(C, { valor: '99,00', vencimento: '2026-11-12' })).id;
    await cancelarLancamento(C.ctx, cancelado, 'Erro', deps);
    await entrada(C, { vencimento: '2026-10-31' }); // outubro
    await entrada(C, { vencimento: '2026-11-01', pagoEm: '2026-10-31', forma: 'pix' }); // recebido em outubro

    const r = await listarLancamentos(C.ctx, C.tenant, {}, deps);
    expect(r.linhas.map((l) => l.id)).toEqual([aPagar, previsto, cancelado, pago, atraso, recebidoEmNov]);
    expect(Object.fromEntries(r.linhas.map((l) => [l.id, l.situacao]))).toEqual({
      [aPagar]: 'previsto', [previsto]: 'previsto', [cancelado]: 'cancelado', [pago]: 'pago', [atraso]: 'em_atraso', [recebidoEmNov]: 'recebido',
    });
    expect(r.totais).toEqual({ entradas: { recebido: 25000, aReceber: 50000 }, saidas: { pago: 120000, aPagar: 8000 } });
    expect(r.maisDe200).toBe(false);
    const linha = r.linhas.find((l) => l.id === previsto)!;
    expect(linha).toMatchObject({
      tipo: 'entrada', categoria: { id: C.consultas, nome: 'Consultas' }, valorCentavos: 25000, vencimento: '2026-11-25', pagoEm: null, forma: null,
      descricao: 'Retorno', paciente: { id: C.p, nome: 'Ana Souza', bloqueado: false, anonimizado: false }, consulta: null, canceladoEm: null, motivoCancelamento: null, anonimizado: false,
    });
    expect(r.linhas.find((l) => l.id === cancelado)).toMatchObject({ situacao: 'cancelado', motivoCancelamento: 'Erro' });
    expect(await leituras(C.tenantId)).toEqual([]); // sem filtro de paciente: sem auditRead
  });

  it('filtros: mês, tipo, categoria, situação e forma', async () => {
    const C = await cenario();
    const out = (await entrada(C, { vencimento: '2026-10-10' })).id;
    const pix = (await saida(C, { pagoEm: '2026-11-05', forma: 'pix' })).id;
    const boleto = (await saida(C, { pagoEm: '2026-11-06', forma: 'boleto', categoriaId: C.material })).id;
    const aberta = (await entrada(C)).id;
    const ids = async (f: Parameters<typeof listarLancamentos>[2]) => (await listarLancamentos(C.ctx, C.tenant, f, deps)).linhas.map((l) => l.id);
    expect(await ids({ mes: '2026-10' })).toEqual([out]);
    expect(await ids({ mes: '2026-10', situacao: 'em_atraso' })).toEqual([out]);
    expect(await ids({ tipo: 'saida' })).toEqual([boleto, pix]);
    expect(await ids({ categoriaId: C.material })).toEqual([boleto]);
    expect(await ids({ forma: 'pix' })).toEqual([pix]);
    expect(await ids({ situacao: 'recebido_ou_pago' })).toEqual([boleto, pix]);
    expect(await ids({ situacao: 'previsto' })).toEqual([aberta]);
    expect(await ids({ situacao: 'cancelado' })).toEqual([]);
  });

  it('meses: do mês atual até o do lançamento mais antigo (data de referência), mais recentes primeiro', async () => {
    const C = await cenario();
    expect((await listarLancamentos(C.ctx, C.tenant, {}, deps)).meses).toEqual(['2026-11']);
    await entrada(C, { vencimento: '2026-12-20' });
    await entrada(C, { vencimento: '2026-09-30', pagoEm: '2026-08-31', forma: 'pix' });
    expect((await listarLancamentos(C.ctx, C.tenant, {}, deps)).meses).toEqual(['2026-11', '2026-10', '2026-09', '2026-08']);
  });

  it('meses: o mesmo que min(coalesce(pago_em, vencimento)) — o vencimento antigo de um pago não conta; o cancelado conta', async () => {
    const C = await cenario();
    const B = await cenario();
    await entrada(B, { vencimento: '2025-01-10' }); // outro consultório: não entra
    const minimo = async () =>
      (await owner.pool.query(`select min(coalesce(pago_em, vencimento))::text as d from fin_lancamentos where tenant_id = $1`, [C.tenantId])).rows[0].d as string;
    const doMes = async () => (await listarLancamentos(C.ctx, C.tenant, {}, deps)).meses.at(-1);
    await entrada(C, { vencimento: '2026-05-10', pagoEm: '2026-07-01', forma: 'pix' });
    expect([await doMes(), (await minimo()).slice(0, 7)]).toEqual(['2026-07', '2026-07']);
    const cancelada = await entrada(C, { vencimento: '2026-06-15' });
    await cancelarLancamento(C.ctx, cancelada.id, 'Duplicada', deps);
    expect([await doMes(), (await minimo()).slice(0, 7)]).toEqual(['2026-06', '2026-06']);
    const canceladaPaga = await entrada(C, { vencimento: '2026-03-20', pagoEm: '2026-04-02', forma: 'pix' });
    await cancelarLancamento(C.ctx, canceladaPaga.id, 'Devolvido', deps);
    expect([await doMes(), (await minimo()).slice(0, 7)]).toEqual(['2026-04', '2026-04']);
    await entrada(C, { vencimento: '2026-02-01' });
    expect([await doMes(), (await minimo()).slice(0, 7)]).toEqual(['2026-02', '2026-02']);
  });

  it('com paciente e sem mês: todos os meses do paciente e UM "ler" no audit_log (entidade financeiro, sem entidade_id)', async () => {
    const C = await cenario();
    const outro = (await novoPaciente(app.db, C.ctx, { nome: 'Bruno Lima' })).id;
    const a = (await entrada(C, { vencimento: '2026-01-10' })).id;
    const b = (await entrada(C, { vencimento: '2026-11-20' })).id;
    const c = (await entrada(C, { vencimento: '2027-03-01' })).id;
    await entrada(C, { pacienteId: outro });
    const r = await listarLancamentos(C.ctx, C.tenant, { pacienteId: C.p }, deps);
    expect(r.linhas.map((l) => l.id)).toEqual([c, b, a]);
    expect(r.totais.entradas.aReceber).toBe(75000);
    expect(await leituras(C.tenantId)).toEqual([{ acao: 'ler', entidade: 'financeiro', entidade_id: null, patient_id: C.p, actor_user_id: C.nutriId }]);
    // com paciente e mês: só o mês; e um paciente sem lançamento no filtro não grava leitura
    expect((await listarLancamentos(C.ctx, C.tenant, { pacienteId: C.p, mes: '2026-11' }, deps)).linhas.map((l) => l.id)).toEqual([b]);
    expect((await listarLancamentos(C.ctx, C.tenant, { pacienteId: C.p, mes: '2025-01' }, deps)).linhas).toEqual([]);
    expect(await leituras(C.tenantId)).toHaveLength(2);
  });

  it('com paciente e sem mês: até 200, mais recentes primeiro, com maisDe200', async () => {
    const C = await cenario();
    await withTenant(
      C.ctx,
      (tx) =>
        tx.execute(sql`insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, patient_id, criado_por)
          select ${C.tenantId}, 'entrada', ${C.consultas}, 100, date '2026-01-01' + g, ${C.p}, ${C.nutriId} from generate_series(1, 201) g`),
      app.db,
    );
    const r = await listarLancamentos(C.ctx, C.tenant, { pacienteId: C.p }, deps);
    expect(r.linhas).toHaveLength(200);
    expect(r.maisDe200).toBe(true);
    expect(r.linhas[0].vencimento).toBe('2026-07-21');
    expect(r.totais.entradas.aReceber).toBe(20100); // os totais são do filtro inteiro
    expect(await leituras(C.tenantId)).toHaveLength(1);
  });

  it('abrirLancamento: com paciente grava "ler" com o id do lançamento; sem paciente não grava', async () => {
    const C = await cenario();
    const com = (await entrada(C)).id;
    const sem = (await saida(C)).id;
    expect(await abrirLancamento(C.ctx, C.tenant, sem, deps)).toMatchObject({ id: sem, paciente: null, situacao: 'em_atraso' });
    expect(await leituras(C.tenantId)).toEqual([]);
    expect(await abrirLancamento(C.ctx, C.tenant, com, deps)).toMatchObject({ id: com, paciente: { id: C.p, nome: 'Ana Souza', bloqueado: false, anonimizado: false } });
    expect(await leituras(C.tenantId)).toEqual([{ acao: 'ler', entidade: 'financeiro', entidade_id: com, patient_id: C.p, actor_user_id: C.nutriId }]);
    expect(await abrirLancamento(C.ctx, C.tenant, 'nao-e-uuid', deps)).toBeNull();
  });

  it('paciente bloqueado e paciente anonimizado: o anonimizado não conta como bloqueado (TRI-17-20 #130)', async () => {
    const C = await cenario();
    const doBloqueado = (await entrada(C)).id;
    const davi = (await novoPaciente(app.db, C.ctx, { nome: 'Davi Reis' })).id;
    const doAnonimizado = (await entrada(C, { pacienteId: davi })).id;
    await bloquear(C);
    await anonimizar(C, davi);
    await owner.pool.query('update patients set anonimizado_em = now() where id = $1', [davi]);
    expect((await abrirLancamento(C.ctx, C.tenant, doBloqueado, deps))?.paciente).toMatchObject({ bloqueado: true, anonimizado: false });
    expect(await abrirLancamento(C.ctx, C.tenant, doAnonimizado, deps)).toMatchObject({ anonimizado: true, paciente: { id: davi, bloqueado: false, anonimizado: true } });
  });

  it('só a sessão nutri: a de paciente recebe o erro do assert (não uma lista vazia)', async () => {
    const C = await cenario();
    const { id } = await entrada(C);
    const pac = ctxPaciente(C.tenantId, C.p);
    const assert = 'financeiro: só a sessão nutri';
    await expect(listarLancamentos(pac, C.tenant, {}, deps)).rejects.toThrow(assert);
    await expect(abrirLancamento(pac, C.tenant, id, deps)).rejects.toThrow(assert);
    await expect(criarLancamento(pac, C.tenant, {}, deps)).rejects.toThrow(assert);
    await expect(editarLancamento(pac, C.tenant, id, {}, deps)).rejects.toThrow(assert);
    await expect(marcarRecebido(pac, C.tenant, id, { pagoEm: '2026-11-17', forma: 'pix' }, deps)).rejects.toThrow(assert);
    await expect(desfazerRecebimento(pac, id, deps)).rejects.toThrow(assert);
    await expect(cancelarLancamento(pac, id, 'x', deps)).rejects.toThrow(assert);
    await expect(pacientesParaLancamento(pac, deps)).rejects.toThrow(assert);
    await expect(listarLancamentos(worker(C), C.tenant, {}, deps)).rejects.toThrow(assert);
  });

  it('outro consultório não vê a lista', async () => {
    const A = await cenario();
    await entrada(A);
    const B = await cenario();
    const r = await listarLancamentos(B.ctx, B.tenant, { pacienteId: A.p }, deps);
    expect(r.linhas).toEqual([]);
    expect(r.totais).toEqual({ entradas: { recebido: 0, aReceber: 0 }, saidas: { pago: 0, aPagar: 0 } });
    expect(await leituras(B.tenantId)).toEqual([]);
  });
});

describe('pacientesParaLancamento (F-D28)', () => {
  it('ativos e arquivados, sem bloqueados nem anonimizados, por nome', async () => {
    const C = await cenario();
    const carla = (await novoPaciente(app.db, C.ctx, { nome: 'Carla Dias', status: 'arquivado' })).id;
    const bruno = (await novoPaciente(app.db, C.ctx, { nome: 'Bruno Lima' })).id;
    await bloquear(C, bruno);
    expect(await pacientesParaLancamento(C.ctx, deps)).toEqual([
      { id: C.p, nome: 'Ana Souza', arquivado: false },
      { id: carla, nome: 'Carla Dias', arquivado: true },
    ]);
  });
});

describe('pacienteDoFinanceiro (chip da lista, pré-seleção do formulário)', () => {
  it('nome e bloqueio do paciente do consultório; anonimizado não conta como bloqueado; de outro consultório ou id inválido → null; sem leitura auditada', async () => {
    const C = await cenario();
    const bruno = (await novoPaciente(app.db, C.ctx, { nome: 'Bruno Lima' })).id;
    const davi = (await novoPaciente(app.db, C.ctx, { nome: 'Davi Reis' })).id;
    await bloquear(C, bruno);
    await bloquear(C, davi);
    await owner.pool.query('update patients set anonimizado_em = now() where id = $1', [davi]);
    const B = await cenario();
    expect(await pacienteDoFinanceiro(C.ctx, C.p, deps)).toEqual({ id: C.p, nome: 'Ana Souza', bloqueado: false, anonimizado: false });
    expect(await pacienteDoFinanceiro(C.ctx, bruno, deps)).toEqual({ id: bruno, nome: 'Bruno Lima', bloqueado: true, anonimizado: false });
    expect(await pacienteDoFinanceiro(C.ctx, davi, deps)).toMatchObject({ id: davi, bloqueado: false, anonimizado: true });
    expect(await pacienteDoFinanceiro(C.ctx, B.p, deps)).toBeNull();
    expect(await pacienteDoFinanceiro(C.ctx, 'nao-e-uuid', deps)).toBeNull();
    expect(await leituras(C.tenantId)).toEqual([]);
  });
});

describe('Plano 18 (D7, RN-266): o nome de exibição nas telas do Financeiro; o CSV com o nome civil', () => {
  it('com nome social, seletor, chip, lista, detalhe e pendências mostram o nome social (na ordem dele); sem, o civil; o CSV sai com o nome civil', async () => {
    const C = await cenario(); // Ana Souza
    await withTenant(C.ctx, (tx) => gravarCadastro(tx, { tenantId: C.tenantId, patientId: C.p, valor: { nomeSocial: 'Joana Souza' } }), app.db);
    const bia = (await novoPaciente(app.db, C.ctx, { nome: 'Bia Lima' })).id;
    const { id } = await entrada(C, { vencimento: '2026-11-10' });
    await entrada(C, { vencimento: '2026-11-12', pacienteId: bia });

    // seletor do formulário: pelo nome de exibição e na ordem dele (Joana depois de Bia; pelo civil, Ana viria antes)
    expect(await pacientesParaLancamento(C.ctx, deps)).toEqual([
      { id: bia, nome: 'Bia Lima', arquivado: false },
      { id: C.p, nome: 'Joana Souza', arquivado: false },
    ]);
    expect((await pacienteDoFinanceiro(C.ctx, C.p, deps))?.nome).toBe('Joana Souza'); // chip "Paciente: {nome}"
    expect((await pacienteDoFinanceiro(C.ctx, bia, deps))?.nome).toBe('Bia Lima');
    const lista = await listarLancamentos(C.ctx, C.tenant, {}, deps);
    expect(lista.linhas.map((l) => l.paciente?.nome).sort()).toEqual(['Bia Lima', 'Joana Souza']);
    expect((await abrirLancamento(C.ctx, C.tenant, id, deps))?.paciente?.nome).toBe('Joana Souza');
    expect((await pagamentosPendentes(C.ctx, C.tenant, deps)).map((p) => p.paciente.nome)).toEqual(['Joana Souza', 'Bia Lima']);
    expect((await pendenciasDoPaciente(C.ctx, C.tenant, C.p, deps))?.paciente.nome).toBe('Joana Souza');

    // o CSV para o contador: documento fiscal, nome civil (nunca o social)
    const { csv } = await exportarLancamentosCsv(C.ctx, C.tenant, { de: '2026-11-01', ate: '2026-11-30', comPacientes: true }, deps);
    expect(csv).toContain('Ana Souza');
    expect(csv).toContain('Bia Lima');
    expect(csv).not.toContain('Joana Souza');
  });
});

describe('Plano 23 (US-416, RN-437, AG-D12): filtro "Local" em Lançamentos e no CSV', () => {
  /**
   * Cinco lançamentos de novembro: um da consulta na Clínica Centro, um da consulta no Consultório, um de consulta antiga
   * (sem local), uma entrada sem consulta e uma saída. "Sem local" = sem consulta ou de consulta sem local.
   */
  async function comLocais() {
    const C = await cenario();
    const centro = await novoLocal(app.db, C.ctx, { nome: 'Clínica Centro' });
    const consultorio = await novoLocal(app.db, C.ctx, { nome: 'Consultório' });
    const consulta = (dia: string, localId: string | null) => consultaDireta(app.db, C.ctx, C.p, new Date(`${dia}T13:00:00Z`), 60, { localId, status: 'realizada' });
    const daConsulta = async (dia: string, valor: number, localId: string | null) => {
      const appointmentId = await consulta(dia, localId);
      const [l] = await withTenant(
        C.ctx,
        (tx) =>
          tx
            .insert(finLancamentos)
            .values({ tenantId: C.tenantId, tipo: 'entrada', categoriaId: C.consultas, valorCentavos: valor, vencimento: dia, patientId: C.p, appointmentId, criadoPor: C.nutriId })
            .returning({ id: finLancamentos.id }),
        app.db,
      );
      return l.id;
    };
    const noCentro = await daConsulta('2026-11-03', 10_000, centro);
    const noConsultorio = await daConsulta('2026-11-04', 20_000, consultorio);
    const antiga = await daConsulta('2026-11-05', 40_000, null);
    const avulsa = (await entrada(C, { valor: '800,00', vencimento: '2026-11-06' })).id;
    const aluguel = (await saida(C, { valor: '1.600,00', vencimento: '2026-11-07' })).id;
    return { C, centro, consultorio, noCentro, noConsultorio, antiga, avulsa, aluguel };
  }
  const ids = (r: { linhas: { id: string }[] }) => r.linhas.map((l) => l.id).sort();

  it('por local, só os lançamentos das consultas daquele local; "Sem local", os sem consulta e os de consulta antiga; totais do filtro', async () => {
    const { C, centro, consultorio, noCentro, noConsultorio, antiga, avulsa, aluguel } = await comLocais();
    const lista = (localId?: string) => listarLancamentos(C.ctx, C.tenant, { mes: '2026-11', localId }, deps);
    expect(ids(await lista(centro))).toEqual([noCentro]);
    expect(ids(await lista(consultorio))).toEqual([noConsultorio]);
    expect(ids(await lista(SEM_LOCAL))).toEqual([antiga, avulsa, aluguel].sort());
    expect((await lista(centro)).totais).toEqual({ entradas: { recebido: 0, aReceber: 10_000 }, saidas: { pago: 0, aPagar: 0 } });
    expect((await lista(SEM_LOCAL)).totais).toEqual({ entradas: { recebido: 0, aReceber: 120_000 }, saidas: { pago: 0, aPagar: 160_000 } });
    // sem filtro (ou com valor inválido, ignorado como os outros filtros da URL): todos
    expect(ids(await lista())).toHaveLength(5);
    expect(ids(await lista('x'))).toHaveLength(5);
    // local de outro consultório: nada (a consulta do lançamento nunca é dele)
    const B = await cenario();
    expect(ids(await lista(await novoLocal(app.db, B.ctx)))).toEqual([]);
  });

  it('combina com o paciente e com o tipo; com paciente, o mesmo "ler" de sempre (RN-318), sem leitura nova pelo local', async () => {
    const { C, centro, noCentro } = await comLocais();
    expect(ids(await listarLancamentos(C.ctx, C.tenant, { pacienteId: C.p, localId: centro }, deps))).toEqual([noCentro]);
    expect(ids(await listarLancamentos(C.ctx, C.tenant, { mes: '2026-11', tipo: 'saida', localId: centro }, deps))).toEqual([]);
    expect(await leituras(C.tenantId)).toEqual([expect.objectContaining({ entidade: 'financeiro', entidade_id: null, patient_id: C.p })]);
    await listarLancamentos(C.ctx, C.tenant, { mes: '2026-11', localId: centro }, deps);
    expect(await leituras(C.tenantId)).toHaveLength(1);
  });

  it('CSV com `localId`: só as linhas do local (ou "Sem local"), com o mesmo `exportar`; devolve o local aplicado', async () => {
    const { C, centro } = await comLocais();
    const exportar = (localId?: string) => exportarLancamentosCsv(C.ctx, C.tenant, { de: '2026-11-01', ate: '2026-11-30', comPacientes: false, localId }, deps);
    const csv = async (localId?: string) => (await exportar(localId)).csv;
    expect((await exportar(centro)).local).toEqual({ id: centro, nome: 'Clínica Centro' });
    expect((await exportar(SEM_LOCAL)).local).toEqual({ id: SEM_LOCAL, nome: 'Sem local' });
    expect((await exportar()).local).toBeNull();
    const linhas = (texto: string) => texto.split('\r\n').slice(1, -1);
    expect(linhas(await csv(centro))).toHaveLength(1);
    expect(linhas(await csv(centro))[0]).toContain('100,00');
    expect(linhas(await csv(SEM_LOCAL))).toHaveLength(3);
    expect(linhas(await csv())).toHaveLength(5);
    const exportacoes = () => contar(`select count(*)::int as n from audit_log where tenant_id = $1 and acao = 'exportar' and entidade = 'financeiro'`, C.tenantId);
    expect(await exportacoes()).toBe(7);
  });

  it('AG-D79: o local do CSV tem de ser uma das opções — de outro consultório, arquivado sem lançamento ou desconhecido → LocalDoFiltroInvalidoError, sem exportar', async () => {
    const { C } = await comLocais();
    const B = await cenario();
    const semLancamento = await novoLocal(app.db, C.ctx, { nome: 'Antiga', arquivado: true });
    for (const localId of [await novoLocal(app.db, B.ctx), semLancamento, randomUUID(), 'x'])
      await expect(exportarLancamentosCsv(C.ctx, C.tenant, { de: '2026-11-01', ate: '2026-11-30', comPacientes: false, localId }, deps)).rejects.toBeInstanceOf(
        LocalDoFiltroInvalidoError,
      );
    expect(await contar(`select count(*)::int as n from audit_log where tenant_id = $1 and acao = 'exportar'`, C.tenantId)).toBe(0);
  });

  it('AG-D79: as opções do filtro trazem os ativos e, à parte, o arquivado com lançamento ligado a consulta (o arquivado só com consulta, não)', async () => {
    const { C, centro, consultorio } = await comLocais();
    const soConsulta = await novoLocal(app.db, C.ctx, { nome: 'Só consulta' });
    await consultaDireta(app.db, C.ctx, C.p, new Date('2026-11-10T13:00:00Z'), 60, { localId: soConsulta });
    const arquivar = (id: string) => withTenant(C.ctx, (tx) => tx.execute(sql`update locais_atendimento set arquivado_em = now(), agendamento_online = false where id = ${id}`), app.db);
    await arquivar(centro);
    await arquivar(soConsulta);
    expect(await locaisParaFiltro(C.ctx, 'financeiro', { db: app.db })).toEqual({ ativos: [{ id: consultorio, nome: 'Consultório' }], arquivados: [{ id: centro, nome: 'Clínica Centro' }] });
    expect((await locaisParaFiltro(C.ctx, 'pacientes', { db: app.db })).arquivados.map((l) => l.nome)).toEqual(['Clínica Centro', 'Só consulta']);
    // o arquivado com lançamento continua filtrável no CSV
    expect((await exportarLancamentosCsv(C.ctx, C.tenant, { de: '2026-11-01', ate: '2026-11-30', comPacientes: false, localId: centro }, deps)).local?.nome).toBe('Clínica Centro');
  });
});
