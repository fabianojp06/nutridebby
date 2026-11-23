import { afterAll, describe, expect, inject, it } from 'vitest';
import { localPrincipal, novoLocal } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { availabilityBlocks, availabilityRules, locaisAtendimento } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { MAX_REGRAS, MSG_AGENDA } from './constantes';
import { criarBloqueio, criarRegra, DisponibilidadeError, excluirBloqueio, excluirRegra, listarBloqueios, listarRegras, validarRegra } from './disponibilidade';
import { paraInstante } from './fuso';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const SP = 'America/Sao_Paulo';
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const TERCA = { diaSemana: '2', inicio: '08:00', fim: '12:00', duracaoMin: '60' };
const ESCOLHA_O_LOCAL = 'Escolha o local.';

/** Plano 23 (RN-410): toda regra nova tem local. O consultório de teste com o "Consultório" principal e a terça no local dado. */
async function comConsultorio(): Promise<TenantDeTeste & { consultorio: string; terca: Record<string, string> }> {
  const T = await novoTenant(app.db);
  const consultorio = await localPrincipal(app.db, T.ctx);
  return { ...T, consultorio, terca: { ...TERCA, localId: consultorio } };
}
const regrasNoBanco = (T: TenantDeTeste) =>
  withTenant(T.ctx, (tx) => tx.select().from(availabilityRules).orderBy(availabilityRules.diaSemana, availabilityRules.inicio, availabilityRules.modalidade), app.db);

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DisponibilidadeError) return e.erros;
    throw e;
  }
  throw new Error('esperava DisponibilidadeError');
};

