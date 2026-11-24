import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, SP } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, consultations, mealPlans, patientCadastro, patients } from '@/db/schema';
import type { Db, Tx } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { listarCategorias, salvarConfiguracoes } from '@/modules/financeiro/configuracoes';
import { cancelarLancamento, criarLancamento } from '@/modules/financeiro/lancamentos';
import { RelatorioSemPermissaoError, type Acesso } from './acesso';
import { relatorioAgenda, taxaDeFaltas } from './agenda';
import { relatorioAtendimentos } from './atendimentos';
import { relatorioFinanceiro } from './financeiro';
import { relatorioPacientes } from './pacientes';
import { periodoDaUrl, type Periodo } from './periodo';
import { relatorioPlanos } from './planos';
import { relatorioRanking } from './ranking';
import { exportacaoNaLeitura } from './registro';

const app = makeDb(inject('appDatabaseUrl'));
/** Dono do banco: só para semear o pedido `solicitada` do Plano 23 (que só nasce na sessão do paciente ou na página pública). */
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

/** 17/11/2026, 10:00 em São Paulo (o relógio do servidor é UTC). */
const agora = new Date('2026-11-17T13:00:00Z');
const deps = { db: app.db, agora };
const NUTRI: Acesso = { papel: 'nutri', financeiro: true };
const o = { localId: null, acesso: NUTRI };
const tenant = { fuso: SP };

/** O período como a tela o lê da URL (sem erro). */
function periodo(de: string, ate: string): Periodo {
  const r = periodoDaUrl(new URLSearchParams({ de, ate }), '2026-11-17', SP);
  expect(r.erro).toBeNull();
  return r.periodo;
}
const PADRAO = periodoDaUrl(new URLSearchParams(), '2026-11-17', SP).periodo; // 2025-12 a 2026-11

type NovoPaciente = Partial<typeof patients.$inferInsert>;
/** Pacientes gravados direto pela sessão da nutricionista (a situação e as datas do cenário), na ordem da lista. */
async function pacientes(T: TenantDeTeste, lista: NovoPaciente[]): Promise<string[]> {
  const linhas = await withTenant(
    T.ctx,
    (tx) =>
      tx
        .insert(patients)
        .values(lista.map((x, i) => ({ tenantId: T.tenantId, nome: `Paciente ${i}`, dataNascimento: '1990-06-15', sexo: 'F', email: `p-${randomUUID().slice(0, 8)}@ex.com`, ...x })))
        .returning({ id: patients.id }),
    app.db,
  );
  return linhas.map((l) => l.id);
}
const um = async (T: TenantDeTeste, x: NovoPaciente = {}) => (await pacientes(T, [x]))[0];
const vezes = (n: number, x: NovoPaciente): NovoPaciente[] => Array.from({ length: n }, () => ({ ...x }));
const ANONIMIZADO: NovoPaciente = { status: 'bloqueado', anonimizadoEm: new Date('2026-06-01T12:00:00Z') };

/** Consulta de 60 min; `extra` com a situação final (cancelada leva quem cancelou e quando). */
const consulta = (T: TenantDeTeste, patientId: string, inicio: Date, extra: Parameters<typeof consultaDireta>[5] = {}) => consultaDireta(app.db, T.ctx, patientId, inicio, 60, extra);
const cancelada = (por: 'paciente' | 'nutri' | 'sistema') => ({ status: 'cancelada', canceladoPor: por, canceladaEm: new Date('2026-10-01T12:00:00Z') });
const atendimento = (T: TenantDeTeste, patientId: string, data: string, appointmentId: string | null = null) =>
  withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId, data, appointmentId }), app.db);

/** Linhas do `audit_log` do consultório, lidas dentro de `withTenant` na sessão da nutricionista (a RLS esconderia fora). */
const linhasDoLog = (T: TenantDeTeste) =>
  withTenant(T.ctx, async (tx) => (await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(eq(auditLog.tenantId, T.tenantId)))[0].n, app.db);
/** As linhas da entidade `relatorios`, lidas dentro de `withTenant` como `linhasDoLog`. */
const exportacoes = (T: TenantDeTeste) =>
  withTenant(
    T.ctx,
    (tx) =>
      tx
        .select({ acao: auditLog.acao, entidadeId: auditLog.entidadeId, patientId: auditLog.patientId })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, T.tenantId), eq(auditLog.entidade, 'relatorios'))),
    app.db,
  );

