import { inspect } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, dbQueMudaNoMeio, em, novoLocal, perdeCorridaNoBanco, perdeDeadlockNoBanco, semanaNoLocal, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import * as schema from '@/db/schema';
import { appointments, locaisAtendimento, notifications, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { agendarComoPaciente, escolherHorario, horariosParaPaciente, janelaDoPaciente, locaisDoAgendamento } from './agendamento-paciente';
import { remarcarComoPaciente } from './cancelamento';
import { MSG_AGENDA } from './constantes';
import { ConsultaError } from './consultas';
import { partesNoFuso } from './fuso';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const SP = 'America/Sao_Paulo';
const agora = em('2026-10-14', '10:00');
const deps = { db: app.db, now: agora, appUrl: 'http://localhost:3000' };
const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConsultaError) return e.erros;
    throw e;
  }
  throw new Error('esperava ConsultaError');
};

describe('horários para o paciente (US-032, RN-03)', () => {
  it('às 10:00 de 14/10, com 12 h de antecedência e regras até 20:00, o primeiro horário é 08:00 de 15/10; nada depois de 60 dias', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const hs = await horariosParaPaciente(tenantAgenda(T), agora, { db: app.db });
    expect(partesNoFuso(hs[0].inicio, SP)).toMatchObject({ data: '2026-10-15', hora: '08:00' });
    expect(hs.every((h) => h.inicio.getTime() < agora.getTime() + 60 * 86_400_000)).toBe(true);
    expect(partesNoFuso(hs.at(-1)!.inicio, SP).data).toBe('2026-12-13');
    // o caso "primeiro horário às 22:00 de 14/10" da US-032 está no teste puro do gerador (Tarefa 1)
  });

  it('janela = agora + antecedência até 60 dias; recorte nunca sai dela; consulta marcada some e `ignorarConsultaId` a devolve', async () => {
    expect(janelaDoPaciente({ antecedenciaMinH: 12 }, agora)).toEqual({ de: em('2026-10-14', '22:00'), ate: em('2026-12-13', '10:00') });
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const antes = await horariosParaPaciente(tenantAgenda(T), agora, { db: app.db, de: agora, ate: em('2026-10-16', '00:00') }); // `de` antes da janela é cortado
    expect(antes.map((h) => partesNoFuso(h.inicio, SP).hora + ' ' + partesNoFuso(h.inicio, SP).data)[0]).toBe('08:00 2026-10-15');
    expect(antes.every((h) => partesNoFuso(h.inicio, SP).data === '2026-10-15')).toBe(true);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'));
    const recorte = { db: app.db, de: em('2026-10-15', '08:00'), ate: em('2026-10-15', '11:00') };
    const horas = async (extra: { ignorarConsultaId?: string } = {}) => (await horariosParaPaciente(tenantAgenda(T), agora, { ...recorte, ...extra })).map((h) => partesNoFuso(h.inicio, SP).hora);
    expect(await horas()).toEqual(['08:00', '10:00']);
    expect(await horas({ ignorarConsultaId: id })).toEqual(['08:00', '09:00', '10:00']);
  });

  it('AG-D47 por local (Plano 23, T3): sobre as regras "ambas" desdobradas (presencial + online), um horário por local no mesmo instante; escolherHorario aceita online e presencial', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx, { modalidade: 'presencial' });
    await semanaToda(app.db, T.ctx, { modalidade: 'online' });
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: 'https://meet.google.com/abc' });
    const tenant = tenantAgenda(T);
    const inicio = em('2026-10-16', '09:00');
    const hs = await horariosParaPaciente(tenant, agora, { db: app.db, de: inicio, ate: em('2026-10-16', '11:00') });
    expect(hs.map((h) => [partesNoFuso(h.inicio, SP).hora, h.modalidades])).toEqual([
      ['09:00', ['presencial']],
      ['09:00', ['online']],
      ['10:00', ['presencial']],
      ['10:00', ['online']],
    ]);
    expect(hs.filter((h) => h.modalidades.includes('online')).map((h) => h.localId)).toEqual([video, video]);
    await expect(escolherHorario(tenant, inicio.toISOString(), video, agora, { db: app.db })).resolves.toMatchObject({ inicio, modalidade: 'online', localId: video });
    await expect(escolherHorario(tenant, inicio.toISOString(), L, agora, { db: app.db })).resolves.toMatchObject({ inicio, modalidade: 'presencial', localId: L });
  });
});