describe('horários de atendimento (US-030)', () => {
  it('cria e lista em ordem de dia e hora; exclui', async () => {
    const T = await comConsultorio();
    await criarRegra(T.ctx, { ...T.terca, diaSemana: '4' }, deps);
    const [id] = await criarRegra(T.ctx, T.terca, deps);
    expect((await listarRegras(T.ctx, app.db)).map((r) => [r.diaSemana, r.inicio, r.fim, r.duracaoMin, r.modalidade, r.localId])).toEqual([
      [2, '08:00', '12:00', 60, 'presencial', T.consultorio],
      [4, '08:00', '12:00', 60, 'presencial', T.consultorio],
    ]);
    await excluirRegra(T.ctx, id, app.db);
    expect(await listarRegras(T.ctx, app.db)).toHaveLength(1);
  });

  it('"O fim deve ser depois do início" (início 12:00, fim 08:00); hora inválida; duração fora da faixa; não cabe', async () => {
    const T = await comConsultorio();
    expect(await erros(criarRegra(T.ctx, { ...T.terca, inicio: '12:00', fim: '08:00' }, deps))).toEqual({ fim: MSG_AGENDA.fimAntesDoInicio });
    expect(await erros(criarRegra(T.ctx, { ...T.terca, inicio: '25:00' }, deps))).toMatchObject({ inicio: MSG_AGENDA.horaInvalida });
    expect(await erros(criarRegra(T.ctx, { ...T.terca, duracaoMin: '10' }, deps))).toEqual({ duracaoMin: MSG_AGENDA.duracao });
    expect(await erros(criarRegra(T.ctx, { ...T.terca, fim: '08:30' }, deps))).toEqual({ duracaoMin: MSG_AGENDA.naoCabe });
    expect(await erros(criarRegra(T.ctx, { ...T.terca, diaSemana: '7', localId: '' }, deps))).toEqual({ diaSemana: MSG_AGENDA.diaSemana, localId: ESCOLHA_O_LOCAL });
  });

  it('não sobrepõe outra regra do mesmo dia no mesmo local (encostar pode); outro dia pode', async () => {
    const T = await comConsultorio();
    await criarRegra(T.ctx, T.terca, deps);
    expect(await erros(criarRegra(T.ctx, { ...T.terca, inicio: '11:00', fim: '13:00' }, deps))).toEqual({ inicio: MSG_AGENDA.sobreposicao });
    await expect(criarRegra(T.ctx, { ...T.terca, inicio: '12:00', fim: '14:00' }, deps)).resolves.toHaveLength(1);
    await expect(criarRegra(T.ctx, { ...T.terca, diaSemana: '3' }, deps)).resolves.toHaveLength(1);
  });

  it('a sessão de paciente não vê nem grava regras (staff_only, D11)', async () => {
    const T = await comConsultorio();
    await criarRegra(T.ctx, T.terca, deps);
    const p = await novoPaciente(app.db, T.ctx);
    const vistas = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.select().from(availabilityRules), app.db);
    expect(vistas).toEqual([]);
    await expect(criarRegra(ctxPaciente(T.tenantId, p.id), T.terca, deps)).rejects.toThrow('agenda: só a sessão nutri');
    // e o banco recusa a gravação direta da sessão de paciente (paciente_sem_insert), não só o módulo
    await expect(
      withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.insert(availabilityRules).values({ tenantId: T.tenantId, diaSemana: 3, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'presencial', localId: T.consultorio }), app.db),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await regrasNoBanco(T)).toHaveLength(1);
  });

  it('várias gravações ao mesmo tempo no mesmo horário: só uma entra (a trava por tenant serializa a checagem de sobreposição)', async () => {
    const T = await comConsultorio();
    // conexões do pool já abertas: sem isso, a 1ª gravação termina antes de a 2ª conseguir conexão e a corrida nem acontece
    await Promise.all(Array.from({ length: 6 }, () => listarRegras(T.ctx, app.db)));
    const tentativas = await Promise.allSettled(Array.from({ length: 6 }, () => criarRegra(T.ctx, T.terca, deps)));
    expect(tentativas.filter((t) => t.status === 'fulfilled')).toHaveLength(1);
    for (const t of tentativas) {
      if (t.status !== 'rejected') continue;
      expect(t.reason).toBeInstanceOf(DisponibilidadeError);
      expect((t.reason as DisponibilidadeError).erros).toEqual({ inicio: MSG_AGENDA.sobreposicao });
    }
    expect(await listarRegras(T.ctx, app.db)).toHaveLength(1);
  });

  it('Plano 23 (RN-410): "Você chegou ao limite de 60 horários. Apague um antes de criar outro." na 61ª regra; o par conta duas; excluir uma libera vaga', async () => {
    expect(MAX_REGRAS).toBe(60);
    expect(MSG_AGENDA.limiteRegras).toBe('Você chegou ao limite de 60 horários. Apague um antes de criar outro.');
    const T = await comConsultorio();
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online' });
    // 58 faixas de 15 min na segunda, sem sobreposição: 00:00–00:15, 00:15–00:30, ...
    const faixa = (i: number) => ({ diaSemana: '1', inicio: hhmm(i * 15), fim: hhmm(i * 15 + 15), duracaoMin: '15', localId: T.consultorio });
    const ids: string[] = [];
    for (let i = 0; i < MAX_REGRAS - 2; i++) ids.push(...(await criarRegra(T.ctx, faixa(i), deps)));
    // 58 + o par = 60: o par passaria do teto com 59 regras
    await expect(criarRegra(T.ctx, { ...T.terca, tambemOnline: 'on' }, deps)).resolves.toHaveLength(2);
    expect(await erros(criarRegra(T.ctx, { ...faixa(0), diaSemana: '3', localId: video }, deps))).toEqual({ geral: MSG_AGENDA.limiteRegras });
    await excluirRegra(T.ctx, ids[0], app.db);
    expect(await erros(criarRegra(T.ctx, { ...T.terca, diaSemana: '5', tambemOnline: 'on' }, deps))).toEqual({ geral: MSG_AGENDA.limiteRegras });
    await expect(criarRegra(T.ctx, { ...faixa(0), diaSemana: '3', localId: video }, deps)).resolves.toHaveLength(1);
    expect(await regrasNoBanco(T)).toHaveLength(MAX_REGRAS);
  });

  it('as regras de um consultório não aparecem nem são excluídas por outro; local de outro consultório → "Escolha o local."; id que não é uuid não faz nada', async () => {
    const A = await comConsultorio();
    const B = await comConsultorio();
    const [idA] = await criarRegra(A.ctx, A.terca, deps);
    expect(await listarRegras(B.ctx, app.db)).toEqual([]);
    expect(await erros(criarRegra(B.ctx, A.terca, deps))).toEqual({ localId: ESCOLHA_O_LOCAL });
    await excluirRegra(B.ctx, idA, app.db);
    expect(await listarRegras(A.ctx, app.db)).toHaveLength(1);
    await expect(excluirRegra(A.ctx, 'nao-e-uuid', app.db)).resolves.toBeUndefined();
  });

  it('Plano 23 (RN-410): regra sem local, com local que não é uuid ou com local arquivado → "Escolha o local."; a modalidade vem do tipo do local', async () => {
    const T = await comConsultorio();
    const arquivado = await novoLocal(app.db, T.ctx, { nome: 'Sala antiga', arquivado: true });
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online' });
    for (const localId of [undefined, '', 'nao-e-uuid', arquivado, '00000000-0000-4000-8000-000000000000'])
      expect(await erros(criarRegra(T.ctx, { ...TERCA, localId }, deps))).toEqual({ localId: ESCOLHA_O_LOCAL });
    // a modalidade do formulário antigo não manda: a regra no local online é online
    await criarRegra(T.ctx, { ...TERCA, localId: video, modalidade: 'presencial' }, deps);
    expect((await regrasNoBanco(T)).map((r) => [r.modalidade, r.localId])).toEqual([['online', video]]);
  });

  it('Plano 23 (RN-408, RN-410): a sobreposição é conferida por local — o mesmo horário em outro local entra', async () => {
    const T = await comConsultorio();
    const clinica = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
    await criarRegra(T.ctx, T.terca, deps);
    await expect(criarRegra(T.ctx, { ...T.terca, localId: clinica }, deps)).resolves.toHaveLength(1);
    expect(await erros(criarRegra(T.ctx, { ...T.terca, localId: clinica, inicio: '09:00', fim: '10:00' }, deps))).toEqual({ inicio: MSG_AGENDA.sobreposicao });
    expect((await listarRegras(T.ctx, app.db)).map((r) => r.localId).sort()).toEqual([T.consultorio, clinica].sort());
  });

  it('Plano 23 (RN-410, AG-D9): "Também atender por videoconferência nestes horários" cria o par numa transação; a segunda que falha não deixa nenhuma', async () => {
    const T = await comConsultorio();
    // sem local online ativo, o par não nasce: fica só a presencial
    await novoLocal(app.db, T.ctx, { nome: 'Vídeo arquivado', tipo: 'online', arquivado: true });
    await expect(criarRegra(T.ctx, { ...T.terca, diaSemana: '1', tambemOnline: 'on' }, deps)).resolves.toHaveLength(1);
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online' });
    const ids = await criarRegra(T.ctx, { ...T.terca, tambemOnline: 'on' }, deps);
    expect(ids).toHaveLength(2);
    const terca = (await regrasNoBanco(T)).filter((r) => r.diaSemana === 2);
    expect(terca.map((r) => [r.id, r.modalidade, r.localId, r.inicio, r.fim, r.duracaoMin])).toEqual([
      [ids[1], 'online', video, '08:00:00', '12:00:00', 60],
      [ids[0], 'presencial', T.consultorio, '08:00:00', '12:00:00', 60],
    ]);
    // a videoconferência já atende na quarta de manhã: o par de quarta choca na segunda gravação e nenhuma das duas fica
    await criarRegra(T.ctx, { ...T.terca, diaSemana: '3', inicio: '10:00', fim: '11:00', localId: video }, deps);
    expect(await erros(criarRegra(T.ctx, { ...T.terca, diaSemana: '3', tambemOnline: 'on' }, deps))).toEqual({ inicio: MSG_AGENDA.sobreposicao });
    expect((await regrasNoBanco(T)).filter((r) => r.diaSemana === 3).map((r) => [r.modalidade, r.inicio])).toEqual([['online', '10:00:00']]);
    // em regra online, a marca não faz nada (o par é só da presencial)
    await expect(criarRegra(T.ctx, { ...T.terca, diaSemana: '4', localId: video, tambemOnline: 'on' }, deps)).resolves.toHaveLength(1);
    // excluir uma metade do par não leva a outra (cada local tem a sua regra)
    await excluirRegra(T.ctx, ids[0], app.db);
    expect((await regrasNoBanco(T)).filter((r) => r.diaSemana === 2).map((r) => r.id)).toEqual([ids[1]]);
  });

  it('Plano 23 (RN-410a, AG-D45): ao listar os horários, a regra "ambas" sem local vira o par (presencial principal + online ativo), cada metade no seu local; consultório sem local ganha o "Consultório"', async () => {
    const T = await novoTenant(app.db);
    const locais = await withTenant(
      T.ctx,
      async (tx) => {
        const [c] = await tx.insert(locaisAtendimento).values({ tenantId: T.tenantId, nome: 'Consultório', tipo: 'presencial', agendamentoOnline: true, principal: true }).returning({ id: locaisAtendimento.id });
        const [v] = await tx.insert(locaisAtendimento).values({ tenantId: T.tenantId, nome: 'Videoconferência', tipo: 'online' }).returning({ id: locaisAtendimento.id });
        await tx.insert(availabilityRules).values({ tenantId: T.tenantId, diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'ambas' });
        return { c: c.id, v: v.id };
      },
      app.db,
    );
    const lista = await listarRegras(T.ctx, app.db);
    expect(lista.map((r) => [r.diaSemana, r.modalidade, r.localId]).sort()).toEqual([
      [2, 'online', locais.v],
      [2, 'presencial', locais.c],
    ]);
    const gravadas = await withTenant(T.ctx, (tx) => tx.select().from(availabilityRules).orderBy(availabilityRules.modalidade), app.db);
    expect(gravadas.map((r) => [r.modalidade, r.localId])).toEqual([
      ['online', locais.v],
      ['presencial', locais.c],
    ]);
    // consultório sem nenhum local: listar os horários cria o "Consultório" principal
    const U = await novoTenant(app.db);
    await listarRegras(U.ctx, app.db);
    expect((await withTenant(U.ctx, (tx) => tx.select().from(locaisAtendimento), app.db)).map((l) => [l.nome, l.principal])).toEqual([['Consultório', true]]);
  });

  it('Plano 23 (AG-D45, RN-410a): a regra antiga sem local conta na sobreposição do local em que vale; criarRegra dá a ela o local', async () => {
    const T = await comConsultorio();
    await withTenant(T.ctx, (tx) => tx.insert(availabilityRules).values({ tenantId: T.tenantId, diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'presencial' }), app.db);
    expect(await erros(criarRegra(T.ctx, { ...T.terca, inicio: '09:00', fim: '10:00' }, deps))).toEqual({ inicio: MSG_AGENDA.sobreposicao });
    await criarRegra(T.ctx, { ...T.terca, diaSemana: '3' }, deps);
    expect((await regrasNoBanco(T)).map((r) => [r.diaSemana, r.localId])).toEqual([
      [2, T.consultorio],
      [3, T.consultorio],
    ]);
  });

  it('validarRegra devolve a regra tipada: dia e duração vêm como texto do formulário, horas aparadas, modalidade e local do local', () => {
    const local = { id: '00000000-0000-4000-8000-0000000000aa', tipo: 'online' as const };
    expect(validarRegra({ diaSemana: '0', inicio: ' 08:00 ', fim: '09:00', duracaoMin: ' 30 ', modalidade: 'ambas' }, local)).toEqual({
      diaSemana: 0,
      inicio: '08:00',
      fim: '09:00',
      duracaoMin: 30,
      modalidade: 'online',
      localId: local.id,
    });
    expect(() => validarRegra({}, null)).toThrow(DisponibilidadeError);
  });
});

