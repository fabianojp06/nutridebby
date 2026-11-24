import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, pedidoDireto } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { consultations, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { previsoesDeRetorno, retornoEmSemanas } from './retorno';

/**
 * Plano 23 (US-410, RN-430, AG-D76): a previsão de retorno. O marcador é a previsão do atendimento MAIS NOVO (sem previsão
 * nele, sem marcador), de paciente `ativo` e não anonimizado, SEM consulta futura em `STATUS_OCUPA` (agendada, confirmada ou
 * o pedido `solicitada`). Só id, nome e data.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só para contar o audit_log
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

/** Terça, 17/11/2026, 12:00 em São Paulo. */
const agora = new Date('2026-11-17T15:00:00Z');

const atendimento = (T: TenantDeTeste, patientId: string, data: string, retornoPrevistoEm: string | null, createdAt?: Date) =>
  withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId, data, retornoPrevistoEm, ...(createdAt ? { createdAt } : {}) }), app.db);

describe('retornoEmSemanas (RN-430: "em {n} semanas", a partir da data do atendimento)', () => {
  it('soma semanas à data (AAAA-MM-DD), atravessando o mês e o ano, sem fuso de servidor no meio', () => {
    expect(retornoEmSemanas('2026-10-01', 6)).toBe('2026-11-12');
    expect(retornoEmSemanas('2026-12-20', 2)).toBe('2027-01-03');
    expect(retornoEmSemanas('2028-02-15', 2)).toBe('2028-02-29');
    expect(retornoEmSemanas('2026-10-01', 0)).toBe('2026-10-01');
  });
});

describe('previsoesDeRetorno (US-410, RN-430)', () => {
  let T: TenantDeTeste;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    T = await novoTenant(app.db);
    for (const nome of ['Ana Souza', 'Bia Lima', 'Caio Dias', 'Davi Reis', 'Eva Melo', 'Fábio Nunes', 'Gil Prado', 'Hugo Sá', 'Iara Luz']) {
      id[nome.split(' ')[0].toLowerCase()] = (await novoPaciente(app.db, T.ctx, { nome })).id;
    }
    // Ana: duas previsões — vale a do atendimento mais novo (AG-D76); o empate de data desempata pela criação
    await atendimento(T, id.ana, '2026-10-01', '2026-12-01');
    await atendimento(T, id.ana, '2026-10-20', '2026-12-03', new Date('2026-10-20T12:00:00Z'));
    await atendimento(T, id.ana, '2026-10-20', '2026-12-10', new Date('2026-10-20T18:00:00Z'));
    // Iara (AG-D76): previsão para 10/12 e um atendimento mais novo, em 05/12, sem previsão → sem marcador
    await atendimento(T, id.iara, '2026-11-01', '2026-12-10');
    await atendimento(T, id.iara, '2026-12-05', null);
    // Bia: previsão, mas com consulta futura agendada → sem marcador
    await atendimento(T, id.bia, '2026-10-05', '2026-12-05');
    await consultaDireta(app.db, T.ctx, id.bia, em('2027-01-10', '10:00'), 60);
    // Caio: previsão, mas com um pedido (solicitada) futuro → sem marcador
    await atendimento(T, id.caio, '2026-10-05', '2026-12-06');
    await pedidoDireto(app.db, T, id.caio, em('2027-01-11', '10:00'));
    // Davi: previsão e só consultas que não ocupam (cancelada futura, realizada passada) → com marcador
    await atendimento(T, id.davi, '2026-10-05', '2026-12-07');
    await consultaDireta(app.db, T.ctx, id.davi, em('2027-01-12', '10:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    await consultaDireta(app.db, T.ctx, id.davi, em('2026-11-02', '10:00'), 60, { status: 'realizada' });
    // Eva: arquivada → fora
    await atendimento(T, id.eva, '2026-10-05', '2026-12-08');
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, id.eva)), app.db);
    // Fábio: previsão fora do período pedido
    await atendimento(T, id['fábio'], '2026-10-05', '2027-03-01');
    // Gil: consulta agendada que já passou (sem presença registrada) não conta como futura → com marcador
    await atendimento(T, id.gil, '2026-10-05', '2026-12-09');
    await consultaDireta(app.db, T.ctx, id.gil, em('2026-11-10', '10:00'), 60);
    // Hugo: sem previsão
    await atendimento(T, id.hugo, '2026-10-05', null);
  });

  const ler = (de: string, ate: string, filtro: { patientId?: string } = {}) => withTenant(T.ctx, (tx) => previsoesDeRetorno(tx, de, ate, filtro, agora), app.db);

  it('a previsão do atendimento mais novo (AG-D76), só de ativo sem consulta futura em STATUS_OCUPA; ordem por data; só id, nome e data', async () => {
    const r = await ler('2026-11-30', '2026-12-31');
    expect(r).toEqual([
      { patientId: id.ana, nome: 'Ana Souza', data: '2026-12-10' },
      { patientId: id.davi, nome: 'Davi Reis', data: '2026-12-07' },
      { patientId: id.gil, nome: 'Gil Prado', data: '2026-12-09' },
    ].sort((a, b) => a.data.localeCompare(b.data)));
  });

  it('o período é fechado nas duas pontas; filtro por paciente', async () => {
    expect((await ler('2026-12-10', '2026-12-10')).map((m) => m.patientId)).toEqual([id.ana]);
    expect(await ler('2026-12-11', '2026-12-31')).toEqual([]);
    expect(await ler('2026-11-30', '2026-12-31', { patientId: id.davi })).toEqual([{ patientId: id.davi, nome: 'Davi Reis', data: '2026-12-07' }]);
    expect(await ler('2026-11-30', '2026-12-31', { patientId: id.bia })).toEqual([]);
    expect(await ler('2026-11-30', '2026-12-31', { patientId: id.iara })).toEqual([]); // AG-D76: o mais novo não tem previsão
  });

  it('outro consultório não vê', async () => {
    const outro = await novoTenant(app.db);
    expect(await withTenant(outro.ctx, (tx) => previsoesDeRetorno(tx, '2026-11-30', '2026-12-31', {}, agora), app.db)).toEqual([]);
  });

  it('não grava audit_log (leitura da agenda, AG-D30)', async () => {
    const contar = async () => Number((await owner.db.execute<{ n: string }>(sql`select count(*) as n from audit_log where tenant_id = ${T.tenantId}`)).rows[0].n);
    const antes = await contar();
    await ler('2026-11-30', '2026-12-31');
    expect(await contar()).toBe(antes);
  });
});
