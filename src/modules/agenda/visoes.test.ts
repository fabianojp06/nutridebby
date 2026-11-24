import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, localPrincipal, novoLocal, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { consultations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { agendaDoPeriodo, hrefDaAgenda, lerFiltros, MARCADOR_RETORNO_LIGADO, tiposDasConsultas, type FiltrosDaAgenda } from './visoes';

/**
 * Plano 23 (US-404, US-405, RN-411 a RN-417): as visões da agenda com o banco de verdade — uma transação, "Retorno" numa
 * consulta agregada (sem N+1), marcador de aniversário só de ativo e não anonimizado, nada de `auditRead` (AG-D30).
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só para contar o audit_log (o app não lê o de outro jeito aqui)

/** Um `Db` cujo cliente conta todas as consultas mandadas ao banco (Plano 20 T4: contador de consultas por Pool embrulhado). */
function dbQueConta(): { db: Db; pool: Pool; n: () => number; zerar: () => void } {
  const pool = new Pool({ connectionString: inject('appDatabaseUrl'), max: 2 });
  let n = 0;
  const conectar = pool.connect.bind(pool) as () => Promise<PoolClient>;
  const embrulhados = new WeakSet<PoolClient>();
  pool.connect = (async () => {
    const c = await conectar();
    if (!embrulhados.has(c)) {
      embrulhados.add(c);
      const consultar = c.query.bind(c) as (...a: unknown[]) => Promise<unknown>;
      c.query = ((...a: unknown[]) => {
        n++;
        return consultar(...a);
      }) as unknown as PoolClient['query'];
    }
    return c;
  }) as unknown as Pool['connect'];
  return { db: drizzle({ client: pool, schema }) as unknown as Db, pool, n: () => n, zerar: () => (n = 0) };
}
const contado = dbQueConta();
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
  await contado.pool.end();
});

/** Terça, 17/11/2026, 12:00 em São Paulo. */
const agora = new Date('2026-11-17T15:00:00Z');
const deps = { db: app.db, agora };
const filtros = (f: Partial<FiltrosDaAgenda> = {}): FiltrosDaAgenda => ({ visao: 'semana', data: '2026-11-17', horas24: false, retorno: false, aniversario: false, ...f });
const atendimento = (T: TenantDeTeste, patientId: string, data: string) =>
  withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId, data }), app.db);
const linhasDeAuditoria = async (T: TenantDeTeste) =>
  Number((await owner.db.execute<{ n: string }>(sql`select count(*) as n from audit_log where tenant_id = ${T.tenantId}`)).rows[0].n);

type Cenario = TenantDeTeste & { principal: string; clinica: string; ana: string; bia: string; caio: string; davi: string; c: Record<string, string> };
let C: Cenario;

beforeAll(async () => {
  const T = await novoTenant(app.db);
  const principal = await localPrincipal(app.db, T.ctx);
  const clinica = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
  const ana = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', dataNascimento: '1990-11-18' })).id;
  const bia = (await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })).id;
  const caio = (await novoPaciente(app.db, T.ctx, { nome: 'Caio Dias' })).id;
  const davi = (await novoPaciente(app.db, T.ctx, { nome: 'Davi Reis' })).id;
  // Ana: realizada antes → "Retorno"
  await consultaDireta(app.db, T.ctx, ana, em('2026-11-02', '10:00'), 60, { status: 'realizada' });
  // Bia: atendimento lançado à mão antes, sem consulta → "Retorno"
  await atendimento(T, bia, '2026-10-01');
  // Caio: uma agendada antes (não realizada), uma realizada depois e um atendimento no mesmo dia → "Primeira consulta"
  const caioAntes = await consultaDireta(app.db, T.ctx, caio, em('2026-11-16', '08:00'), 60);
  await consultaDireta(app.db, T.ctx, caio, em('2026-11-25', '10:00'), 60, { status: 'realizada' });
  await atendimento(T, caio, '2026-11-19');
  const c = {
    ana: await consultaDireta(app.db, T.ctx, ana, em('2026-11-17', '08:40'), 50, { localId: principal }),
    bia: await consultaDireta(app.db, T.ctx, bia, em('2026-11-18', '09:00'), 90, { localId: clinica }),
    caio: await consultaDireta(app.db, T.ctx, caio, em('2026-11-19', '10:00'), 60, { localId: clinica }),
    caioAntes,
    davi: await consultaDireta(app.db, T.ctx, davi, em('2026-11-20', '14:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora }),
    anaDaqui11Meses: await consultaDireta(app.db, T.ctx, ana, em('2027-10-15', '10:00'), 60),
    anaDaqui13Meses: await consultaDireta(app.db, T.ctx, ana, em('2027-12-20', '10:00'), 60),
  };
  C = { ...T, principal, clinica, ana, bia, caio, davi, c };
});

