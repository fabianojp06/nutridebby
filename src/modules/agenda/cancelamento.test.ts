import { inspect } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, perdeDeadlockNoBanco, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import * as schema from '@/db/schema';
import { appointments, auditLog, notifications, patients, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { agendarComoPaciente } from './agendamento-paciente';
import { cancelarConsulta, confirmarPresenca, ConsultaMudouError, pedirRemarcacao, podeAlterarPeloPaciente, remarcarComoPaciente } from './cancelamento';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, ConsultaNaoEncontradaError, motivoDoCancelamentoDaNutri } from './consultas';
import { novidadesDaAgenda } from './presenca';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só lê pg_stat_activity (a gravação ficou presa na trava)
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const deps = (now: Date) => ({ db: app.db, now, appUrl: 'http://localhost:3000' });
const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConsultaError) return e.erros;
    throw e;
  }
  throw new Error('esperava ConsultaError');
};
const consulta = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0];
const consultasDo = (T: TenantDeTeste, patientId: string) => withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, patientId)), app.db);
const lembretes = (T: TenantDeTeste, id: string) => withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, id)), app.db);
const emailDaNutri = async (T: TenantDeTeste) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId)))[0].email;

describe('RN-04: prazo do paciente', () => {
  it('pode até cancelamento_min_h antes do início (24 h em ponto ainda pode)', () => {
    const inicio = em('2026-10-16', '14:00');
    expect(podeAlterarPeloPaciente(inicio, 24, em('2026-10-15', '14:00'))).toBe(true);
    expect(podeAlterarPeloPaciente(inicio, 24, em('2026-10-15', '14:01'))).toBe(false);
  });
});