describe('relatorioPacientes (US-480, RN-483 a RN-487)', () => {
  let T: TenantDeTeste;
  beforeAll(async () => {
    T = await novoTenant(app.db);
    const antigo = new Date('2025-06-01T15:00:00Z');
    await pacientes(T, [
      // 40 ativos: idades em anos completos em 17/11/2026
      { dataNascimento: '2001-05-01', sexo: 'F', createdAt: antigo }, // 25
      { dataNascimento: '1981-01-10', sexo: 'M', createdAt: antigo }, // 45
      { dataNascimento: '1956-11-17', sexo: 'F', createdAt: antigo }, // 70 (aniversário hoje: conta)
      { dataNascimento: '1966-11-18', sexo: 'M', createdAt: antigo }, // 59 (faz 60 amanhã)
      { dataNascimento: null, sexo: null, origem: 'agendamento_publico', createdAt: new Date('2025-12-10T15:00:00Z') }, // sem data
      { dataNascimento: '2010-01-01', sexo: 'M', createdAt: antigo }, // 16: "Menos de 18" (dado antigo)
      { dataNascimento: '1990-06-15', sexo: 'F', createdAt: new Date('2026-01-15T15:00:00Z') },
      { dataNascimento: '1990-06-15', sexo: 'F', createdAt: new Date('2026-01-15T16:00:00Z') },
      // 30/11/2025 às 23:30 em São Paulo (01/12 em UTC): novembro de 2025, fora do período
      { dataNascimento: '1990-06-15', sexo: 'M', createdAt: new Date('2025-12-01T02:30:00Z') },
      ...vezes(26, { sexo: 'F', createdAt: antigo }),
      ...vezes(5, { sexo: 'M', createdAt: antigo }),
      // 8 arquivados (um criado em 31/12/2025 às 23:00 em São Paulo: dezembro, não janeiro)
      { status: 'arquivado', createdAt: new Date('2026-01-01T02:00:00Z') },
      ...vezes(7, { status: 'arquivado', createdAt: antigo }),
      // 2 bloqueados, 1 anonimizado
      { status: 'bloqueado', createdAt: new Date('2026-01-20T15:00:00Z') },
      { status: 'bloqueado', createdAt: antigo },
      { ...ANONIMIZADO, dataNascimento: null, sexo: null, createdAt: new Date('2025-12-20T15:00:00Z') },
    ]);
  });

  it('situação: 40 ativos, 8 arquivados, 2 bloqueados, total 50 (o anonimizado fora)', async () => {
    const r = await relatorioPacientes(T.ctx, tenant, PADRAO, o, deps);
    expect(r.situacao).toEqual({ ativos: 40, arquivados: 8, bloqueados: 2, total: 50 });
  });

  it('sexo dos ativos: Feminino, Masculino, Não informado (sempre as três linhas)', async () => {
    const r = await relatorioPacientes(T.ctx, tenant, PADRAO, o, deps);
    expect(r.sexo).toEqual([
      { rotulo: 'Feminino', n: 30 },
      { rotulo: 'Masculino', n: 9 },
      { rotulo: 'Não informado', n: 1 },
    ]);
  });

  it('fase da vida em anos completos hoje no fuso, "Menos de 18" só com dado antigo; faixas de 18 em diante', async () => {
    const r = await relatorioPacientes(T.ctx, tenant, PADRAO, o, deps);
    expect(r.fase).toEqual([
      { rotulo: 'Menos de 18', n: 1 },
      { rotulo: 'Adultos (18 a 59 anos)', n: 37 },
      { rotulo: 'Pessoas idosas (60 anos ou mais)', n: 1 },
      { rotulo: 'Sem data de nascimento', n: 1 },
    ]);
    expect(r.faixas).toEqual([
      { rotulo: '18 a 29', n: 1 },
      { rotulo: '30 a 39', n: 34 },
      { rotulo: '40 a 49', n: 1 },
      { rotulo: '50 a 59', n: 1 },
      { rotulo: '60 ou mais', n: 1 },
    ]);
    // um dia depois, quem fazia 60 amanhã já é pessoa idosa
    const amanha = await relatorioPacientes(T.ctx, tenant, PADRAO, o, { db: app.db, agora: new Date('2026-11-18T13:00:00Z') });
    expect(amanha.fase.find((f) => f.rotulo.startsWith('Pessoas idosas'))!.n).toBe(2);
  });

  it('novos por mês: uma linha por mês do período, pela data do cadastro no fuso, com todas as situações e o anonimizado', async () => {
    const r = await relatorioPacientes(T.ctx, tenant, PADRAO, o, deps);
    expect(r.novosPorMes.map((l) => l.mes)).toEqual(PADRAO.meses);
    const n = Object.fromEntries(r.novosPorMes.map((l) => [l.mes, l.n]));
    expect(n['2025-12']).toBe(3); // ativo sem data, arquivado de 31/12 às 23:00, anonimizado
    expect(n['2026-01']).toBe(3); // dois ativos e o bloqueado
    expect(r.novosPorMes.reduce((s, l) => s + l.n, 0)).toBe(6);
  });

  it('consultório sem pacientes: tudo zero, as linhas fixas presentes (a tela mostra "—" nos percentuais)', async () => {
    const V = await novoTenant(app.db);
    const r = await relatorioPacientes(V.ctx, tenant, PADRAO, o, deps);
    expect(r.situacao).toEqual({ ativos: 0, arquivados: 0, bloqueados: 0, total: 0 });
    expect(r.sexo.map((l) => l.n)).toEqual([0, 0, 0]);
    expect(r.fase.map((l) => l.rotulo)).toEqual(['Adultos (18 a 59 anos)', 'Pessoas idosas (60 anos ou mais)', 'Sem data de nascimento']);
    expect(r.novosPorMes.every((l) => l.n === 0)).toBe(true);
  });

  it('só o consultório da sessão', async () => {
    const V = await novoTenant(app.db);
    await um(V, { status: 'arquivado' });
    expect((await relatorioPacientes(V.ctx, tenant, PADRAO, o, deps)).situacao.total).toBe(1);
  });
});