describe('agendar pelo paciente (US-032)', () => {
  it('cria com origem "paciente", lembretes e confirmação, e avisa a nutricionista por e-mail', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const { id } = await agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), localId: L }, deps);
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db);
    expect(c).toMatchObject({ origem: 'paciente', status: 'agendada', patientId: ana.id, inicio: em('2026-10-16', '09:00'), fim: em('2026-10-16', '10:00') });
    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, id)), app.db);
    expect(ns.filter((n) => n.tipo === 'lembrete_24h')).toHaveLength(3);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    const [aviso] = await emailsNaFila('aviso_agenda', nutri.email);
    expect(aviso).toMatchObject({ evento: 'marcada', paciente: 'Ana Souza', quando: 'sex., 16/10/2026 às 09:00 (horário de Brasília)', link: `http://localhost:3000/painel/agenda/consultas/${id}` });
  });

  it('corrida pelo mesmo horário (RN-03): exatamente 1; o outro vê "Esse horário acabou de ser ocupado. Escolha outro."', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const [a, b] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const inicio = em('2026-10-16', '15:00').toISOString();
    const r = await Promise.allSettled([a, b].map((p) => agendarComoPaciente(ctxPaciente(T.tenantId, p.id), tenantAgenda(T), { inicio, localId: L }, deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rej = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((rej.reason as ConsultaError).erros).toEqual({ inicio: expect.stringMatching(/^(Esse horário acabou de ser ocupado\. Escolha outro\.|Esse horário não está mais disponível\. Escolha outro\.)$/) });
  });

  it('horário fora da janela, fora das regras, ocupado ou sem o local → "Esse horário não está mais disponível. Escolha outro."', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const indisponivel = { inicio: MSG_AGENDA.indisponivel };
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-14', '19:00').toISOString(), localId: L }, deps))).toEqual(indisponivel); // < 12 h
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-12-20', '09:00').toISOString(), localId: L }, deps))).toEqual(indisponivel); // > 60 dias
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '21:00').toISOString(), localId: L }, deps))).toEqual(indisponivel); // fora das regras
    // Plano 23 (T4): o horário é escolhido pelo local; sem local (formulário antigo, só com a modalidade), local que não existe ou lixo → indisponível
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), localId: null }, deps))).toEqual(indisponivel);
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), localId: 'qualquer' }, deps))).toEqual(indisponivel);
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: 'amanhã', localId: L }, deps))).toEqual(indisponivel);
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: 'https://meet.google.com/abc' });
    const { id } = await agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), localId: video }, deps);
    // o local do horário e a sala dele (pelo gatilho appointments_link_da_sala)
    expect(await withTenant(T.ctx, async (tx) => (await tx.select({ localId: appointments.localId, link: appointments.linkOnline }).from(appointments).where(eq(appointments.id, id)))[0], app.db)).toEqual({ localId: video, link: 'https://meet.google.com/abc' });
  });

  it('paciente arquivado não agenda; tenant suspenso não agenda; só com sessão de paciente', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const arq = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const entrada = { inicio: em('2026-10-16', '09:00').toISOString(), localId: L };
    expect(await erro(agendarComoPaciente(ctxPaciente(T.tenantId, arq.id), tenantAgenda(T), entrada, deps))).toEqual({ geral: MSG_AGENDA.naoAgendavel });
    const ana = await novoPaciente(app.db, T.ctx);
    expect(await erro(agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T, { status: 'suspensa' }), entrada, deps))).toEqual({ geral: MSG_AGENDA.contaIndisponivel });
    await expect(agendarComoPaciente(T.ctx, tenantAgenda(T), entrada, deps)).rejects.toThrow(/sessão de paciente/);
    const vazias = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(and(eq(appointments.patientId, arq.id))), app.db);
    expect(vazias).toEqual([]);
  });

  it('revisão da T12 do Plano 06 (RN-16 no PWA): com 3 consultas futuras ativas, a 4ª → "Você já tem 3 consultas marcadas. Fale com sua nutricionista."; cancelada e passada não contam', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const ctx = ctxPaciente(T.tenantId, ana.id);
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-10', '09:00')); // passada
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-20', '09:00'), 60, { status: 'cancelada', canceladoPor: 'paciente', canceladaEm: agora });
    await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-21', '09:00')); // de outro paciente
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-22', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-23', '09:00'), 60, { status: 'confirmada' });
    const entrada = (dia: string) => ({ inicio: em(dia, '14:00').toISOString(), localId: L });
    await expect(agendarComoPaciente(ctx, tenantAgenda(T), entrada('2026-10-26'), deps)).resolves.toMatchObject({ id: expect.any(String) }); // 3ª futura
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), entrada('2026-10-27'), deps))).toEqual({ geral: MSG_AGENDA.limitePublico });
    const futuras = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(and(eq(appointments.patientId, ana.id), eq(appointments.status, 'agendada'))), app.db);
    expect(futuras.filter((c) => c.inicio > agora)).toHaveLength(2); // a recusada não ficou gravada
    // a de outro paciente não conta: bia (1 futura) ainda marca
    await expect(agendarComoPaciente(ctxPaciente(T.tenantId, bia.id), tenantAgenda(T), entrada('2026-10-27'), deps)).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('revisão da T12 do Plano 06: dois pedidos ao mesmo tempo com 2 futuras → só 1 passa (trava do paciente)', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, ana.id);
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-22', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-23', '09:00'));
    const r = await Promise.allSettled(['2026-10-26', '2026-10-27'].map((dia) => agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em(dia, '14:00').toISOString(), localId: L }, deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.limitePublico });
  });

  it('corrida perdida no banco (23P01 depois da checagem) → "Esse horário acabou de ser ocupado. Escolha outro."; nada fica gravado nem enfileirado', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const [bia, ana] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })];
    const inicio = em('2026-10-16', '15:00');
    const err = await perdeCorridaNoBanco({ app: app.pool, owner: owner.pool }, T, bia.id, inicio, () =>
      agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: inicio.toISOString(), localId: L }, deps),
    );
    expect(err).toBeInstanceOf(ConsultaError);
    expect((err as ConsultaError).erros).toEqual({ inicio: MSG_AGENDA.ocupado });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, ana.id)), app.db)).toEqual([]);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.patientId, ana.id)), app.db)).toEqual([]);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect(await emailsNaFila('aviso_agenda', nutri.email)).toEqual([]); // o aviso à nutricionista é da mesma transação: voltou junto
  });

  it('revisão final: corrida no EXCLUDE que vira 40P01 (duas faixas gravadas ao mesmo tempo) → repete uma vez: "Esse horário acabou de ser ocupado. Escolha outro.", não 500', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const [bia, ana] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })];
    const inicio = em('2026-10-16', '15:00');
    const err = await perdeDeadlockNoBanco({ app: app.pool, owner: owner.pool }, T, bia.id, [{ inicio, minutos: 30 }, { inicio: em('2026-10-16', '15:30'), minutos: 30 }], () =>
      agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: inicio.toISOString(), localId: L }, deps),
    );
    expect(err, inspect(err)).toBeInstanceOf(ConsultaError);
    expect((err as ConsultaError).erros).toEqual({ inicio: MSG_AGENDA.ocupado });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, ana.id)), app.db)).toEqual([]);
  });

  it('com um pool de UMA conexão a marcação conclui: o horário é escolhido antes da transação, nunca numa segunda conexão dentro dela', async () => {
    const umaConexao = new Pool({ connectionString: inject('appDatabaseUrl'), max: 1, connectionTimeoutMillis: 5_000 });
    try {
      const T = await novoTenant(app.db);
      const L = await semanaToda(app.db, T.ctx);
      const ana = await novoPaciente(app.db, T.ctx);
      const db1 = drizzle({ client: umaConexao, schema });
      await expect(agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), localId: L }, { ...deps, db: db1 })).resolves.toMatchObject({ id: expect.any(String) });
    } finally {
      await umaConexao.end();
    }
  }, 15_000);
});