describe('bloqueios (US-030)', () => {
  it('"de 20/10/2026 a 24/10/2026, Congresso" cobre os dias inteiros no fuso do tenant', async () => {
    const T = await novoTenant(app.db);
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-20', dataFim: '2026-10-24', motivo: '  Congresso  ' }, deps);
    const [b] = await listarBloqueios(T.ctx, paraInstante('2026-10-01', '00:00', SP)!, paraInstante('2026-11-01', '00:00', SP)!, app.db);
    expect(b).toMatchObject({ motivo: 'Congresso', inicio: paraInstante('2026-10-20', '00:00', SP), fim: paraInstante('2026-10-25', '00:00', SP) });
  });

  it('com horas: 16/10 das 14:00 às 18:00; data final antes da inicial; mais de 366 dias; motivo longo', async () => {
    const T = await novoTenant(app.db);
    const id = await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-16', horaInicio: '14:00', dataFim: '2026-10-16', horaFim: '18:00', motivo: '' }, deps);
    const [b] = await listarBloqueios(T.ctx, paraInstante('2026-10-16', '00:00', SP)!, paraInstante('2026-10-17', '00:00', SP)!, app.db);
    expect([b.inicio.toISOString(), b.fim.toISOString()]).toEqual(['2026-10-16T17:00:00.000Z', '2026-10-16T21:00:00.000Z']);
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-20', dataFim: '2026-10-19' }, deps))).toEqual({ dataFim: MSG_AGENDA.dataFinalAntes });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-01-01', dataFim: '2027-01-02' }, deps))).toEqual({ dataFim: MSG_AGENDA.bloqueioLongo });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-20', motivo: 'x'.repeat(121) }, deps))).toEqual({ motivo: MSG_AGENDA.motivoLongo });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-02-30' }, deps))).toEqual({ dataInicio: MSG_AGENDA.dataInvalida });
    // teto de datas da agenda (revisão final): hoje + 5 anos no fuso do tenant; 9999-12-31 não dá 500
    const now = new Date('2026-10-01T12:00:00Z');
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '9999-12-31' }, { ...deps, now }))).toEqual({ dataInicio: MSG_AGENDA.dataInvalida });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2031-09-30', dataFim: '9999-12-31' }, { ...deps, now }))).toEqual({ dataFim: MSG_AGENDA.dataInvalida });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2031-10-02', horaInicio: '08:00', horaFim: '09:00' }, { ...deps, now }))).toEqual({ dataInicio: MSG_AGENDA.dataInvalida });
    await expect(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2031-10-01' }, { ...deps, now })).resolves.toEqual(expect.any(String));
    await excluirBloqueio(T.ctx, id, app.db);
    await expect(excluirBloqueio(T.ctx, 'nao-e-uuid', app.db)).resolves.toBeUndefined();
  });

  it('hora que não existe no dia (início do horário de verão) é recusada; hora de fim sem data final usa a data inicial', async () => {
    const T = await novoTenant(app.db);
    const NY = 'America/New_York';
    // 08/03/2026, 02:30 não existe em Nova York (os relógios pulam de 02:00 para 03:00)
    expect(await erros(criarBloqueio(T.ctx, { fuso: NY }, { dataInicio: '2026-03-08', horaInicio: '02:30', horaFim: '05:00' }, deps))).toEqual({ horaInicio: MSG_AGENDA.horaInexistente });
    expect(await erros(criarBloqueio(T.ctx, { fuso: NY }, { dataInicio: '2026-03-08', horaInicio: '01:00', horaFim: '02:30' }, deps))).toEqual({ horaFim: MSG_AGENDA.horaInexistente });
    // revisão final: no mesmo dia, fim antes (ou igual) do início é erro da hora de fim, não da data final
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-16', horaInicio: '18:00', horaFim: '14:00' }, deps))).toEqual({ horaFim: MSG_AGENDA.fimAntesDoInicio });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-16', dataFim: '2026-10-16', horaInicio: '14:00', horaFim: '14:00' }, deps))).toEqual({ horaFim: MSG_AGENDA.fimAntesDoInicio });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-16', horaFim: '00:00' }, deps))).toEqual({ horaFim: MSG_AGENDA.fimAntesDoInicio });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-16', horaInicio: '08:00', dataFim: '2026-10-15', horaFim: '18:00' }, deps))).toEqual({ dataFim: MSG_AGENDA.dataFinalAntes });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-16', horaInicio: '25:00', horaFim: '7:5' }, deps))).toEqual({ horaInicio: MSG_AGENDA.horaInvalida, horaFim: MSG_AGENDA.horaInvalida });
    expect(await listarBloqueios(T.ctx, new Date('2020-01-01T00:00:00Z'), new Date('2040-01-01T00:00:00Z'), app.db)).toEqual([]);
  });

  it('lista só os bloqueios que tocam [de, ate), em ordem de início; encostar não conta', async () => {
    const T = await novoTenant(app.db);
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-22', motivo: 'depois' }, deps);
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-20', dataFim: '2026-10-21', motivo: 'dentro' }, deps);
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-19', motivo: 'antes (termina às 00:00 do dia 20)' }, deps);
    const de = paraInstante('2026-10-20', '00:00', SP)!;
    const ate = paraInstante('2026-10-22', '00:00', SP)!;
    expect((await listarBloqueios(T.ctx, de, ate, app.db)).map((b) => b.motivo)).toEqual(['dentro']);
    expect((await listarBloqueios(T.ctx, de, new Date(ate.getTime() + 1), app.db)).map((b) => b.motivo)).toEqual(['dentro', 'depois']);
  });

  it('a sessão de paciente não vê bloqueios (staff_only, D11) e um consultório não vê nem exclui os do outro', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const id = await criarBloqueio(A.ctx, { fuso: SP }, { dataInicio: '2026-10-20', motivo: 'Médico' }, deps);
    const p = await novoPaciente(app.db, A.ctx);
    expect(await withTenant(ctxPaciente(A.tenantId, p.id), (tx) => tx.select().from(availabilityBlocks), app.db)).toEqual([]);
    const todos = [new Date('2020-01-01T00:00:00Z'), new Date('2040-01-01T00:00:00Z')] as const;
    expect(await listarBloqueios(B.ctx, ...todos, app.db)).toEqual([]);
    await excluirBloqueio(B.ctx, id, app.db);
    expect(await listarBloqueios(A.ctx, ...todos, app.db)).toHaveLength(1);
  });
});