describe('relatorioAtendimentos (US-481, RN-488)', () => {
  let T: TenantDeTeste;
  const P = periodo('2026-01', '2026-03');
  beforeAll(async () => {
    T = await novoTenant(app.db);
    const [ana, bruno, caio, dani, eva] = await pacientes(T, [{ nome: 'Ana' }, { nome: 'Bruno' }, { nome: 'Caio' }, { nome: 'Dani' }, { nome: 'Eva' }]);
    await consulta(T, ana, em('2026-01-10', '10:00'), { status: 'realizada' }); // primeira da vida
    const marco = await consulta(T, ana, em('2026-03-05', '10:00'), { status: 'realizada' });
    await atendimento(T, ana, '2026-03-05', marco); // o atendimento da mesma consulta
    await atendimento(T, bruno, '2026-03-12'); // sem consulta, o primeiro da vida
    await consulta(T, caio, em('2025-10-01', '10:00'), { status: 'realizada' }); // antes do período
    await atendimento(T, caio, '2026-02-03');
    await consulta(T, dani, em('2026-03-20', '10:00'), { status: 'faltou' }); // falta não é atendimento
    await consulta(T, dani, em('2026-03-21', '10:00'), { status: 'agendada' });
    await consulta(T, dani, em('2026-03-22', '10:00'), cancelada('paciente'));
    // 31/01 às 23:00 em São Paulo (01/02 em UTC): janeiro
    await consulta(T, eva, new Date('2026-02-01T02:00:00Z'), { status: 'realizada' });
    // Caio anonimizado depois: o número agregado continua contando
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizadoEm: agora }).where(eq(patients.id, caio)), app.db);
  });

  it('US-481: março com Ana (consulta realizada + atendimento no mesmo dia) e Bruno (atendimento sem consulta)', async () => {
    const r = await relatorioAtendimentos(T.ctx, tenant, P, o, deps);
    expect(r.meses.find((m) => m.mes === '2026-03')).toEqual({
      mes: '2026-03',
      atendidos: 2, // cada paciente conta uma vez no mês
      novos: 1, // Bruno
      retorno: 1, // Ana já tinha consulta realizada em janeiro
      consultasRealizadas: 1,
      atendimentosRegistrados: 2,
    });
  });

  it('janeiro (Ana e Eva, no fuso) e fevereiro (Caio, em retorno e anonimizado), uma linha por mês', async () => {
    const r = await relatorioAtendimentos(T.ctx, tenant, P, o, deps);
    expect(r.meses.map((m) => m.mes)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(r.meses[0]).toEqual({ mes: '2026-01', atendidos: 2, novos: 2, retorno: 0, consultasRealizadas: 2, atendimentosRegistrados: 0 });
    expect(r.meses[1]).toEqual({ mes: '2026-02', atendidos: 1, novos: 0, retorno: 1, consultasRealizadas: 0, atendimentosRegistrados: 1 });
  });

  it('período sem nada: zeros', async () => {
    const r = await relatorioAtendimentos(T.ctx, tenant, periodo('2026-05', '2026-06'), o, deps);
    expect(r.meses.every((m) => m.atendidos === 0 && m.consultasRealizadas === 0 && m.atendimentosRegistrados === 0)).toBe(true);
  });
});

describe('relatorioPlanos (US-482, RN-489)', () => {
  let T: TenantDeTeste;
  beforeAll(async () => {
    T = await novoTenant(app.db);
    const [ana, bia, caio, dani, eva, fabio] = await pacientes(T, [{}, { status: 'arquivado' }, {}, {}, {}, { status: 'bloqueado' }]);
    const plano = (patientId: string | null, status: string, publicadoEm: Date | null, versao = 1) => ({
      tenantId: T.tenantId, patientId, isTemplate: patientId === null, titulo: 'Plano', status, versao, publicadoEm,
    });
    await withTenant(
      T.ctx,
      (tx) =>
        tx.insert(mealPlans).values([
          plano(ana, 'arquivado', new Date('2026-02-10T15:00:00Z'), 1), // versão 1, depois arquivada
          plano(ana, 'publicado', new Date('2026-02-20T15:00:00Z'), 2), // versão 2: também conta
          plano(bia, 'publicado', new Date('2026-03-05T15:00:00Z')), // paciente arquivada: conta no mês, não no "hoje"
          plano(caio, 'rascunho', null),
          plano(dani, 'publicado', new Date('2026-04-01T01:00:00Z')), // 31/03 às 22:00 em São Paulo: março
          plano(eva, 'publicado', new Date('2025-11-20T15:00:00Z')), // antes do período
          plano(fabio, 'publicado', new Date('2025-10-01T15:00:00Z')), // bloqueado: fora do "hoje"
          plano(null, 'rascunho', new Date('2026-02-15T15:00:00Z')), // modelo: nunca entra
        ]),
      app.db,
    );
  });

  it('publicações e pacientes por mês (cada versão conta; modelos fora; no fuso)', async () => {
    const r = await relatorioPlanos(T.ctx, tenant, PADRAO, o, deps);
    expect(r.meses.map((m) => m.mes)).toEqual(PADRAO.meses);
    const doMes = (mes: string) => r.meses.find((m) => m.mes === mes);
    expect(doMes('2026-02')).toEqual({ mes: '2026-02', publicacoes: 2, pacientes: 1 });
    expect(doMes('2026-03')).toEqual({ mes: '2026-03', publicacoes: 2, pacientes: 2 });
    expect(r.meses.reduce((s, m) => s + m.publicacoes, 0)).toBe(4);
  });

  it('cartão "hoje": ativos com plano publicado, de todos os ativos', async () => {
    const r = await relatorioPlanos(T.ctx, tenant, PADRAO, o, deps);
    expect(r.hoje).toEqual({ comPlano: 3, ativos: 4 }); // Ana, Dani e Eva de Ana, Caio, Dani e Eva
  });
});