describe('Plano 23 (T4): local no portal (US-403, RN-405, RN-406, RN-409, AG-D40, AG-D60)', () => {
  const desligarAgendamento = (id: string) => owner.db.update(locaisAtendimento).set({ agendamentoOnline: false }).where(eq(locaisAtendimento.id, id));
  const localDa = async (T: Awaited<ReturnType<typeof novoTenant>>, id: string) =>
    (await withTenant(T.ctx, (tx) => tx.select({ localId: appointments.localId, link: appointments.linkOnline, modalidade: appointments.modalidade }).from(appointments).where(eq(appointments.id, id)), app.db))[0];

  it('o portal só oferece locais com "Aceita agendamento pelo paciente", também com a página pública desligada (AG-D40); a lista de locais não tem a sala', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx, { modalidade: 'presencial' });
    const fechado = await novoLocal(app.db, T.ctx, { nome: 'Sala da diretoria', agendamentoOnline: false });
    await semanaNoLocal(app.db, T.ctx, fechado);
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: 'https://meet.google.com/sala-fixa' });
    await semanaNoLocal(app.db, T.ctx, video, 'online');
    await app.db.update(tenants).set({ agendamentoPublicoAtivo: false }).where(eq(tenants.id, T.tenantId));
    const tenant = tenantAgenda(T, { agendamentoPublicoAtivo: false });
    const hs = await horariosParaPaciente(tenant, agora, { db: app.db, de: em('2026-10-16', '09:00'), ate: em('2026-10-16', '10:00') });
    expect(hs.map((h) => h.localId)).toEqual([L, video]);
    const locais = await locaisDoAgendamento(tenant, { db: app.db });
    expect(locais.map((l) => l.id)).toEqual([L, video]);
    expect(locais.every((l) => Object.keys(l).sort().join() === 'cidade,endereco,id,nome,tipo')).toBe(true);
    expect(JSON.stringify(locais)).not.toContain('sala-fixa');
    expect(locais.map((l) => l.id)).not.toContain(fechado);
  });

  it('dois locais no mesmo instante: escolher o segundo local marca no segundo (nunca o primeiro do instante)', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx, { modalidade: 'presencial' });
    const centro = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
    await semanaNoLocal(app.db, T.ctx, centro);
    const ana = await novoPaciente(app.db, T.ctx);
    const inicio = em('2026-10-16', '09:00');
    await expect(escolherHorario(tenantAgenda(T), inicio.toISOString(), centro, agora, { db: app.db })).resolves.toMatchObject({ inicio, localId: centro, modalidade: 'presencial' });
    const { id } = await agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: inicio.toISOString(), localId: centro }, deps);
    expect(await localDa(T, id)).toMatchObject({ localId: centro, modalidade: 'presencial' });
    // o instante ficou ocupado nos dois locais (RN-408): o principal não oferece mais 09:00
    expect(await erro(escolherHorario(tenantAgenda(T), inicio.toISOString(), L, agora, { db: app.db }))).toEqual({ inicio: MSG_AGENDA.indisponivel });
  });

  it('local sem agendamento entre a tela e o envio: o 42501 do gatilho vira "Esse horário não está mais disponível. Escolha outro." (agendar e remarcar), sem consulta gravada', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx, { modalidade: 'presencial' });
    const centro = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
    await semanaNoLocal(app.db, T.ctx, centro);
    const ana = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, ana.id);
    // 1ª transação: a escolha do horário (o local ainda aceita); depois dela, a nutricionista desliga o agendamento
    const m = dbQueMudaNoMeio(app.db, 1, () => desligarAgendamento(centro));
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), localId: centro }, { ...deps, db: m.db }))).toEqual({ inicio: MSG_AGENDA.indisponivel });
    expect(m.rodou()).toBe(true);
    expect(m.transacoes()).toBe(2); // a gravação abriu e foi recusada pelo gatilho (não pela escolha do horário)
    expect(await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, ana.id)), app.db)).toEqual([]);

    await owner.db.update(locaisAtendimento).set({ agendamentoOnline: true }).where(eq(locaisAtendimento.id, centro));
    const { id } = await agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), localId: centro }, deps);
    const r = dbQueMudaNoMeio(app.db, 1, () => desligarAgendamento(centro));
    expect(await erro(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-17', '10:00').toISOString(), localId: centro }, { ...deps, db: r.db }))).toEqual({ inicio: MSG_AGENDA.indisponivel });
    expect([r.rodou(), r.transacoes()]).toEqual([true, 2]);
    expect(await withTenant(T.ctx, (tx) => tx.select({ id: appointments.id, status: appointments.status }).from(appointments).where(eq(appointments.patientId, ana.id)), app.db)).toEqual([{ id, status: 'agendada' }]);
  });
});