describe('remarcar e cancelar (US-033)', () => {
  it('dentro do prazo (30 h antes): a antiga fica "cancelada" pelo paciente, a nova nasce ligada a ela; lembretes trocados; nutricionista avisada', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const { id } = await agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '14:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-10', '09:00')));
    const novo = await remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-17', '10:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-15', '08:00')));
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'paciente' });
    expect(await consulta(T, novo.id)).toMatchObject({ status: 'agendada', origem: 'paciente', remarcadaDe: id, inicio: em('2026-10-17', '10:00') });
    expect((await lembretes(T, id)).filter((n) => n.tipo.startsWith('lembrete')).every((n) => n.status === 'ignorada' && n.motivoIgnorada === 'consulta_cancelada')).toBe(true);
    expect((await lembretes(T, novo.id)).filter((n) => n.tipo === 'lembrete_24h' && n.status === 'pendente')).toHaveLength(3);
    expect((await emailsNaFila('aviso_agenda', await emailDaNutri(T))).map((m) => m.evento).sort()).toEqual(['marcada', 'remarcada']);
  });

  it('remarcar para um horário que encosta ou se sobrepõe à própria consulta funciona (ela não ocupa a si mesma)', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx, { duracaoMin: 30 });
    const ana = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const { id } = await agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '14:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-10', '09:00')));
    await expect(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-16', '14:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-11', '09:00')))).resolves.toMatchObject({ inicio: em('2026-10-16', '14:00') });
  });

  it('fora do prazo (20 h antes): "Para alterar, fale com sua nutricionista." — a nutricionista pode a qualquer momento', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const vinteHorasAntes = deps(em('2026-10-15', '18:00'));
    expect(await erro(cancelarConsulta(ctx, tenantAgenda(T), id, { por: 'paciente' }, vinteHorasAntes))).toEqual({ geral: MSG_AGENDA.foraDoPrazo });
    expect(await erro(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-20', '10:00').toISOString(), modalidade: 'presencial' }, vinteHorasAntes))).toEqual({ geral: MSG_AGENDA.foraDoPrazo });
    await cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri', motivo: '  Imprevisto  ' }, vinteHorasAntes);
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'nutri', motivoCancelamento: 'Imprevisto' });
    const aviso = (await lembretes(T, id)).filter((n) => n.tipo === 'consulta_cancelada');
    expect(aviso.map((n) => `${n.canal}/${n.status}`).sort()).toEqual(['email/pendente', 'push/pendente']);
    expect(await erro(cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri' }, vinteHorasAntes))).toEqual({ geral: MSG_AGENDA.naoCancelavel });
  });

  it('rodada 1 da T7: a nutricionista trava o paciente antes da consulta (a ordem de remarcarComoPaciente e moverConsulta) — sem deadlock com a remarcação do paciente', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
    const outra = await app.pool.connect();
    let confirmada = false;
    try {
      // como remarcarComoPaciente / moverConsulta: o paciente travado (FOR UPDATE) antes da consulta
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      await outra.query('select 1 from patients where id = $1 for update', [ana.id]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const cancelamento = cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri' }, deps(em('2026-10-10', '09:00'))).then(
        () => null,
        (e: unknown) => e,
      );
      for (let i = 0; ; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 200) throw new Error('o cancelamento não ficou preso na trava do paciente');
        await new Promise((r) => setTimeout(r, 10));
      }
      // o cancelamento espera o paciente SEM ter pegado a consulta: quem segura o paciente ainda a trava sem esperar
      await outra.query('select 1 from appointments where id = $1 for update nowait', [id]);
      await outra.query('commit');
      confirmada = true;
      expect(await cancelamento).toBeNull();
    } finally {
      if (!confirmada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'nutri' });
  });

  it('revisão final: remarcar numa corrida no EXCLUDE que vira 40P01 → repete uma vez: "Esse horário acabou de ser ocupado. Escolha outro."; a antiga continua marcada', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' }), await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })];
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-20', '09:00'), 60, { origem: 'paciente' });
    const novo = em('2026-10-16', '15:00');
    const err = await perdeDeadlockNoBanco({ app: app.pool, owner: owner.pool }, T, bia.id, [{ inicio: novo, minutos: 30 }, { inicio: em('2026-10-16', '15:30'), minutos: 30 }], () =>
      remarcarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), id, { inicio: novo.toISOString(), modalidade: 'presencial' }, deps(em('2026-10-14', '10:00'))),
    );
    expect(err, inspect(err)).toBeInstanceOf(ConsultaError);
    expect((err as ConsultaError).erros).toEqual({ inicio: MSG_AGENDA.ocupado });
    expect((await consultasDo(T, ana.id)).map((c) => [c.id, c.status])).toEqual([[id, 'agendada']]);
  });

  it('rodada 1 da T7: a nutricionista cancela consulta de paciente bloqueado ou anonimizado (a trava do paciente não recusa)', async () => {
    for (const mudanca of [{ status: 'bloqueado' }, { anonimizadoEm: em('2026-10-01', '09:00') }]) {
      const T = await novoTenant(app.db);
      const ana = await novoPaciente(app.db, T.ctx);
      const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
      await withTenant(T.ctx, (tx) => tx.update(patients).set(mudanca).where(eq(patients.id, ana.id)), app.db);
      await cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri' }, deps(em('2026-10-10', '09:00')));
      expect(await consulta(T, id), JSON.stringify(mudanca)).toMatchObject({ status: 'cancelada', canceladoPor: 'nutri' });
    }
  });

  it('D22: cancelar uma consulta que já começou (acerto da agenda pela nutricionista) não manda "Consulta cancelada" ao paciente', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
    await cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri' }, deps(em('2026-10-16', '14:30')));
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'nutri' });
    expect((await lembretes(T, id)).filter((n) => n.tipo === 'consulta_cancelada')).toEqual([]);
  });

  it('Review Focus 6 (rodada 1): remarcar com um pool de UMA conexão conclui — o horário é escolhido antes da transação, nunca numa segunda conexão dentro dela', async () => {
    const umaConexao = new Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });
    try {
      const T = await novoTenant(app.db);
      await semanaToda(app.db, T.ctx);
      const ana = await novoPaciente(app.db, T.ctx);
      const ctx = ctxPaciente(T.tenantId, ana.id);
      const { id } = await agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '14:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-10', '09:00')));
      const db1 = drizzle({ client: umaConexao, schema });
      await expect(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-17', '10:00').toISOString(), modalidade: 'presencial' }, { db: db1, now: em('2026-10-11', '09:00'), appUrl: 'http://localhost:3000' })).resolves.toMatchObject({ inicio: em('2026-10-17', '10:00') });
    } finally {
      await umaConexao.end();
    }
  }, 15_000);

  it('rodada 1 (RN-08, US-018): paciente arquivado, bloqueado ou anonimizado não confirma, não pede remarcação, não cancela nem remarca', async () => {
    for (const mudanca of [{ status: 'arquivado' }, { status: 'bloqueado' }, { anonimizadoEm: em('2026-10-01', '09:00') }]) {
      const T = await novoTenant(app.db);
      await semanaToda(app.db, T.ctx);
      const ana = await novoPaciente(app.db, T.ctx);
      const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
      await withTenant(T.ctx, (tx) => tx.update(patients).set(mudanca).where(eq(patients.id, ana.id)), app.db);
      const ctx = ctxPaciente(T.tenantId, ana.id);
      const d = deps(em('2026-10-10', '09:00'));
      expect(await confirmarPresenca(ctx, id, 'whatsapp', d), JSON.stringify(mudanca)).toBe('nao_confirmavel');
      expect(await pedirRemarcacao(ctx, tenantAgenda(T), id, d)).toBe(false);
      expect(await erro(cancelarConsulta(ctx, tenantAgenda(T), id, { por: 'paciente' }, d))).toEqual({ geral: MSG_AGENDA.foraDoPrazo });
      await expect(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-17', '10:00').toISOString(), modalidade: 'presencial' }, d)).rejects.toSatisfy(
        (e: unknown) => e instanceof PacienteBloqueadoError || (e instanceof ConsultaError && e.erros.geral === MSG_AGENDA.naoAgendavel),
      );
      expect(await consulta(T, id)).toMatchObject({ status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
      expect(await consultasDo(T, ana.id)).toHaveLength(1); // a remarcação recusada não deixou consulta nova
    }
  });

  it('revisão final: o motivo do cancelamento da nutricionista ("Só você vê.") volta só para ela, sem leitura auditada (D10); o do paciente e o de outro consultório, não', async () => {
    const [T, U] = [await novoTenant(app.db), await novoTenant(app.db)];
    const ana = await novoPaciente(app.db, T.ctx);
    const d = deps(em('2026-10-10', '09:00'));
    const [comMotivo, semMotivo, ativa, peloPaciente] = [
      await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '09:00')),
      await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '11:00')),
      await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '13:00')),
      await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '15:00')),
    ];
    await cancelarConsulta(T.ctx, tenantAgenda(T), comMotivo, { por: 'nutri', motivo: '  Viagem pessoal  ' }, d);
    await cancelarConsulta(T.ctx, tenantAgenda(T), semMotivo, { por: 'nutri' }, d);
    await withTenant(T.ctx, (tx) => tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'paciente', canceladaEm: new Date(), motivoCancelamento: 'Remarcada pelo paciente' }).where(eq(appointments.id, peloPaciente)), app.db);
    expect(await motivoDoCancelamentoDaNutri(T.ctx, comMotivo, app.db)).toBe('Viagem pessoal');
    expect(await motivoDoCancelamentoDaNutri(T.ctx, semMotivo, app.db)).toBeNull();
    expect(await motivoDoCancelamentoDaNutri(T.ctx, ativa, app.db)).toBeNull();
    expect(await motivoDoCancelamentoDaNutri(T.ctx, peloPaciente, app.db)).toBeNull();
    expect(await motivoDoCancelamentoDaNutri(T.ctx, 'nao-e-uuid', app.db)).toBeNull();
    expect(await motivoDoCancelamentoDaNutri(U.ctx, comMotivo, app.db)).toBeNull(); // outro consultório (RLS)
    await expect(motivoDoCancelamentoDaNutri(ctxPaciente(T.tenantId, ana.id), comMotivo, app.db)).rejects.toThrow();
    // D10: leitura da agenda sem auditRead — nenhuma linha "ler" da consulta
    const leituras = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidadeId, comMotivo), eq(auditLog.acao, 'ler'))), app.db);
    expect(leituras).toEqual([]);
  });

  it('paciente não cancela consulta de outro paciente (RLS) e o motivo tem até 300 caracteres', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const id = await consultaDireta(app.db, T.ctx, p1.id, em('2026-10-16', '14:00'));
    await expect(cancelarConsulta(ctxPaciente(T.tenantId, p2.id), tenantAgenda(T), id, { por: 'paciente' }, deps(em('2026-10-10', '09:00')))).rejects.toBeInstanceOf(ConsultaNaoEncontradaError);
    expect(await erro(cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri', motivo: 'x'.repeat(301) }, deps(em('2026-10-10', '09:00'))))).toEqual({ motivo: 'Use no máximo 300 caracteres' });
    expect(MSG_AGENDA.motivoCancelamentoLongo).toBe('Use no máximo 300 caracteres'); // R13
    // o papel tem de bater com quem cancela: sessão de paciente não cancela "como a nutricionista" (sem prazo)
    await expect(cancelarConsulta(ctxPaciente(T.tenantId, p1.id), tenantAgenda(T), id, { por: 'nutri' }, deps(em('2026-10-16', '13:00')))).rejects.toThrow();
    expect(await consulta(T, id)).toMatchObject({ status: 'agendada' });
  });

  it('revisão da T5 (D20): com o início do link, a consulta que mudou de horário depois do link não é confirmada, cancelada, remarcada nem recebe pedido — nada muda', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const d = { ...deps(em('2026-10-10', '09:00')), inicioDoLink: em('2026-10-16', '15:00') }; // link de quando a consulta era às 15:00
    await expect(confirmarPresenca(ctx, id, 'link', d)).rejects.toBeInstanceOf(ConsultaMudouError);
    await expect(pedirRemarcacao(ctx, tenantAgenda(T), id, d)).rejects.toBeInstanceOf(ConsultaMudouError);
    await expect(cancelarConsulta(ctx, tenantAgenda(T), id, { por: 'paciente' }, d)).rejects.toBeInstanceOf(ConsultaMudouError);
    await expect(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-17', '10:00').toISOString(), modalidade: 'presencial' }, d)).rejects.toBeInstanceOf(ConsultaMudouError);
    expect(await consulta(T, id)).toMatchObject({ status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
    expect(await consultasDo(T, ana.id)).toHaveLength(1);
    expect(await confirmarPresenca(ctx, id, 'link', { ...d, inicioDoLink: em('2026-10-16', '14:00') })).toBe('confirmada'); // o início atual vale
  });
});

describe('confirmar presença e pedir remarcação (US-035)', () => {
  it('confirmar: "agendada" → "confirmada" (via link); de novo não muda; depois do início, não confirma; limpa o pedido de remarcação', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'), 60, { pedidoRemarcacaoEm: em('2026-10-10', '09:00') });
    const ctx = ctxPaciente(T.tenantId, ana.id);
    expect(await confirmarPresenca(ctx, id, 'link', deps(em('2026-10-15', '09:00')))).toBe('confirmada');
    expect(await consulta(T, id)).toMatchObject({ status: 'confirmada', confirmadaVia: 'link', pedidoRemarcacaoEm: null });
    expect(await confirmarPresenca(ctx, id, 'whatsapp', deps(em('2026-10-15', '10:00')))).toBe('ja_confirmada');
    expect((await consulta(T, id)).confirmadaVia).toBe('link');
    const outra = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-17', '14:00'));
    expect(await confirmarPresenca(ctx, outra, 'link', deps(em('2026-10-17', '14:30')))).toBe('nao_confirmavel');
  });

  it('code-review do PR #7: confirmar de novo a consulta já "confirmada" com pedido de remarcação em aberto ("1" → "2" → "1") desfaz o pedido, sem trocar a via; sem pedido, nada muda', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
    const ctx = ctxPaciente(T.tenantId, ana.id);
    expect(await confirmarPresenca(ctx, id, 'whatsapp', deps(em('2026-10-15', '09:00')))).toBe('confirmada');
    expect(await pedirRemarcacao(ctx, tenantAgenda(T), id, deps(em('2026-10-15', '09:05')))).toBe(true);
    // `naMesmaTransacao` fica sabendo se a ação mudou algo (o webhook responde a cada mudança)
    const mudou: boolean[] = [];
    const registrar = (now: Date) => ({ ...deps(now), naMesmaTransacao: async (_tx: unknown, _c: unknown, m: boolean) => void mudou.push(m) });
    expect(await confirmarPresenca(ctx, id, 'link', registrar(em('2026-10-15', '09:10')))).toBe('ja_confirmada');
    expect(await consulta(T, id)).toMatchObject({ status: 'confirmada', confirmadaVia: 'whatsapp', pedidoRemarcacaoEm: null });
    // "Pedidos de remarcação" do painel não lista mais a consulta
    expect((await novidadesDaAgenda(T.ctx, em('2026-10-15', '09:15'), app.db)).pedidosRemarcacao).toEqual([]);
    expect(await confirmarPresenca(ctx, id, 'whatsapp', registrar(em('2026-10-15', '09:20')))).toBe('ja_confirmada');
    expect(mudou).toEqual([true, false]);
  });

  it('pedir remarcação: grava uma vez e avisa a nutricionista uma vez', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
    const ctx = ctxPaciente(T.tenantId, ana.id);
    expect(await pedirRemarcacao(ctx, tenantAgenda(T), id, deps(em('2026-10-16', '09:00')))).toBe(true);
    expect(await pedirRemarcacao(ctx, tenantAgenda(T), id, deps(em('2026-10-16', '09:05')))).toBe(false);
    expect((await consulta(T, id)).pedidoRemarcacaoEm).toEqual(em('2026-10-16', '09:00'));
    const avisos = await emailsNaFila('aviso_agenda', await emailDaNutri(T));
    expect(avisos.filter((m) => m.evento === 'pedido_remarcacao')).toHaveLength(1);
  });
});
