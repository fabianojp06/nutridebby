import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { cincoMilLancamentos, dbQueContaConsultas } from '../../../test/financeiro';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arquivarCategoria, listarCategorias, salvarConfiguracoes } from './configuracoes';
import { cancelarLancamento, criarLancamento } from './lancamentos';
import { entradasESaidas12Meses, fluxoDeCaixaDoAno, pagamentosPendentes, pendenciasDoPaciente, resumoDoMes } from './resumo';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));

const contado = dbQueContaConsultas(inject('appDatabaseUrl'));

afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
  await contado.pool.end();
});

/** 16/11/2026, 12:00 em São Paulo. */
const agora = new Date('2026-11-16T15:00:00Z');
const deps = { db: app.db, agora };
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });

type Cenario = TenantDeTeste & { ana: string; consultas: string; outrasEntradas: string; aluguel: string; material: string; divulgacao: string };
async function cenario(saldo = { saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00' }, d = deps): Promise<Cenario> {
  const T = await novoTenant(app.db);
  await salvarConfiguracoes(T.ctx, T.tenant, { ...saldo, valorConsulta: '250,00' }, d);
  const cats = await listarCategorias(T.ctx, d);
  const id = (nome: string) => cats.find((c) => c.nome === nome)!.id;
  const ana = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  return {
    ...T,
    ana,
    consultas: id('Consultas'),
    outrasEntradas: id('Outras entradas'),
    aluguel: id('Aluguel e condomínio'),
    material: id('Material e insumos'),
    divulgacao: id('Divulgação'),
  };
}
const entrada = (C: Cenario, extra: Record<string, unknown>, d = deps) =>
  criarLancamento(C.ctx, C.tenant, { tipo: 'entrada', valor: '250,00', categoriaId: C.consultas, vencimento: '2026-11-10', pacienteId: C.ana, ...extra }, d);
const saida = (C: Cenario, extra: Record<string, unknown>, d = deps) =>
  criarLancamento(C.ctx, C.tenant, { tipo: 'saida', valor: '100,00', categoriaId: C.aluguel, vencimento: '2026-11-05', ...extra }, d);
const leituras = (tenantId: string) =>
  owner.pool
    .query(`select acao, entidade, entidade_id, patient_id, actor_user_id from audit_log where tenant_id = $1 and acao = 'ler' order by criado_em`, [tenantId])
    .then((r) => r.rows);

/** US-305 "Cartões": saldo de R$ 1.500,00 em 01/11/2026; 750 recebidos, 1.200 pagos, 500 a receber e 90 a pagar em novembro. */
async function cenarioDaUs305(): Promise<Cenario> {
  const C = await cenario();
  await entrada(C, { valor: '750,00', vencimento: '2026-11-10', pagoEm: '2026-11-10', forma: 'pix' });
  await saida(C, { valor: '1.200,00', vencimento: '2026-11-05', pagoEm: '2026-11-05', forma: 'boleto' });
  await entrada(C, { valor: '500,00', vencimento: '2026-11-20' });
  await saida(C, { valor: '90,00', categoriaId: C.material, vencimento: '2026-11-25' });
  return C;
}

describe('resumoDoMes (US-305, RN-307)', () => {
  it('US-305 "Cartões": saldo atual R$ 1.050,00 desde 01/11/2026; recebido 750, a receber 500, pago 1.200, a pagar 90', async () => {
    const C = await cenarioDaUs305();
    const r = await resumoDoMes(C.ctx, C.tenant, deps);
    expect(r).toMatchObject({
      configurado: true,
      saldoAtual: 105000,
      saldoDesde: '2026-11-01',
      semValorConsulta: false,
      entradas: { recebido: 75000, aReceber: 50000, atrasoAnterior: 0 },
      saidas: { pago: 120000, aPagar: 9000, atrasoAnterior: 0 },
      pendentes: { pacientes: 1, total: 50000 },
    });
    expect(r.ultimos).toHaveLength(4);
    expect(await leituras(C.tenantId)).toEqual([]); // RN-318: abrir o Resumo não grava "Visualizou"
  });

  it('US-305 "Atrasado de meses anteriores": saída de 300 vencida em 10/10 e entrada sem paciente de 100 vencida em 20/10', async () => {
    const C = await cenarioDaUs305();
    await saida(C, { valor: '300,00', vencimento: '2026-10-10' });
    await entrada(C, { valor: '100,00', categoriaId: C.outrasEntradas, vencimento: '2026-10-20', pacienteId: '' });
    const r = await resumoDoMes(C.ctx, C.tenant, deps);
    expect(r.entradas).toEqual({ recebido: 75000, aReceber: 50000, atrasoAnterior: 10000 });
    expect(r.saidas).toEqual({ pago: 120000, aPagar: 9000, atrasoAnterior: 30000 });
    // a entrada sem paciente não é pagamento pendente (RN-311); o saldo não muda com o que está em aberto
    expect(r.pendentes).toEqual({ pacientes: 1, total: 50000 });
    expect(r.saldoAtual).toBe(105000);
  });

  it('RN-307: cancelado fica fora de tudo; pago antes da data do saldo não muda o saldo (nem conta no mês do saldo antes dela)', async () => {
    const C = await cenario({ saldoInicialEm: '2026-11-05', saldoInicial: '1.000,00' });
    await entrada(C, { valor: '200,00', vencimento: '2026-11-04', pagoEm: '2026-11-04', forma: 'pix' }); // antes do saldo, em novembro
    await entrada(C, { valor: '300,00', vencimento: '2026-11-05', pagoEm: '2026-11-05', forma: 'pix' }); // no dia do saldo: conta
    await saida(C, { valor: '50,00', vencimento: '2026-10-30', pagoEm: '2026-10-30', forma: 'pix' }); // outubro, antes do saldo
    const cancelada = await entrada(C, { valor: '999,00', vencimento: '2026-11-06', pagoEm: '2026-11-06', forma: 'pix' });
    await cancelarLancamento(C.ctx, cancelada.id, 'Devolução', deps);
    const aberta = await saida(C, { valor: '77,00', vencimento: '2026-10-01' });
    await cancelarLancamento(C.ctx, aberta.id, 'Lançado em dobro', deps);
    const r = await resumoDoMes(C.ctx, C.tenant, deps);
    expect(r.saldoAtual).toBe(100000 + 30000);
    expect(r.saldoDesde).toBe('2026-11-05');
    // o cartão do mês é pela data de referência (RN-306): os dois recebidos de novembro contam
    expect(r.entradas).toEqual({ recebido: 50000, aReceber: 0, atrasoAnterior: 0 });
    expect(r.saidas).toEqual({ pago: 0, aPagar: 0, atrasoAnterior: 0 });
    // os cancelados aparecem nos últimos lançamentos, como na lista
    expect(r.ultimos.map((l) => l.situacao).sort()).toEqual(['cancelado', 'cancelado', 'pago', 'recebido', 'recebido']);
  });

  it('Review Focus 4 — virada do mês no fuso: às 22:30 de 30/11 em São Paulo (01/12 01:30 UTC) é novembro e hoje é 30/11', async () => {
    const C = await cenario();
    const depois = { db: app.db, agora: new Date('2026-12-01T15:00:00Z') };
    await entrada(C, { valor: '400,00', vencimento: '2026-12-01', pagoEm: '2026-12-01', forma: 'pix' }, depois);
    const venceHoje = await entrada(C, { valor: '120,00', vencimento: '2026-11-30' }, depois);
    await saida(C, { valor: '60,00', vencimento: '2026-12-01' }, depois);

    const noite = { db: app.db, agora: new Date('2026-12-01T01:30:00Z') };
    const r = await resumoDoMes(C.ctx, C.tenant, noite);
    expect(r.entradas).toEqual({ recebido: 0, aReceber: 12000, atrasoAnterior: 0 });
    expect(r.saidas).toEqual({ pago: 0, aPagar: 0, atrasoAnterior: 0 });
    // hoje = 30/11: a entrada que vence em 30/11 está prevista (no dia 01/12 estaria em atraso)
    expect(r.ultimos.find((l) => l.id === venceHoje.id)!.situacao).toBe('previsto');
    const doze = await entradasESaidas12Meses(C.ctx, C.tenant, noite);
    expect(doze.at(-1)).toEqual({ mes: '2026-11', entradas: 0, saidas: 0, resultado: 0 });

    // 00:00 de 01/12 em São Paulo: dezembro; a de 30/11 virou atraso do mês anterior
    const meiaNoite = { db: app.db, agora: new Date('2026-12-01T03:00:00Z') };
    const d = await resumoDoMes(C.ctx, C.tenant, meiaNoite);
    expect(d.entradas).toEqual({ recebido: 40000, aReceber: 0, atrasoAnterior: 12000 });
    expect(d.saidas).toEqual({ pago: 0, aPagar: 6000, atrasoAnterior: 0 });
    expect(d.ultimos.find((l) => l.id === venceHoje.id)!.situacao).toBe('em_atraso');
    expect((await entradasESaidas12Meses(C.ctx, C.tenant, meiaNoite)).at(-1)).toEqual({ mes: '2026-12', entradas: 40000, saidas: 0, resultado: 40000 });
  });

  it('últimos lançamentos: os 10 lançados por último, o mais novo primeiro, com categoria e paciente', async () => {
    const C = await cenario();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const quando = { db: app.db, agora: new Date(agora.getTime() - (12 - i) * 60_000) };
      ids.push((await entrada(C, { valor: `${i + 1},00`, vencimento: `2026-11-${String(12 - i).padStart(2, '0')}` }, quando)).id);
    }
    const r = await resumoDoMes(C.ctx, C.tenant, deps);
    expect(r.ultimos.map((l) => l.id)).toEqual(ids.slice(2).reverse());
    expect(r.ultimos[0]).toMatchObject({
      tipo: 'entrada',
      categoria: { id: C.consultas, nome: 'Consultas' },
      valorCentavos: 1200,
      paciente: { id: C.ana, nome: 'Ana Souza', bloqueado: false, anonimizado: false },
      situacao: 'em_atraso',
    });
  });

  it('sem configuração: configurado falso, sem saldo; sem valor da consulta: semValorConsulta', async () => {
    const T = await novoTenant(app.db);
    expect(await resumoDoMes(T.ctx, T.tenant, deps)).toEqual({
      configurado: false,
      saldoAtual: null,
      saldoDesde: null,
      semValorConsulta: false,
      entradas: { recebido: 0, aReceber: 0, atrasoAnterior: 0 },
      saidas: { pago: 0, aPagar: 0, atrasoAnterior: 0 },
      pendentes: { pacientes: 0, total: 0 },
      ultimos: [],
    });
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '-320,00', valorConsulta: '' }, deps);
    expect(await resumoDoMes(T.ctx, T.tenant, deps)).toMatchObject({ configurado: true, saldoAtual: -32000, saldoDesde: '2026-11-01', semValorConsulta: true });
  });

  it('isolamento: só o consultório da sessão', async () => {
    const A = await cenarioDaUs305();
    const B = await cenario();
    const r = await resumoDoMes(B.ctx, B.tenant, deps);
    expect(r).toMatchObject({ saldoAtual: 150000, entradas: { recebido: 0, aReceber: 0 }, pendentes: { pacientes: 0, total: 0 }, ultimos: [] });
    expect((await resumoDoMes(A.ctx, A.tenant, deps)).saldoAtual).toBe(105000);
  });
});