describe('filtros na URL (RN-411, I-05)', () => {
  it('lerFiltros aceita string[] (o searchParams do Next), ignora local e paciente que não são uuid e cai na semana', () => {
    const id = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
    expect(lerFiltros({ visao: ['mes', 'dia'], data: ['2026-12-01'], local: [id], paciente: id, horas: '24', aniversario: '1', retorno: '1' }, '2026-11-17')).toEqual({
      visao: 'mes', data: '2026-12-01', local: id, paciente: id, horas24: true, retorno: true, aniversario: true,
    });
    expect(lerFiltros({ visao: 'x', data: '9999-12-31', local: 'abc', paciente: "1' or 1=1", horas: '12' }, '2026-11-17')).toEqual({
      visao: 'semana', data: '2026-11-17', horas24: false, retorno: false, aniversario: false,
    });
  });
  it('hrefDaAgenda preserva local, paciente e marcadores em "Próximo", no dia do Mês e na impressão', () => {
    const f = filtros({ local: C.clinica, paciente: C.ana, horas24: true, aniversario: true });
    const proximo = hrefDaAgenda({ ...f, data: '2026-11-23' });
    expect(proximo).toBe(`/painel/agenda?visao=semana&data=2026-11-23&local=${C.clinica}&paciente=${C.ana}&horas=24&aniversario=1`);
    expect(hrefDaAgenda({ ...f, visao: 'dia', data: '2026-11-18' })).toContain('visao=dia&data=2026-11-18&local=');
    expect(hrefDaAgenda(f, '/painel/agenda/imprimir')).toMatch(/^\/painel\/agenda\/imprimir\?visao=semana&data=2026-11-17&local=.+&aniversario=1$/);
    // "Ir para a data": lerFiltros(hrefDaAgenda(f)) devolve os mesmos filtros
    const volta = Object.fromEntries(new URLSearchParams(proximo.split('?')[1]));
    expect(lerFiltros(volta, '2026-11-17')).toEqual({ ...f, data: '2026-11-23', retorno: false });
    expect(hrefDaAgenda({ visao: 'lista' })).toBe('/painel/agenda?visao=lista');
  });
  it('o marcador de previsão de retorno está ligado (a T9 ligou, AG-D73)', () => {
    expect(MARCADOR_RETORNO_LIGADO).toBe(true);
  });
});