describe('relatorioAgenda (US-483, RN-490)', () => {
  let T: TenantDeTeste;
  const P = periodo('2026-10', '2026-11');
  beforeAll(async () => {
    T = await novoTenant(app.db);
    const [ana, bia, caio, dani, eva, fabio, gil, hugo, iris, jose] = await pacientes(T, [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
    await consulta(T, ana, em('2026-10-01', '10:00'), { status: 'realizada' }); // primeira da vida: não é retorno
    await atendimento(T, fabio, '2026-10-01'); // atendimento sem consulta
    await consulta(T, iris, new Date('2026-11-01T02:00:00Z')); // 31/10 às 23:00 em São Paulo: outubro, já começou
    await consulta(T, ana, em('2026-11-03', '10:00'), { status: 'realizada' }); // retorno (realizada em outubro)
    await consulta(T, bia, em('2026-11-04', '10:00'), { status: 'faltou' }); // primeira: não é retorno
    await consulta(T, caio, em('2026-11-05', '10:00'), cancelada('paciente'));
    await consulta(T, dani, em('2026-11-06', '10:00'), cancelada('nutri'));
    await consulta(T, eva, em('2026-11-07', '10:00'), cancelada('sistema')); // exclusão LGPD: coluna nenhuma
    await consulta(T, hugo, em('2026-11-08', '10:00'), { ...cancelada('paciente'), origem: 'paciente' });
    await consulta(T, ana, em('2026-11-17', '09:00')); // agendada, já começou: iniciada; retorno
    await consulta(T, fabio, em('2026-11-20', '10:00'), { origem: 'paciente' }); // retorno pelo atendimento de outubro
    await consulta(T, gil, em('2026-11-21', '10:00'), { status: 'confirmada' });
    // pedido do paciente sem resposta (Plano 23): não é consulta marcada, nem iniciada, nem retorno (code review do PR 1)
    await owner.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${T.tenantId}, true)`);
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status)
        values (${T.tenantId}, ${jose}, ${em('2026-11-09', '10:00')}, ${em('2026-11-09', '11:00')}, 'presencial', 'paciente', 'solicitada')`);
    });
  });

  it('as colunas da US-483 por mês, no fuso', async () => {
    const r = await relatorioAgenda(T.ctx, tenant, P, o, deps);
    expect(r.meses).toEqual([
      { mes: '2026-10', marcadas: 2, realizadas: 1, faltas: 0, iniciadas: 2, canceladasPaciente: 0, canceladasConsultorio: 0, marcadasPeloPaciente: 0, retornos: 0 },
      { mes: '2026-11', marcadas: 5, realizadas: 1, faltas: 1, iniciadas: 3, canceladasPaciente: 2, canceladasConsultorio: 1, marcadasPeloPaciente: 1, retornos: 3 },
    ]);
  });

  it('taxa de faltas com a conta do Início (faltas ÷ iniciadas); sem iniciada, sem taxa', async () => {
    const r = await relatorioAgenda(T.ctx, tenant, P, o, deps);
    expect(taxaDeFaltas(r.meses[1])).toBeCloseTo(1 / 3);
    expect(taxaDeFaltas({ faltas: 0, iniciadas: 0 })).toBeNull();
  });
});

