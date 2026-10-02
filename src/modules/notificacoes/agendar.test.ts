import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { em, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, notifications, TIPOS_UM_POR_HORARIO } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { agendarPelaNutri, moverConsulta } from '@/modules/agenda/consultas';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { suspenderConta, reativarConta } from '@/modules/plataforma/suspensao';
import { adiarLembrete, avisarPaciente, emHorarioSilencioso, fimDoSilencio, ignorarPendentesDoTenant, planejarLembretes, reagendarTenantReativado } from './agendar';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';
const resumo = (ps: { tipo: string; agendadaPara: Date; status: string; motivo?: string }[]) => ps.map((p) => [p.tipo, p.agendadaPara.toISOString(), p.status, p.motivo ?? null]);

describe('planejarLembretes (RN-05, US-034)', () => {
  it('consulta em 16/10 às 14:00 → 24 h em 15/10 14:00 e 2 h em 16/10 12:00', () => {
    expect(resumo(planejarLembretes(em('2026-10-16', '14:00'), SP, em('2026-10-10', '09:00')))).toEqual([
      ['lembrete_24h', '2026-10-15T17:00:00.000Z', 'pendente', null],
      ['lembrete_2h', '2026-10-16T15:00:00.000Z', 'pendente', null],
    ]);
  });
  it('consulta às 08:00 → 24 h às 08:00 (vale) e 2 h às 06:00 → "horario_silencioso"', () => {
    expect(resumo(planejarLembretes(em('2026-10-16', '08:00'), SP, em('2026-10-10', '09:00'))).map((x) => [x[0], x[2], x[3]])).toEqual([
      ['lembrete_24h', 'pendente', null],
      ['lembrete_2h', 'ignorada', 'horario_silencioso'],
    ]);
  });
  it('criada às 10:00 para as 15:00 do mesmo dia → 24 h "prazo_passado" e 2 h às 13:00', () => {
    expect(resumo(planejarLembretes(em('2026-10-16', '15:00'), SP, em('2026-10-16', '10:00')))).toEqual([
      ['lembrete_24h', '2026-10-15T18:00:00.000Z', 'ignorada', 'prazo_passado'],
      ['lembrete_2h', '2026-10-16T16:00:00.000Z', 'pendente', null],
    ]);
  });
  it('bordas do silêncio [21:00, 08:00) no fuso do tenant (Review Focus 2)', () => {
    expect(['20:59', '21:00', '07:59', '08:00'].map((h) => emHorarioSilencioso(em('2026-10-16', h), SP))).toEqual([false, true, true, false]);
  });
  it('D7 na reserva (rodada 1): lembrete que venceu no silêncio vai para as 08:00 só se ainda fizer sentido para o tipo', () => {
    expect(fimDoSilencio(em('2026-10-15', '21:00'), SP)).toEqual(em('2026-10-16', '08:00'));
    expect(fimDoSilencio(em('2026-10-16', '07:59'), SP)).toEqual(em('2026-10-16', '08:00'));
    expect(adiarLembrete('lembrete_24h', em('2026-10-16', '14:00'), SP, em('2026-10-15', '23:30'))).toEqual(em('2026-10-16', '08:00'));
    expect(adiarLembrete('lembrete_24h', em('2026-10-16', '10:00'), SP, em('2026-10-16', '06:00'))).toBeNull(); // o de 2 h sai às 08:00
    expect(adiarLembrete('lembrete_24h', em('2026-10-16', '09:00'), SP, em('2026-10-16', '06:00'))).toEqual(em('2026-10-16', '08:00')); // o de 2 h (07:00) caiu no silêncio
    expect(adiarLembrete('lembrete_2h', em('2026-10-17', '07:00'), SP, em('2026-10-16', '22:00'))).toBeNull(); // as 08:00 já seriam depois da consulta
  });
});