describe('fluxoDeCaixaDoAno (US-306) e entradasESaidas12Meses', () => {
  /** Saldo de R$ 1.000,00 em 10/11/2026 (no meio do mês); hoje 15/01/2027. */
  async function cenarioDoFluxo(): Promise<Cenario> {
    const d = { db: app.db, agora: new Date('2027-01-15T15:00:00Z') };
    const C = await cenario({ saldoInicialEm: '2026-11-10', saldoInicial: '1.000,00' }, d);
    await saida(C, { valor: '50,00', categoriaId: C.material, vencimento: '2026-10-20', pagoEm: '2026-10-20', forma: 'pix' }, d);
    await entrada(C, { valor: '300,00', vencimento: '2026-11-05', pagoEm: '2026-11-05', forma: 'pix' }, d); // antes do saldo
    await entrada(C, { valor: '250,00', vencimento: '2026-11-10', pagoEm: '2026-11-10', forma: 'pix' }, d); // no dia do saldo
    await saida(C, { valor: '400,00', vencimento: '2026-11-12', pagoEm: '2026-11-12', forma: 'pix' }, d);
    await entrada(C, { valor: '500,00', categoriaId: C.outrasEntradas, pacienteId: '', vencimento: '2026-12-03', pagoEm: '2026-12-03', forma: 'dinheiro' }, d);
    await saida(C, { valor: '100,00', vencimento: '2026-12-20', pagoEm: '2026-12-20', forma: 'pix' }, d);
    // previstos e cancelados não entram no fluxo
    await entrada(C, { valor: '777,00', vencimento: '2026-12-10' }, d);
    const cancelada = await entrada(C, { valor: '888,00', vencimento: '2026-12-11', pagoEm: '2026-12-11', forma: 'pix' }, d);
    await cancelarLancamento(C.ctx, cancelada.id, 'Devolução', d);
    // arquivada sem movimento no ano some; arquivada com movimento fica
    await arquivarCategoria(C.ctx, C.divulgacao, d);
    await arquivarCategoria(C.ctx, C.material, d);
    return C;
  }
  const d2027 = { db: app.db, agora: new Date('2027-01-15T15:00:00Z') };
  const mes = (i: number, v: number) => Array.from({ length: 12 }, (_, j) => (j === i ? v : 0));
  const zeros = Array(12).fill(0);
  const nulos = (n: number) => Array(n).fill(null);

  it('2026: linhas por categoria, totais, resultado; no mês do saldo o início é "—" e o fim = saldo + movimentos desde a data', async () => {
    const C = await cenarioDoFluxo();
    const f = await fluxoDeCaixaDoAno(C.ctx, C.tenant, 2026, d2027);
    expect(f.ano).toBe(2026);
    expect(f.meses).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    expect(f.categoriasEntrada).toEqual([
      { categoria: 'Consultas', valores: mes(10, 55000) },
      { categoria: 'Outras entradas', valores: mes(11, 50000) },
    ]);
    const saidas = Object.fromEntries(f.categoriasSaida.map((c) => [c.categoria, c.valores]));
    expect(saidas['Aluguel e condomínio']).toEqual([...zeros.slice(0, 10), 40000, 10000]);
    expect(saidas['Material e insumos']).toEqual(mes(9, 5000));
    expect(saidas).not.toHaveProperty('Divulgação');
    expect(f.categoriasSaida).toHaveLength(9);
    expect(f.totalEntradas).toEqual([...zeros.slice(0, 10), 55000, 50000]);
    expect(f.totalSaidas).toEqual([...zeros.slice(0, 9), 5000, 40000, 10000]);
    expect(f.resultado).toEqual([...zeros.slice(0, 9), -5000, 15000, 40000]);
    expect(f.saldoInicio).toEqual([...nulos(11), 85000]);
    expect(f.saldoFim).toEqual([...nulos(10), 100000 + 25000 - 40000, 85000 + 40000]);
    expect(f.saldoDesde).toBe('2026-11-10');
    expect(await leituras(C.tenantId)).toEqual([]); // RN-318: relatórios sem "Visualizou"
  });

  it('o saldo segue nos anos seguintes (início = fim anterior) e é nulo nos anteriores', async () => {
    const C = await cenarioDoFluxo();
    const f27 = await fluxoDeCaixaDoAno(C.ctx, C.tenant, 2027, d2027);
    expect(f27.saldoInicio).toEqual(Array(12).fill(125000));
    expect(f27.saldoFim).toEqual(Array(12).fill(125000));
    expect(f27.totalEntradas).toEqual(zeros);
    expect(f27.categoriasSaida.map((c) => c.categoria)).not.toContain('Material e insumos');
    const f25 = await fluxoDeCaixaDoAno(C.ctx, C.tenant, 2025, d2027);
    expect(f25.saldoInicio).toEqual(nulos(12));
    expect(f25.saldoFim).toEqual(nulos(12));
    expect(f25.resultado).toEqual(zeros);
  });

  it('sem configuração: saldo nulo em todos os meses', async () => {
    const T = await novoTenant(app.db);
    const f = await fluxoDeCaixaDoAno(T.ctx, T.tenant, 2026, deps);
    expect(f).toMatchObject({ ano: 2026, categoriasEntrada: [], categoriasSaida: [], saldoInicio: nulos(12), saldoFim: nulos(12), saldoDesde: null });
  });

  it('ano fora da faixa é erro de programação (a rota valida antes)', async () => {
    const C = await cenario();
    await expect(fluxoDeCaixaDoAno(C.ctx, C.tenant, 1999, deps)).rejects.toThrow(RangeError);
    await expect(fluxoDeCaixaDoAno(C.ctx, C.tenant, 2026.5, deps)).rejects.toThrow(RangeError);
  });

  it('12 meses: do mesmo mês do ano anterior ao atual, só recebidos e pagos, inclusive antes do saldo', async () => {
    const C = await cenarioDoFluxo();
    const r = await entradasESaidas12Meses(C.ctx, C.tenant, d2027);
    expect(r.map((m) => m.mes)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
    expect(r.slice(8)).toEqual([
      { mes: '2026-10', entradas: 0, saidas: 5000, resultado: -5000 },
      { mes: '2026-11', entradas: 55000, saidas: 40000, resultado: 15000 },
      { mes: '2026-12', entradas: 50000, saidas: 10000, resultado: 40000 },
      { mes: '2027-01', entradas: 0, saidas: 0, resultado: 0 },
    ]);
    expect(await leituras(C.tenantId)).toEqual([]);
  });
});

describe('pagamentosPendentes e pendenciasDoPaciente (US-304, RN-311, RN-318)', () => {
  async function cenarioDasPendencias() {
    const C = await cenario();
    const bruno = (await novoPaciente(app.db, C.ctx, { nome: 'Bruno Lima' })).id;
    const dora = (await novoPaciente(app.db, C.ctx, { nome: 'Dora Reis' })).id;
    const edu = (await novoPaciente(app.db, C.ctx, { nome: 'Edu Prado' })).id;
    const carla = (await novoPaciente(app.db, C.ctx, { nome: 'Carla Dias' })).id;
    const a2 = await entrada(C, { valor: '250,00', vencimento: '2026-11-10' });
    const a1 = await entrada(C, { valor: '250,00', vencimento: '2026-10-10' });
    await entrada(C, { valor: '90,00', vencimento: '2026-10-01', pagoEm: '2026-10-01', forma: 'pix' }); // recebida: fora
    await entrada(C, { valor: '250,00', vencimento: '2026-11-26', pacienteId: bruno }); // US-304 "Cobrança futura": daqui a 10 dias
    await entrada(C, { valor: '180,00', vencimento: '2026-10-01', pacienteId: dora });
    await entrada(C, { valor: '200,00', vencimento: '2026-11-16', pacienteId: edu }); // vence hoje: prevista
    const cancelada = await entrada(C, { valor: '300,00', vencimento: '2026-09-01', pacienteId: carla });
    await cancelarLancamento(C.ctx, cancelada.id, 'Cobrança errada', deps);
    await entrada(C, { valor: '100,00', categoriaId: C.outrasEntradas, vencimento: '2026-09-01', pacienteId: '' }); // sem paciente: fora
    return { C, bruno, dora, edu, carla, a1, a2 };
  }

  it('US-304: agrupadas por paciente, ordem da mais antiga, selo de atraso; a cobrança futura conta como prevista', async () => {
    const { C, bruno, dora, edu } = await cenarioDasPendencias();
    expect(await pagamentosPendentes(C.ctx, C.tenant, deps)).toEqual([
      { paciente: { id: dora, nome: 'Dora Reis' }, total: 18000, quantidade: 1, maisAntiga: '2026-10-01', emAtraso: true },
      { paciente: { id: C.ana, nome: 'Ana Souza' }, total: 50000, quantidade: 2, maisAntiga: '2026-10-10', emAtraso: true },
      { paciente: { id: edu, nome: 'Edu Prado' }, total: 20000, quantidade: 1, maisAntiga: '2026-11-16', emAtraso: false },
      { paciente: { id: bruno, nome: 'Bruno Lima' }, total: 25000, quantidade: 1, maisAntiga: '2026-11-26', emAtraso: false },
    ]);
    expect(await leituras(C.tenantId)).toEqual([]); // RN-318: a lista não grava "Visualizou"
    expect((await resumoDoMes(C.ctx, C.tenant, deps)).pendentes).toEqual({ pacientes: 4, total: 113000 });
  });

  it('paciente bloqueado continua na lista (as cobranças em aberto continuam valendo, RN-315)', async () => {
    const { C } = await cenarioDasPendencias();
    await withTenant(worker(C), (tx) => tx.execute(sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${C.ana}`), app.db);
    expect((await pagamentosPendentes(C.ctx, C.tenant, deps)).map((p) => p.paciente.nome)).toContain('Ana Souza');
    const d = await pendenciasDoPaciente(C.ctx, C.tenant, C.ana, deps);
    expect(d!.paciente).toEqual({ id: C.ana, nome: 'Ana Souza', bloqueado: true, anonimizado: false });
    expect(d!.linhas.every((l) => l.paciente?.bloqueado)).toBe(true);
  });

  it('detalhe do paciente anonimizado: sem pendência e não conta como bloqueado (TRI-17-20 #130)', async () => {
    const { C } = await cenarioDasPendencias();
    await withTenant(worker(C), (tx) => tx.execute(sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2020-01-01' where id = ${C.ana}`), app.db);
    await withTenant(worker(C), (tx) => tx.execute(sql`select app_anonimizar_financeiro(${C.ana})`), app.db);
    await withTenant(worker(C), (tx) => tx.execute(sql`update patients set anonimizado_em = now() where id = ${C.ana}`), app.db);
    const d = await pendenciasDoPaciente(C.ctx, C.tenant, C.ana, deps);
    expect(d!.paciente).toMatchObject({ id: C.ana, bloqueado: false, anonimizado: true });
    expect(d!.linhas).toEqual([]); // a anonimização cancelou as cobranças em aberto
  });

  it('detalhe: as cobranças em aberto do paciente, a mais antiga primeiro, e UM "ler" por abertura', async () => {
    const { C, a1, a2 } = await cenarioDasPendencias();
    const d = await pendenciasDoPaciente(C.ctx, C.tenant, C.ana, deps);
    expect(d!.paciente).toEqual({ id: C.ana, nome: 'Ana Souza', bloqueado: false, anonimizado: false });
    expect(d!.linhas.map((l) => [l.id, l.vencimento, l.situacao])).toEqual([
      [a1.id, '2026-10-10', 'em_atraso'],
      [a2.id, '2026-11-10', 'em_atraso'],
    ]);
    const ler = { acao: 'ler', entidade: 'financeiro', entidade_id: null, patient_id: C.ana, actor_user_id: C.nutriId };
    expect(await leituras(C.tenantId)).toEqual([ler]);
    await pendenciasDoPaciente(C.ctx, C.tenant, C.ana, deps);
    expect(await leituras(C.tenantId)).toEqual([ler, ler]);
  });

  it('detalhe sem pendência: o paciente sem linhas e sem "ler"; id inválido ou de outro consultório: null', async () => {
    const { C, carla } = await cenarioDasPendencias();
    expect(await pendenciasDoPaciente(C.ctx, C.tenant, carla, deps)).toEqual({ paciente: { id: carla, nome: 'Carla Dias', bloqueado: false, anonimizado: false }, linhas: [] });
    expect(await pendenciasDoPaciente(C.ctx, C.tenant, 'nao-e-uuid', deps)).toBeNull();
    const B = await cenario();
    expect(await pendenciasDoPaciente(B.ctx, B.tenant, C.ana, deps)).toBeNull();
    expect(await pagamentosPendentes(B.ctx, B.tenant, deps)).toEqual([]);
    expect(await leituras(C.tenantId)).toEqual([]);
    expect(await leituras(B.tenantId)).toEqual([]);
  });
});

describe('RN-300: só a sessão nutri', () => {
  it('paciente e worker são recusados antes da transação, em todas as funções', async () => {
    const C = await cenario();
    for (const ctx of [ctxPaciente(C.tenantId, C.ana), worker(C)]) {
      await expect(resumoDoMes(ctx, C.tenant, deps)).rejects.toThrow('só a sessão nutri');
      await expect(fluxoDeCaixaDoAno(ctx, C.tenant, 2026, deps)).rejects.toThrow('só a sessão nutri');
      await expect(entradasESaidas12Meses(ctx, C.tenant, deps)).rejects.toThrow('só a sessão nutri');
      await expect(pagamentosPendentes(ctx, C.tenant, deps)).rejects.toThrow('só a sessão nutri');
      await expect(pendenciasDoPaciente(ctx, C.tenant, C.ana, deps)).rejects.toThrow('só a sessão nutri');
    }
  });
});

describe('RNF-301: uma transação e um número fixo de consultas, sem N+1', () => {
  /** As consultas de cada função, por tipo: BEGIN/COMMIT e o resto. */
  async function medir(T: TenantDeTeste, paciente: string) {
    const d = { db: contado.db, agora };
    const uma = async (f: () => Promise<unknown>) => {
      contado.consultas.length = 0;
      await f();
      const c = contado.consultas.map((q) => q.trim().toLowerCase());
      return { transacoes: c.filter((q) => q.startsWith('begin')).length, consultas: c.length };
    };
    return {
      resumo: await uma(() => resumoDoMes(T.ctx, T.tenant, d)),
      fluxo: await uma(() => fluxoDeCaixaDoAno(T.ctx, T.tenant, 2026, d)),
      doze: await uma(() => entradasESaidas12Meses(T.ctx, T.tenant, d)),
      pendentes: await uma(() => pagamentosPendentes(T.ctx, T.tenant, d)),
      pendenciasDoPaciente: await uma(() => pendenciasDoPaciente(T.ctx, T.tenant, paciente, d)),
    };
  }

  it('com 5.000 lançamentos no ano, as mesmas consultas que com 3', { timeout: 180_000 }, async () => {
    const cheio = await novoTenant(app.db);
    await cincoMilLancamentos(app.db, cheio, agora);
    const n = await owner.pool.query('select count(*)::int as n, count(*) filter (where cancelado_em is null and pago_em is null and patient_id is not null)::int as abertas from fin_lancamentos where tenant_id = $1', [cheio.tenantId]);
    expect(n.rows[0].n).toBe(5000);
    expect(n.rows[0].abertas).toBeGreaterThan(100);
    // o paciente com mais cobranças em aberto: o detalhe devolve linhas (e grava o "ler")
    const maisPendente = await owner.pool.query(
      'select patient_id from fin_lancamentos where tenant_id = $1 and cancelado_em is null and pago_em is null and patient_id is not null group by patient_id order by count(*) desc limit 1',
      [cheio.tenantId],
    );

    const pouco = await cenario();
    await entrada(pouco, { valor: '250,00', vencimento: '2026-10-10' });
    await entrada(pouco, { valor: '250,00', vencimento: '2026-11-10', pagoEm: '2026-11-10', forma: 'pix' });
    await saida(pouco, { valor: '90,00', vencimento: '2026-11-25' });

    const grande = await medir(cheio, maisPendente.rows[0].patient_id);
    const pequeno = await medir(pouco, pouco.ana);
    expect(grande).toEqual(pequeno);
    for (const m of Object.values(grande)) expect(m.transacoes).toBe(1);
    // BEGIN, set_config do withTenant e COMMIT + as consultas de cada função
    expect(grande).toEqual({
      resumo: { transacoes: 1, consultas: 3 + 3 }, // configuração, agregados, últimos
      fluxo: { transacoes: 1, consultas: 3 + 3 }, // configuração, categorias × meses, saldo antes do ano e no mês do saldo
      doze: { transacoes: 1, consultas: 3 + 1 },
      pendentes: { transacoes: 1, consultas: 3 + 1 },
      pendenciasDoPaciente: { transacoes: 1, consultas: 3 + 3 }, // paciente, linhas, auditRead
    });
  });
});