describe('relatorioFinanceiro (US-484, RN-491)', () => {
  const P = periodo('2026-01', '2026-06');

  it('não configurado: o estado vazio', async () => {
    const T = await novoTenant(app.db);
    expect(await relatorioFinanceiro(T.ctx, tenant, P, o, deps)).toEqual({ configurado: false });
  });

  it('recebido e pago por mês do pagamento e por categoria; cancelados, em aberto e fora do período não entram', async () => {
    const T = await novoTenant(app.db);
    const d = { db: app.db, agora };
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-01-01', saldoInicial: '1.000,00', valorConsulta: '250,00' }, d);
    const cats = await listarCategorias(T.ctx, d);
    const cat = (nome: string) => cats.find((c) => c.nome === nome)!.id;
    const ana = await um(T, { nome: 'Ana' });
    const lancar = (x: Record<string, unknown>) => criarLancamento(T.ctx, T.tenant, x, d);
    await lancar({ tipo: 'entrada', valor: '250,00', categoriaId: cat('Consultas'), vencimento: '2026-01-10', pagoEm: '2026-01-10', forma: 'pix', pacienteId: ana });
    await lancar({ tipo: 'entrada', valor: '100,00', categoriaId: cat('Outras entradas'), vencimento: '2026-01-31', pagoEm: '2026-01-31', forma: 'pix' });
    await lancar({ tipo: 'saida', valor: '1.200,00', categoriaId: cat('Aluguel e condomínio'), vencimento: '2026-01-05', pagoEm: '2026-01-05', forma: 'boleto' });
    const devolvida = await lancar({ tipo: 'entrada', valor: '300,00', categoriaId: cat('Consultas'), vencimento: '2026-03-15', pagoEm: '2026-03-15', forma: 'pix', pacienteId: ana });
    await cancelarLancamento(T.ctx, devolvida.id, 'Devolução', d);
    await lancar({ tipo: 'entrada', valor: '400,00', categoriaId: cat('Consultas'), vencimento: '2026-02-10', pacienteId: ana }); // em aberto
    await lancar({ tipo: 'saida', valor: '90,00', categoriaId: cat('Material e insumos'), vencimento: '2026-06-30', pagoEm: '2026-06-30', forma: 'pix' });
    await lancar({ tipo: 'entrada', valor: '500,00', categoriaId: cat('Outras entradas'), vencimento: '2026-07-01', pagoEm: '2026-07-01', forma: 'pix' }); // depois
    await lancar({ tipo: 'saida', valor: '50,00', categoriaId: cat('Aluguel e condomínio'), vencimento: '2025-12-31', pagoEm: '2025-12-31', forma: 'pix' }); // antes

    const r = await relatorioFinanceiro(T.ctx, tenant, P, o, deps);
    expect(r).toEqual({
      configurado: true,
      meses: [
        { mes: '2026-01', recebido: 35000, pago: 120000 },
        { mes: '2026-02', recebido: 0, pago: 0 },
        { mes: '2026-03', recebido: 0, pago: 0 },
        { mes: '2026-04', recebido: 0, pago: 0 },
        { mes: '2026-05', recebido: 0, pago: 0 },
        { mes: '2026-06', recebido: 0, pago: 9000 },
      ],
      porCategoria: {
        entradas: [
          { categoria: 'Consultas', valor: 25000 },
          { categoria: 'Outras entradas', valor: 10000 },
        ],
        saidas: [
          { categoria: 'Aluguel e condomínio', valor: 120000 },
          { categoria: 'Material e insumos', valor: 9000 },
        ],
      },
    });
  });
});