describe('lembretes da consulta no banco', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const linhas = (ctx: Parameters<typeof withTenant>[0], appointmentId: string) =>
    withTenant(ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, appointmentId)), app.db);

  it('marcar cria 24 h e 2 h nos 3 canais + "Consulta marcada" por e-mail e push, e pede envio imediato', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    const ls = await linhas(T.ctx, id);
    expect(ls.map((l) => `${l.tipo}/${l.canal}/${l.status}`).sort()).toEqual([
      'consulta_marcada/email/pendente', 'consulta_marcada/push/pendente',
      'lembrete_24h/email/pendente', 'lembrete_24h/push/pendente', 'lembrete_24h/whatsapp/pendente',
      'lembrete_2h/email/pendente', 'lembrete_2h/push/pendente', 'lembrete_2h/whatsapp/pendente',
    ]);
    expect(ls.find((l) => l.tipo === 'lembrete_24h')?.agendadaPara).toEqual(em('2026-10-15', '14:00'));
    const jobs = await (await getBoss()).findJobs<{ tenantId?: string }>('notificacoes');
    expect(jobs.some((j) => j.data.tenantId === T.tenantId)).toBe(true);
  });

  it('alterar a hora (D6/D17, rodada 1): o horário novo ganha linhas próprias, a pendente do antigo vira "consulta_remarcada" e a enviada não é reaberta; o mesmo horário de novo não duplica', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    const enviadaEm = em('2026-10-15', '14:00');
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviada', enviadaEm, tentativas: 1 }).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'lembrete_24h'), eq(notifications.canal, 'email'))), app.db);
    const novo = { data: '2026-10-17', hora: '08:00', duracaoMin: '60', modalidade: 'presencial' };
    await moverConsulta(T.ctx, tenantAgenda(T), id, novo, { db: app.db, now: em('2026-10-15', '15:00') });
    const depois = await linhas(T.ctx, id);
    const doHorario = (data: string, hora: string) => depois.filter((l) => l.inicioConsulta?.getTime() === em(data, hora).getTime());
    const antigo = doHorario('2026-10-16', '14:00');
    const atual = doHorario('2026-10-17', '08:00');
    expect(antigo.find((l) => l.tipo === 'lembrete_24h' && l.canal === 'email')).toMatchObject({ status: 'enviada', enviadaEm, tentativas: 1 });
    expect(antigo.filter((l) => l.status === 'pendente')).toEqual([]);
    expect(antigo.filter((l) => l.tipo === 'lembrete_2h').every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'consulta_remarcada')).toBe(true);
    expect(atual.filter((l) => l.tipo === 'lembrete_2h').every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'horario_silencioso')).toBe(true);
    expect(atual.find((l) => l.tipo === 'lembrete_24h' && l.canal === 'email')).toMatchObject({ status: 'pendente', agendadaPara: em('2026-10-16', '08:00') });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { ...novo, duracaoMin: '45' }, { db: app.db, now: em('2026-10-15', '15:00') });
    expect(await linhas(T.ctx, id)).toHaveLength(depois.length); // mesmo horário: as mesmas linhas
  });

  it('R3 / D17: mudar só a duração, a modalidade e o link não cria "Consulta marcada", não reabre linha nenhuma nem pede envio', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    const daLinha = (tipo: string, canal: string) => and(eq(notifications.appointmentId, id), eq(notifications.tipo, tipo), eq(notifications.canal, canal));
    // o que já saiu e o que não sai mais: um novo "Consulta marcada" (gravar com ON CONFLICT) reabriria a ignorada e a que falhou
    await withTenant(T.ctx, async (tx) => {
      await tx.update(notifications).set({ status: 'enviada', enviadaEm: now, tentativas: 1 }).where(daLinha('consulta_marcada', 'email'));
      await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'push_desligado' }).where(daLinha('consulta_marcada', 'push'));
      await tx.update(notifications).set({ status: 'falhou', erro: 'email', tentativas: 4 }).where(daLinha('lembrete_24h', 'email'));
    }, app.db);
    const porId = <L extends { id: string }>(ls: L[]) => [...ls].sort((a, b) => a.id.localeCompare(b.id));
    const antes = porId(await linhas(T.ctx, id));
    const pedidos = async () => (await (await getBoss()).findJobs<{ tenantId?: string }>('notificacoes')).filter((j) => j.data.tenantId === T.tenantId).length;
    const pedidosAntes = await pedidos();
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora: '14:00', duracaoMin: '45', modalidade: 'online', linkOnline: 'https://meet.exemplo.com/abc' }, { db: app.db, now: em('2026-10-10', '09:00') });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db);
    expect(c).toMatchObject({ modalidade: 'online', linkOnline: 'https://meet.exemplo.com/abc', fim: em('2026-10-16', '14:45') }); // a alteração valeu
    expect(porId(await linhas(T.ctx, id))).toEqual(antes); // mesmas linhas, mesmas situações (nem `updated_at` mudou)
    expect(await pedidos()).toBe(pedidosAntes);
  });

  it('avisarPaciente repetido para o mesmo evento (mesmo início, ainda pendente) não duplica; um início novo deixa o pendente do antigo como "consulta_remarcada"', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    const alvo = { tenantId: T.tenantId, patientId: ana.id, appointmentId: id, inicio: em('2026-10-16', '14:00') };
    const avisos = async () =>
      (await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'consulta_marcada'))), app.db)).map((l) => `${l.canal}/${l.status}`).sort();
    const antes = await avisos();
    expect(antes).toEqual(['email/pendente', 'push/pendente']);
    for (let i = 0; i < 2; i++) await withTenant(T.ctx, (tx) => avisarPaciente(tx, alvo, 'consulta_marcada', new Date(now.getTime() + (i + 1) * 60_000)), app.db);
    expect(await avisos()).toEqual(antes);
    // chamada direta (como a das Tarefas 7 e 8, sem agendarLembretes antes): o próprio aviso descarta o pendente de outro início
    await withTenant(T.ctx, (tx) => avisarPaciente(tx, { ...alvo, inicio: em('2026-10-16', '15:00') }, 'consulta_marcada', now), app.db);
    const linhasDoAviso = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'consulta_marcada'))), app.db);
    expect(linhasDoAviso.map((l) => `${partesNoFuso(l.inicioConsulta!, SP).hora}/${l.canal}/${l.status}/${l.motivoIgnorada}`).sort()).toEqual([
      '14:00/email/ignorada/consulta_remarcada', '14:00/push/ignorada/consulta_remarcada', '15:00/email/pendente/null', '15:00/push/pendente/null',
    ]);
  });

  it('a chave única parcial do banco vale só para os tipos de TIPOS_UM_POR_HORARIO (lista num lugar só)', async () => {
    const { rows } = await app.pool.query<{ def: string }>(`select indexdef as def from pg_indexes where tablename = 'notifications' and indexname = 'notifications_versao_unique'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/^CREATE UNIQUE INDEX .* \(appointment_id, canal, tipo, inicio_consulta\) WHERE /);
    const noBanco = [...rows[0].def.split(' WHERE ')[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(noBanco).toEqual([...TIPOS_UM_POR_HORARIO].sort());
    expect([...TIPOS_UM_POR_HORARIO].sort()).toEqual(['lembrete_24h', 'lembrete_2h', 'resposta_confirmacao', 'resposta_remarcar']);
    expect((await app.pool.query(`select 1 from pg_constraint where conname = 'notifications_consulta_versao_unique'`)).rows).toEqual([]);
  });

  it('US-004: suspender enfileira o job; o worker troca os pendentes para "tenant_suspenso"; reativar reagenda os futuros', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    await suspenderConta(T.tenantId, T.nutriId, app.db);
    const jobs = await (await getBoss()).findJobs<{ tenantId: string; evento: string }>('agenda-tenant');
    expect(jobs.some((j) => j.data.tenantId === T.tenantId && j.data.evento === 'suspenso')).toBe(true);
    await ignorarPendentesDoTenant(app.db, T.tenantId, now);
    expect((await linhas(T.ctx, id)).every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'tenant_suspenso')).toBe(true);
    await reativarConta(T.tenantId, T.nutriId, app.db);
    expect((await (await getBoss()).findJobs<{ tenantId: string; evento: string }>('agenda-tenant')).some((j) => j.data.tenantId === T.tenantId && j.data.evento === 'reativado')).toBe(true);
    await reagendarTenantReativado(app.db, T.tenantId, now);
    const lembretes = (await linhas(T.ctx, id)).filter((l) => l.tipo.startsWith('lembrete'));
    expect(lembretes.every((l) => l.status === 'pendente' && l.motivoIgnorada === null)).toBe(true);
    // a confirmação de marcação ignorada na suspensão não é reenviada
    const marcada = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'consulta_marcada'))), app.db);
    expect(marcada.every((l) => l.motivoIgnorada === 'tenant_suspenso')).toBe(true);
  });

  it('US-004 (rodada 1): jobs fora de ordem — o "suspenso" atrasado, que roda depois da reativação, não ignora nada; o "reativado" atrasado não reabre nada numa nova suspensão', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    const lembretes = async () => (await linhas(T.ctx, id)).filter((l) => l.tipo.startsWith('lembrete'));
    await suspenderConta(T.tenantId, T.nutriId, app.db);
    await reativarConta(T.tenantId, T.nutriId, app.db);
    await reagendarTenantReativado(app.db, T.tenantId, now); // o "reativado" rodou primeiro…
    await ignorarPendentesDoTenant(app.db, T.tenantId, now); // …e o "suspenso" depois: o status relido sob trava é "ativa"
    expect((await lembretes()).every((l) => l.status === 'pendente')).toBe(true);
    await suspenderConta(T.tenantId, T.nutriId, app.db);
    await ignorarPendentesDoTenant(app.db, T.tenantId, now);
    await reagendarTenantReativado(app.db, T.tenantId, now); // "reativado" atrasado de antes: a conta está suspensa
    expect((await lembretes()).every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'tenant_suspenso')).toBe(true);
    await reativarConta(T.tenantId, T.nutriId, app.db);
    await reagendarTenantReativado(app.db, T.tenantId, now); // a reativação reagenda o que a suspensão ignorou
    expect((await lembretes()).every((l) => l.status === 'pendente' && l.motivoIgnorada === null)).toBe(true);
  });
});