describe('agendaDoPeriodo (US-404, US-405)', () => {
  it('Semana: "Primeira consulta" × "Retorno" (realizada antes, atendimento à mão antes, nenhum); canceladas fora; local e selos', async () => {
    const r = await agendaDoPeriodo(C.ctx, tenantAgenda(C), filtros(), deps);
    const por = new Map(r.itens.map((i) => [i.id, i]));
    expect(por.get(C.c.ana)?.tipoConsulta).toBe('retorno');
    expect(por.get(C.c.bia)?.tipoConsulta).toBe('retorno');
    expect(por.get(C.c.caio)?.tipoConsulta).toBe('primeira');
    expect(por.get(C.c.caioAntes)?.tipoConsulta).toBe('primeira');
    expect(por.has(C.c.davi)).toBe(false); // cancelada só na Lista (RN-413)
    expect(por.get(C.c.bia)?.local).toEqual({ nome: 'Clínica Centro', tipo: 'presencial' });
    // RN-417: a de 16/11 terminou há mais de 24 h e continua agendada
    expect(por.get(C.c.caioAntes)?.selos).toEqual(['Agendada', 'Presença a registrar']);
    expect(por.get(C.c.ana)?.selos).toEqual(['Agendada']);
    expect(r.retornos).toEqual([]);
    expect(r.aniversarios).toEqual([]); // marcador desligado
  });

  it('US-410: "Previsões de retorno" liga o marcador (previsoesDeRetorno, RN-430) nos dias da visão; fora da Lista; sem trilha', async () => {
    const T = await novoTenant(app.db);
    const eva = (await novoPaciente(app.db, T.ctx, { nome: 'Eva Melo' })).id;
    const fabio = (await novoPaciente(app.db, T.ctx, { nome: 'Fábio Nunes' })).id;
    await withTenant(T.ctx, (tx) => tx.insert(consultations).values([
      { tenantId: T.tenantId, patientId: eva, data: '2026-10-01', retornoPrevistoEm: '2026-11-19' },
      { tenantId: T.tenantId, patientId: fabio, data: '2026-10-01', retornoPrevistoEm: '2026-11-20' },
    ]), app.db);
    await consultaDireta(app.db, T.ctx, fabio, em('2026-12-01', '10:00'), 60); // com consulta futura: sem marcador
    const antes = await linhasDeAuditoria(T);
    expect((await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros(), deps)).retornos).toEqual([]);
    expect((await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros({ retorno: true }), deps)).retornos).toEqual([{ patientId: eva, nome: 'Eva Melo', data: '2026-11-19' }]);
    expect((await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros({ retorno: true, visao: 'mes' }), deps)).retornos).toEqual([{ patientId: eva, nome: 'Eva Melo', data: '2026-11-19' }]);
    expect((await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros({ retorno: true, visao: 'dia', data: '2026-11-18' }), deps)).retornos).toEqual([]);
    expect((await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros({ retorno: true, visao: 'lista' }), deps)).retornos).toEqual([]);
    expect((await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros({ retorno: true, paciente: fabio }), deps)).retornos).toEqual([]);
    expect(await linhasDeAuditoria(T)).toBe(antes);
  });

  it('o mesmo critério de tiposDasConsultas (sqlEhRetorno), numa consulta só', async () => {
    const tipos = await withTenant(C.ctx, (tx) => tiposDasConsultas(tx, [C.c.ana, C.c.bia, C.c.caio, C.c.caioAntes]), app.db);
    expect(Object.fromEntries(tipos)).toEqual({ [C.c.ana]: 'retorno', [C.c.bia]: 'retorno', [C.c.caio]: 'primeira', [C.c.caioAntes]: 'primeira' });
    expect((await withTenant(C.ctx, (tx) => tiposDasConsultas(tx, []), app.db)).size).toBe(0);
  });

  it('sem N+1: o número de consultas ao banco não cresce com o número de consultas da semana', async () => {
    const T = await novoTenant(app.db);
    await localPrincipal(app.db, T.ctx);
    const contar = async () => {
      contado.zerar();
      await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros({ aniversario: true }), { db: contado.db, agora });
      return contado.n();
    };
    const um = await novoPaciente(app.db, T.ctx, { nome: 'Um' });
    await consultaDireta(app.db, T.ctx, um.id, em('2026-11-17', '08:00'));
    const comUma = await contar();
    for (let i = 0; i < 6; i++) {
      const p = await novoPaciente(app.db, T.ctx, { nome: `Paciente ${i}` });
      await consultaDireta(app.db, T.ctx, p.id, em('2026-11-18', `${String(8 + i).padStart(2, '0')}:00`));
      await atendimento(T, p.id, '2026-10-01');
    }
    expect(await contar()).toBe(comUma);
  });

  it('filtro de local e de paciente; o filtro por paciente não grava audit_log (AG-D30)', async () => {
    const soClinica = await agendaDoPeriodo(C.ctx, tenantAgenda(C), filtros({ local: C.clinica }), deps);
    expect(soClinica.itens.map((i) => i.id).sort()).toEqual([C.c.bia, C.c.caio].sort());
    const antes = await linhasDeAuditoria(C);
    const soAna = await agendaDoPeriodo(C.ctx, tenantAgenda(C), filtros({ paciente: C.ana, aniversario: true }), deps);
    expect(soAna.itens.map((i) => i.id)).toEqual([C.c.ana]);
    expect(await linhasDeAuditoria(C)).toBe(antes);
  });

  it('Lista: canceladas entram; com paciente, de hoje a hoje + 12 meses', async () => {
    const lista = await agendaDoPeriodo(C.ctx, tenantAgenda(C), filtros({ visao: 'lista' }), deps);
    expect(lista.itens.map((i) => i.id)).toContain(C.c.davi);
    const ana = await agendaDoPeriodo(C.ctx, tenantAgenda(C), filtros({ visao: 'lista', paciente: C.ana }), deps);
    expect(ana.itens.map((i) => i.id)).toEqual([C.c.ana, C.c.anaDaqui11Meses]);
  });

  it('aniversário: só de ativo, não anonimizado e com data de nascimento; só o nome e a data (RN-414)', async () => {
    const T = await novoTenant(app.db);
    await localPrincipal(app.db, T.ctx);
    await novoPaciente(app.db, T.ctx, { nome: 'Eva Ativa', dataNascimento: '1990-11-18' });
    await novoPaciente(app.db, T.ctx, { nome: 'Fábio Bloqueado', dataNascimento: '1990-11-18', status: 'bloqueado' });
    await novoPaciente(app.db, T.ctx, { nome: 'Gil Arquivado', dataNascimento: '1990-11-18', status: 'arquivado' });
    await novoPaciente(app.db, T.ctx, { nome: 'Hugo Anonimizado', dataNascimento: '1990-11-18', status: 'bloqueado', anonimizadoEm: new Date('2026-10-01T12:00:00Z') });
    await novoPaciente(app.db, T.ctx, { nome: 'Ivo Sem Data', dataNascimento: null, sexo: null, origem: 'agendamento_publico' });
    await novoPaciente(app.db, T.ctx, { nome: 'Júlia Outro Dia', dataNascimento: '1990-12-18' });
    const r = await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros({ aniversario: true }), deps);
    expect(r.aniversarios.map(({ nome, data }) => ({ nome, data }))).toEqual([{ nome: 'Eva Ativa', data: '2026-11-18' }]);
    expect(Object.keys(r.aniversarios[0]).sort()).toEqual(['data', 'nome', 'patientId']);
    // 29/02 → 28/02 em ano não bissexto, no Mês
    await novoPaciente(app.db, T.ctx, { nome: 'Leo Bissexto', dataNascimento: '2000-02-29' });
    const fev = await agendaDoPeriodo(T.ctx, tenantAgenda(T), filtros({ visao: 'mes', data: '2027-02-10', aniversario: true }), deps);
    expect(fev.aniversarios.map(({ nome, data }) => ({ nome, data }))).toEqual([{ nome: 'Leo Bissexto', data: '2027-02-28' }]);
  });

  it('só a sessão da nutricionista (RN-400)', async () => {
    await expect(agendaDoPeriodo(ctxPaciente(C.tenantId, C.ana), tenantAgenda(C), filtros(), deps)).rejects.toThrow('agenda: só a sessão nutri');
  });
});