describe('relatorioRanking (US-485, RN-492)', () => {
  const P = periodo('2026-01', '2026-06');
  let T: TenantDeTeste;
  let ids: Record<string, string>;
  beforeAll(async () => {
    T = await novoTenant(app.db);
    const nomes = ['João Silva', 'Zé', 'Ágata', 'Alice', 'Arquivada', 'Bloqueado', 'Anonimizado', ...Array.from({ length: 20 }, (_, i) => `Paciente ${String(i + 1).padStart(2, '0')}`)];
    const lista = await pacientes(
      T,
      nomes.map((nome) => ({ nome, ...(nome === 'Arquivada' ? { status: 'arquivado' } : nome === 'Bloqueado' ? { status: 'bloqueado' } : nome === 'Anonimizado' ? ANONIMIZADO : {}) })),
    );
    ids = Object.fromEntries(nomes.map((n, i) => [n, lista[i]]));
    await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: ids['João Silva'], nomeSocial: 'Joana Silva' }), app.db);
    // consultas realizadas no período: Arquivada 4, João 3, Zé 3, Ágata 2, Alice 2, cada "Paciente nn" 1, Bloqueado e Anonimizado 5
    const quantas: Record<string, number> = { Arquivada: 4, 'João Silva': 3, Zé: 3, Ágata: 2, Alice: 2, Bloqueado: 5, Anonimizado: 5 };
    let h = 0;
    const proxima = () => new Date(Date.UTC(2026, 0, 5, 12) + h++ * 2 * 3_600_000); // a cada 2 h desde 05/01
    for (const nome of nomes) for (let i = 0; i < (quantas[nome] ?? 1); i++) await consulta(T, ids[nome], proxima(), { status: 'realizada' });
    // fora da conta: faltas, agendadas e realizadas fora do período
    for (let i = 0; i < 3; i++) await consulta(T, ids['Paciente 20'], proxima(), { status: 'faltou' });
    await consulta(T, ids['Paciente 20'], proxima());
    for (let i = 0; i < 3; i++) await consulta(T, ids['Paciente 19'], em('2025-12-0' + (i + 1), '10:00'), { status: 'realizada' });
    await consulta(T, ids['Paciente 19'], em('2026-07-01', '10:00'), { status: 'realizada' });
  });

  it('mais consultas: até 20; empate pelo nome exibido sem acento; bloqueado e anonimizado fora; nome exibido × de registro', async () => {
    const r = await relatorioRanking(T.ctx, tenant, P, { ...o, por: 'consultas' }, deps);
    expect(r.por).toBe('consultas');
    expect(r.linhas).toHaveLength(20);
    expect(r.linhas.slice(0, 5)).toEqual([
      { patientId: ids.Arquivada, nomeExibido: 'Arquivada', nomeRegistro: 'Arquivada', valor: 4 },
      { patientId: ids['João Silva'], nomeExibido: 'Joana Silva', nomeRegistro: 'João Silva', valor: 3 },
      { patientId: ids['Zé'], nomeExibido: 'Zé', nomeRegistro: 'Zé', valor: 3 },
      // "Ágata" antes de "Alice": sem acento, "agata" < "alice" (pela ordem dos bytes, "Á" viria depois do "z")
      { patientId: ids['Ágata'], nomeExibido: 'Ágata', nomeRegistro: 'Ágata', valor: 2 },
      { patientId: ids.Alice, nomeExibido: 'Alice', nomeRegistro: 'Alice', valor: 2 },
    ]);
    expect(r.linhas.slice(5).map((l) => [l.nomeExibido, l.valor])).toEqual(Array.from({ length: 15 }, (_, i) => [`Paciente ${String(i + 1).padStart(2, '0')}`, 1]));
    expect(r.linhas.map((l) => l.patientId)).not.toContain(ids.Bloqueado);
    expect(r.linhas.map((l) => l.patientId)).not.toContain(ids.Anonimizado);
  });

  it('maior receita: entradas recebidas no período, não canceladas, com paciente; empate pelo nome; só pelo módulo do Financeiro', async () => {
    const d = { db: app.db, agora };
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-01-01', saldoInicial: '0,00', valorConsulta: '250,00' }, d);
    const cats = await listarCategorias(T.ctx, d);
    const consultas = cats.find((c) => c.nome === 'Consultas')!.id;
    const receber = (nome: string, valor: string, pagoEm: string | null) =>
      criarLancamento(T.ctx, T.tenant, { tipo: 'entrada', valor, categoriaId: consultas, vencimento: pagoEm ?? '2026-03-01', pacienteId: ids[nome], ...(pagoEm ? { pagoEm, forma: 'pix' } : {}) }, d);
    await receber('Alice', '250,00', '2026-02-10');
    await receber('Alice', '250,00', '2026-03-10');
    await receber('Ágata', '500,00', '2026-04-10'); // empata com Alice: "Ágata" primeiro
    const devolvida = await receber('Zé', '1.000,00', '2026-02-01');
    await cancelarLancamento(T.ctx, devolvida.id, 'Devolução', d);
    await receber('Paciente 01', '300,00', null); // em aberto
    await receber('Paciente 02', '200,00', '2025-12-15'); // antes do período
    await receber('Arquivada', '100,00', '2026-06-30');
    await receber('João Silva', '150,00', '2026-01-02');
    const r = await relatorioRanking(T.ctx, tenant, P, { ...o, por: 'receita' }, deps);
    expect(r).toEqual({
      por: 'receita',
      linhas: [
        { patientId: ids['Ágata'], nomeExibido: 'Ágata', nomeRegistro: 'Ágata', valor: 50000 },
        { patientId: ids.Alice, nomeExibido: 'Alice', nomeRegistro: 'Alice', valor: 50000 },
        { patientId: ids['João Silva'], nomeExibido: 'Joana Silva', nomeRegistro: 'João Silva', valor: 15000 },
        { patientId: ids.Arquivada, nomeExibido: 'Arquivada', nomeRegistro: 'Arquivada', valor: 10000 },
      ],
    });
  });

  it('bloqueado e anonimizado também ficam fora da receita', async () => {
    const V = await novoTenant(app.db);
    const d = { db: app.db, agora };
    await salvarConfiguracoes(V.ctx, V.tenant, { saldoInicialEm: '2026-01-01', saldoInicial: '0,00', valorConsulta: '250,00' }, d);
    const consultas = (await listarCategorias(V.ctx, d)).find((c) => c.nome === 'Consultas')!.id;
    const [ativa, bloqueada, anonimizada] = await pacientes(V, [{ nome: 'Ativa' }, { nome: 'Bloqueada' }, { nome: 'Anonimizada' }]);
    for (const id of [ativa, bloqueada, anonimizada]) {
      await criarLancamento(V.ctx, V.tenant, { tipo: 'entrada', valor: '100,00', categoriaId: consultas, vencimento: '2026-02-01', pagoEm: '2026-02-01', forma: 'pix', pacienteId: id }, d);
    }
    const ctxWorker: TenantContext = { tenantId: V.tenantId, role: 'worker' };
    await withTenant(ctxWorker, async (tx) => {
      await tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, bloqueada));
      await tx.update(patients).set({ status: 'bloqueado', anonimizadoEm: agora }).where(eq(patients.id, anonimizada));
    }, app.db);
    const r = await relatorioRanking(V.ctx, tenant, P, { ...o, por: 'receita' }, deps);
    expect(r.linhas.map((l) => l.patientId)).toEqual([ativa]); // controle positivo: a ativa aparece
  });
});

