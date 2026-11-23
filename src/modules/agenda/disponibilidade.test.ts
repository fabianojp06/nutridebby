import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
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
const TERCA = { diaSemana: '2', inicio: '08:00', fim: '12:00', duracaoMin: '60', modalidade: 'presencial' };

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
    const T = await novoTenant(app.db);
    await criarRegra(T.ctx, { ...TERCA, diaSemana: '4' }, deps);
    const id = await criarRegra(T.ctx, TERCA, deps);
    expect((await listarRegras(T.ctx, app.db)).map((r) => [r.diaSemana, r.inicio, r.fim, r.duracaoMin, r.modalidade])).toEqual([
      [2, '08:00', '12:00', 60, 'presencial'],
      [4, '08:00', '12:00', 60, 'presencial'],
    ]);
    await excluirRegra(T.ctx, id, app.db);
    expect(await listarRegras(T.ctx, app.db)).toHaveLength(1);
  });

  it('"O fim deve ser depois do início" (início 12:00, fim 08:00); hora inválida; duração fora da faixa; não cabe', async () => {
    const T = await novoTenant(app.db);
    expect(await erros(criarRegra(T.ctx, { ...TERCA, inicio: '12:00', fim: '08:00' }, deps))).toEqual({ fim: MSG_AGENDA.fimAntesDoInicio });
    expect(await erros(criarRegra(T.ctx, { ...TERCA, inicio: '25:00' }, deps))).toMatchObject({ inicio: MSG_AGENDA.horaInvalida });
    expect(await erros(criarRegra(T.ctx, { ...TERCA, duracaoMin: '10' }, deps))).toEqual({ duracaoMin: MSG_AGENDA.duracao });
    expect(await erros(criarRegra(T.ctx, { ...TERCA, fim: '08:30' }, deps))).toEqual({ duracaoMin: MSG_AGENDA.naoCabe });
    expect(await erros(criarRegra(T.ctx, { ...TERCA, diaSemana: '7', modalidade: 'x' }, deps))).toEqual({ diaSemana: MSG_AGENDA.diaSemana, modalidade: MSG_AGENDA.modalidade });
  });

  it('não sobrepõe outra regra do mesmo dia (encostar pode); outro dia pode', async () => {
    const T = await novoTenant(app.db);
    await criarRegra(T.ctx, TERCA, deps);
    expect(await erros(criarRegra(T.ctx, { ...TERCA, inicio: '11:00', fim: '13:00' }, deps))).toEqual({ inicio: MSG_AGENDA.sobreposicao });
    await expect(criarRegra(T.ctx, { ...TERCA, inicio: '12:00', fim: '14:00' }, deps)).resolves.toBeTypeOf('string');
    await expect(criarRegra(T.ctx, { ...TERCA, diaSemana: '3' }, deps)).resolves.toBeTypeOf('string');
  });

  it('a sessão de paciente não vê nem grava regras (staff_only, D11)', async () => {
    const T = await novoTenant(app.db);
    await criarRegra(T.ctx, TERCA, deps);
    const p = await novoPaciente(app.db, T.ctx);
    const vistas = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.select().from(availabilityRules), app.db);
    expect(vistas).toEqual([]);
  });

  it('várias gravações ao mesmo tempo no mesmo horário: só uma entra (a trava por tenant serializa a checagem de sobreposição)', async () => {
    const T = await novoTenant(app.db);
    // conexões do pool já abertas: sem isso, a 1ª gravação termina antes de a 2ª conseguir conexão e a corrida nem acontece
    await Promise.all(Array.from({ length: 6 }, () => listarRegras(T.ctx, app.db)));
    const tentativas = await Promise.allSettled(Array.from({ length: 6 }, () => criarRegra(T.ctx, TERCA, deps)));
    expect(tentativas.filter((t) => t.status === 'fulfilled')).toHaveLength(1);
    for (const t of tentativas) {
      if (t.status !== 'rejected') continue;
      expect(t.reason).toBeInstanceOf(DisponibilidadeError);
      expect((t.reason as DisponibilidadeError).erros).toEqual({ inicio: MSG_AGENDA.sobreposicao });
    }
    expect(await listarRegras(T.ctx, app.db)).toHaveLength(1);
  });

  it('"Limite de 30 horários de atendimento." na 31ª regra; excluir uma libera vaga', async () => {
    const T = await novoTenant(app.db);
    // 30 faixas de 15 min no mesmo dia, sem sobreposição: 00:00–00:15, 00:15–00:30, ...
    const faixa = (i: number) => {
      const h = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      return { diaSemana: '1', inicio: h(i * 15), fim: h(i * 15 + 15), duracaoMin: '15', modalidade: 'online' };
    };
    const ids: string[] = [];
    for (let i = 0; i < MAX_REGRAS; i++) ids.push(await criarRegra(T.ctx, faixa(i), deps));
    expect(await erros(criarRegra(T.ctx, { ...faixa(0), diaSemana: '2' }, deps))).toEqual({ geral: MSG_AGENDA.limiteRegras });
    await excluirRegra(T.ctx, ids[0], app.db);
    await expect(criarRegra(T.ctx, { ...faixa(0), diaSemana: '2' }, deps)).resolves.toBeTypeOf('string');
  });

  it('as regras de um consultório não aparecem nem são excluídas por outro; id que não é uuid não faz nada', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const idA = await criarRegra(A.ctx, TERCA, deps);
    expect(await listarRegras(B.ctx, app.db)).toEqual([]);
    await excluirRegra(B.ctx, idA, app.db);
    expect(await listarRegras(A.ctx, app.db)).toHaveLength(1);
    await expect(excluirRegra(A.ctx, 'nao-e-uuid', app.db)).resolves.toBeUndefined();
  });

  it('par "ambas" desdobrado pelo backfill (AG-D47): a tela antiga lista UMA regra "ambas", o limite conta uma e excluir apaga as duas metades', async () => {
    const T = await novoTenant(app.db);
    // como a 0131 deixa: Consultório (presencial principal) e Videoconferência (online com sala); "ambas" virou presencial + cópia online
    const par = await withTenant(
      T.ctx,
      async (tx) => {
        const [c] = await tx.insert(locaisAtendimento).values({ tenantId: T.tenantId, nome: 'Consultório', tipo: 'presencial', agendamentoOnline: true, principal: true }).returning({ id: locaisAtendimento.id });
        const [v] = await tx
          .insert(locaisAtendimento)
          .values({ tenantId: T.tenantId, nome: 'Videoconferência', tipo: 'online', linkSala: 'https://sala.example.test/debby', agendamentoOnline: true })
          .returning({ id: locaisAtendimento.id });
        const base = { tenantId: T.tenantId, diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60 };
        // a cópia online primeiro: a junção não depende da ordem de leitura
        const [o] = await tx.insert(availabilityRules).values({ ...base, modalidade: 'online', localId: v.id }).returning({ id: availabilityRules.id });
        const [pr] = await tx.insert(availabilityRules).values({ ...base, modalidade: 'presencial', localId: c.id }).returning({ id: availabilityRules.id });
        return { online: o.id, presencial: pr.id };
      },
      app.db,
    );
    const lista = await listarRegras(T.ctx, app.db);
    expect(lista).toEqual([{ id: par.presencial, diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'ambas' }]);
    // "ambas" criada pela tela antiga depois do backfill: sem local, aparece ao lado do par
    const nova = await criarRegra(T.ctx, { ...TERCA, diaSemana: '3', modalidade: 'ambas' }, deps);
    expect((await listarRegras(T.ctx, app.db)).map((r) => [r.id, r.modalidade])).toEqual([
      [par.presencial, 'ambas'],
      [nova, 'ambas'],
    ]);
    expect(await withTenant(T.ctx, (tx) => tx.select({ localId: availabilityRules.localId }).from(availabilityRules).where(eq(availabilityRules.id, nova)), app.db)).toEqual([{ localId: null }]);
    // o limite conta o par como uma: par + "ambas" nova + MAX_REGRAS − 3 faixas = MAX_REGRAS linhas no banco, MAX_REGRAS − 1 regras na tela
    const faixa = (i: number) => ({ diaSemana: '1', inicio: hhmm(i * 15), fim: hhmm(i * 15 + 15), duracaoMin: '15', modalidade: 'online' });
    for (let i = 0; i < MAX_REGRAS - 3; i++) await criarRegra(T.ctx, faixa(i), deps);
    expect(await listarRegras(T.ctx, app.db)).toHaveLength(MAX_REGRAS - 1);
    await expect(criarRegra(T.ctx, { ...TERCA, diaSemana: '5' }, deps)).resolves.toBeTypeOf('string');
    expect(await listarRegras(T.ctx, app.db)).toHaveLength(MAX_REGRAS);
    expect(await erros(criarRegra(T.ctx, { ...TERCA, diaSemana: '6' }, deps))).toEqual({ geral: MSG_AGENDA.limiteRegras });
    // excluir pelo id da lista (metade presencial) apaga as duas metades; o resto fica
    await excluirRegra(T.ctx, par.presencial, app.db);
    const ids = (await withTenant(T.ctx, (tx) => tx.select({ id: availabilityRules.id }).from(availabilityRules), app.db)).map((r) => r.id);
    expect(ids).not.toContain(par.presencial);
    expect(ids).not.toContain(par.online);
    expect(ids).toHaveLength(MAX_REGRAS - 1);
    await expect(criarRegra(T.ctx, { ...TERCA, diaSemana: '6' }, deps)).resolves.toBeTypeOf('string');
  });

  it('excluir pela metade online do par também apaga a presencial; regra solta de mesma faixa em outro dia fica', async () => {
    const T = await novoTenant(app.db);
    const par = await withTenant(
      T.ctx,
      async (tx) => {
        const base = { tenantId: T.tenantId, diaSemana: 4, inicio: '14:00', fim: '18:00', duracaoMin: 30 };
        const [o] = await tx.insert(availabilityRules).values({ ...base, modalidade: 'online' }).returning({ id: availabilityRules.id });
        const [pr] = await tx.insert(availabilityRules).values({ ...base, modalidade: 'presencial' }).returning({ id: availabilityRules.id });
        const [solta] = await tx.insert(availabilityRules).values({ ...base, diaSemana: 5, modalidade: 'presencial' }).returning({ id: availabilityRules.id });
        return { online: o.id, presencial: pr.id, solta: solta.id };
      },
      app.db,
    );
    expect((await listarRegras(T.ctx, app.db)).map((r) => [r.id, r.modalidade])).toEqual([
      [par.presencial, 'ambas'],
      [par.solta, 'presencial'],
    ]);
    await excluirRegra(T.ctx, par.online, app.db);
    expect((await listarRegras(T.ctx, app.db)).map((r) => [r.id, r.modalidade])).toEqual([[par.solta, 'presencial']]);
  });

  it('validarRegra devolve a regra tipada: dia e duração vêm como texto do formulário, horas aparadas', () => {
    expect(validarRegra({ diaSemana: '0', inicio: ' 08:00 ', fim: '09:00', duracaoMin: ' 30 ', modalidade: 'ambas' })).toEqual({
      diaSemana: 0,
      inicio: '08:00',
      fim: '09:00',
      duracaoMin: 30,
      modalidade: 'ambas',
    });
    expect(() => validarRegra({})).toThrow(DisponibilidadeError);
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