describe('Relatórios: agregado sem auditRead, recusa antes da transação (RN-480, RN-493)', () => {
  it('nenhuma das seis leituras grava audit_log sem o naMesmaTransacao; com ele, grava (controle positivo da mesma leitura)', async () => {
    const T = await novoTenant(app.db);
    const ana = await um(T, { nome: 'Ana' });
    await consulta(T, ana, em('2026-03-05', '10:00'), { status: 'realizada' });
    const antes = await linhasDoLog(T);
    expect(antes).toBeGreaterThan(0); // o cenário gravou (gatilho): a leitura do log enxerga as linhas do consultório
    await relatorioPacientes(T.ctx, tenant, PADRAO, o, deps);
    await relatorioAtendimentos(T.ctx, tenant, PADRAO, o, deps);
    await relatorioPlanos(T.ctx, tenant, PADRAO, o, deps);
    await relatorioAgenda(T.ctx, tenant, PADRAO, o, deps);
    await relatorioFinanceiro(T.ctx, tenant, PADRAO, o, deps);
    const ranking = await relatorioRanking(T.ctx, tenant, PADRAO, { ...o, por: 'consultas' }, deps);
    await relatorioRanking(T.ctx, tenant, PADRAO, { ...o, por: 'receita' }, deps);
    expect(ranking.linhas.map((l) => l.patientId)).toEqual([ana]);
    expect(await linhasDoLog(T)).toBe(antes);
    await relatorioRanking(T.ctx, tenant, PADRAO, { ...o, por: 'consultas' }, { ...deps, naMesmaTransacao: exportacaoNaLeitura('ranking', PADRAO, null) });
    expect(await linhasDoLog(T)).toBe(antes + 1);
  });

  it('o exportar do CSV e da impressão sai pelo naMesmaTransacao das seis leituras (RN-493, RE-D4): agregado sem paciente, Ranking um por paciente da lista', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia] = await pacientes(T, [{ nome: 'Ana' }, { nome: 'Bia' }]);
    await consulta(T, ana, em('2026-03-05', '10:00'), { status: 'realizada' });
    await consulta(T, bia, em('2026-03-06', '10:00'), { status: 'realizada' });
    expect(await exportacoes(T)).toEqual([]);
    await relatorioPacientes(T.ctx, tenant, PADRAO, o, { ...deps, naMesmaTransacao: exportacaoNaLeitura('pacientes', PADRAO, null) });
    await relatorioAtendimentos(T.ctx, tenant, PADRAO, o, { ...deps, naMesmaTransacao: exportacaoNaLeitura('atendimentos', PADRAO, null) });
    await relatorioPlanos(T.ctx, tenant, PADRAO, o, { ...deps, naMesmaTransacao: exportacaoNaLeitura('planos', PADRAO, null) });
    await relatorioAgenda(T.ctx, tenant, PADRAO, o, { ...deps, naMesmaTransacao: exportacaoNaLeitura('agenda', PADRAO, null) });
    // não configurado: o gancho roda também no estado vazio
    await relatorioFinanceiro(T.ctx, tenant, PADRAO, o, { ...deps, naMesmaTransacao: exportacaoNaLeitura('financeiro', PADRAO, null) });
    const porRanking = { ...deps, naMesmaTransacao: exportacaoNaLeitura('ranking', PADRAO, null) };
    const ranking = await relatorioRanking(T.ctx, tenant, PADRAO, { ...o, por: 'consultas' }, porRanking);
    expect(ranking.linhas.map((l) => l.patientId).sort()).toEqual([ana, bia].sort()); // controle positivo: a lista tem os dois
    await relatorioRanking(T.ctx, tenant, PADRAO, { ...o, por: 'receita' }, porRanking); // lista vazia: uma linha sem paciente
    const log = await exportacoes(T);
    const daSecao = (secao: string) => log.filter((l) => l.entidadeId === `${secao}|${PADRAO.de}..${PADRAO.ate}|todos`);
    for (const secao of ['pacientes', 'atendimentos', 'planos', 'agenda', 'financeiro']) {
      expect(daSecao(secao), secao).toEqual([{ acao: 'exportar', entidadeId: `${secao}|${PADRAO.de}..${PADRAO.ate}|todos`, patientId: null }]);
    }
    expect(daSecao('ranking').map((l) => l.patientId ?? 'sem paciente').sort()).toEqual([ana, bia, 'sem paciente'].sort());
    expect(log.every((l) => l.acao === 'exportar')).toBe(true);
    expect(log).toHaveLength(8);
  });

  it('erro no naMesmaTransacao volta a transação inteira: a leitura não sai e o exportar já gravado some (rollback)', async () => {
    const T = await novoTenant(app.db);
    const ana = await um(T, { nome: 'Ana' });
    await consulta(T, ana, em('2026-03-05', '10:00'), { status: 'realizada' });
    /** Grava o `exportar` e então falha (como a montagem do CSV que quebra depois do rastro). */
    const falhando = <D,>(grava: (tx: Tx, dados: D) => Promise<void>) => ({
      ...deps,
      naMesmaTransacao: async (tx: Tx, dados: D) => {
        await grava(tx, dados);
        throw new Error('falha depois de gravar');
      },
    });
    const ranking = relatorioRanking(T.ctx, tenant, PADRAO, { ...o, por: 'consultas' }, falhando(exportacaoNaLeitura('ranking', PADRAO, null)));
    await expect(ranking).rejects.toThrow('falha depois de gravar');
    await expect(relatorioAgenda(T.ctx, tenant, PADRAO, o, falhando(exportacaoNaLeitura('agenda', PADRAO, null)))).rejects.toThrow('falha depois de gravar');
    expect(await exportacoes(T)).toEqual([]);
    // controle positivo: o mesmo pedido sem a falha grava, e a mesma leitura do log o enxerga
    await relatorioRanking(T.ctx, tenant, PADRAO, { ...o, por: 'consultas' }, { ...deps, naMesmaTransacao: exportacaoNaLeitura('ranking', PADRAO, null) });
    expect(await exportacoes(T)).toEqual([{ acao: 'exportar', entidadeId: `ranking|${PADRAO.de}..${PADRAO.ate}|todos`, patientId: ana }]);
  });

  it('a recepção sem a seção, o worker e a sessão de paciente são recusados antes de abrir a transação', async () => {
    const T = await novoTenant(app.db);
    // abrir a transação quebraria com outro erro: a recusa tem de vir antes
    const semBanco = { db: new Proxy({}, { get: () => { throw new Error('abriu a transação'); } }) as Db, agora };
    const RECEPCAO: Acesso = { papel: 'recepcao', financeiro: true };
    await expect(relatorioAtendimentos(T.ctx, tenant, PADRAO, { localId: null, acesso: RECEPCAO }, semBanco)).rejects.toThrow(RelatorioSemPermissaoError);
    await expect(relatorioRanking(T.ctx, tenant, PADRAO, { localId: null, acesso: RECEPCAO, por: 'consultas' }, semBanco)).rejects.toThrow(RelatorioSemPermissaoError);
    const worker: TenantContext = { tenantId: T.tenantId, role: 'worker' };
    await expect(relatorioPacientes(worker, tenant, PADRAO, o, semBanco)).rejects.toThrow(RelatorioSemPermissaoError);
    const paciente: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: randomUUID(), actorUserId: randomUUID() };
    await expect(relatorioAgenda(paciente, tenant, PADRAO, o, semBanco)).rejects.toThrow(RelatorioSemPermissaoError);
  });

  it('filtro de local antes do Plano 23 e período fora da regra: RangeError (erro de programação, nunca ignorado)', async () => {
    const T = await novoTenant(app.db);
    await expect(relatorioAgenda(T.ctx, tenant, PADRAO, { localId: randomUUID(), acesso: NUTRI }, deps)).rejects.toThrow(RangeError);
    const treze: Periodo = { de: '2025-11', ate: '2026-11', meses: ['2025-11', ...PADRAO.meses] };
    await expect(relatorioPlanos(T.ctx, tenant, treze, o, deps)).rejects.toThrow(RangeError);
    await expect(relatorioPlanos(T.ctx, tenant, { de: '2026-01', ate: '2026-02', meses: ['2026-01'] }, o, deps)).rejects.toThrow(RangeError);
    // controle positivo: o mesmo pedido com o período padrão e sem local responde
    await expect(relatorioPlanos(T.ctx, tenant, PADRAO, o, deps)).resolves.toBeDefined();
  });
});

describe('guardas de fonte dos Relatórios', () => {
  const arquivos = readdirSync('src/modules/relatorios')
    .filter((f) => /\.ts$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => path.join('src/modules/relatorios', f));
  const fonte = (f: string) => readFileSync(f, 'utf8');
  /** O código sem os comentários (a documentação cita `fin_*` e as colunas que **não** são lidas). */
  const codigo = (f: string) => fonte(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('nenhuma consulta a fin_* fora do módulo do Financeiro (RN-491, RE-D68)', () => {
    expect(arquivos).toContain('src/modules/relatorios/financeiro.ts'); // controle positivo: a lista anda
    const citaFin = (texto: string) => /\bfin_|\bfin(?:Lancamentos|Categorias|Configuracoes)\b/.test(texto);
    expect(citaFin("select 1 from fin_lancamentos")).toBe(true); // controle positivo da regra
    expect(arquivos.filter((f) => citaFin(codigo(f)))).toEqual([]);
  });

  it('nenhuma coluna de conteúdo do plano nem do atendimento é lida (RN-488, RN-489)', () => {
    const conteudo = /orienta[cç]|titulo|meta_kcal|metaKcal|nutrientes|refei[cç]|anota|nota|texto/i;
    for (const f of ['planos.ts', 'atendimentos.ts']) {
      expect(codigo(path.join('src/modules/relatorios', f)).match(conteudo), f).toBeNull();
    }
  });

  it('nenhuma leitura chama auditRead (RN-493)', () => {
    expect(arquivos.filter((f) => codigo(f).includes('auditRead('))).toEqual([]);
  });
});
