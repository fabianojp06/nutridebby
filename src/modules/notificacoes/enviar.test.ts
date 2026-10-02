import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, em, SP, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { transporteFalso, type TransporteFalso } from '../../../test/email';
import { depsDeEnvio } from '../../../test/notificacoes';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, notifications, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { encryptionKey } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { agendarPelaNutri, moverConsulta } from '@/modules/agenda/consultas';
import { chaveDosLinks, lerLinkConsulta } from '@/modules/agenda/link-consulta';
import { buscarTenant, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { LOTE_POR_EXECUCAO, ordemDaRodada, processarNotificacoes, TRAVADA_MS } from './enviar';

// R14 e a corrida da suspensão: conta as listagens de tenants e devolve uma leitura antiga (implementação real por baixo)
vi.mock('@/modules/plataforma/tenant-status', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/tenant-status')>();
  return { ...real, buscarTenant: vi.fn(real.buscarTenant), listarTenantsParaVarredura: vi.fn(real.listarTenantsParaVarredura) };
});

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const chaveLinks = chaveDosLinks(encryptionKey());
const marcadaEm = new Date('2026-10-01T12:00:00Z');
const deps = (agora: Date, transport?: TransporteFalso) => depsDeEnvio(agora, { db: app.db, transport });

async function marcada(T: TenantDeTeste, extra: Record<string, string> = {}) {
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
  const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial', ...extra }, { db: app.db, now: marcadaEm });
  return { ana, id };
}
const linha = async (T: TenantDeTeste, id: string, tipo: string, canal: string) =>
  (await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, tipo), eq(notifications.canal, canal))), app.db))[0];

describe('envio das notificações (RN-05, US-034, D6)', () => {
  it('"Consulta marcada" sai na hora; o lembrete de 24 h sai em 15/10 14:00 com o link assinado e o fuso', async () => {
    const T = await novoTenant(app.db);
    const { ana, id } = await marcada(T);
    const d1 = deps(marcadaEm);
    await processarNotificacoes(d1, { tenantId: T.tenantId });
    expect(d1.transport.enviados.map((e) => e.subject)).toEqual(['Consulta marcada: sex., 16/10/2026 às 14:00 (horário de Brasília)']);
    expect(d1.transport.enviados[0].to).toBe(ana.email);
    expect(await linha(T, id, 'consulta_marcada', 'email')).toMatchObject({ status: 'enviada', tentativas: 1 });
    const d2 = deps(em('2026-10-15', '14:00'));
    await processarNotificacoes(d2, { tenantId: T.tenantId });
    const [e] = d2.transport.enviados;
    expect(e.subject).toBe('Lembrete: sua consulta é amanhã às 14:00');
    expect(e.idempotencyKey).toBe(`notificacao:${(await linha(T, id, 'lembrete_24h', 'email')).id}:${em('2026-10-16', '14:00').toISOString()}`);
    const token = /\/consulta\/([A-Za-z0-9_-]{71})/.exec(e.text)![1];
    expect(lerLinkConsulta(token, chaveLinks, em('2026-10-15', '14:00'))).toMatchObject({ tenantId: T.tenantId, appointmentId: id, expirado: false });
  });

  it('sem WhatsApp na plataforma (whatsapp: null) e sem push configurado (até a Tarefa 13): "ignorada" com o motivo', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    await processarNotificacoes(deps(em('2026-10-15', '14:00')), { tenantId: T.tenantId });
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'whatsapp_desligado' });
    expect(await linha(T, id, 'lembrete_24h', 'push')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'push_desligado' });
  });

  it('na hora do envio: consulta cancelada, paciente arquivado e consulta já começada viram "ignorada"', async () => {
    const T = await novoTenant(app.db);
    const a = await marcada(T);
    const b = await marcada(T, { data: '2026-10-17' });
    await withTenant(T.ctx, async (tx) => {
      await tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'nutri', canceladaEm: marcadaEm }).where(eq(appointments.id, a.id));
      await tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, b.ana.id));
    }, app.db);
    await processarNotificacoes(deps(em('2026-10-16', '13:00')), { tenantId: T.tenantId }); // 24 h e 2 h de "a" venceram
    expect(await linha(T, a.id, 'lembrete_2h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'consulta_cancelada' });
    expect(await linha(T, b.id, 'consulta_marcada', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'paciente_inativo' });
    const p = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, p.id, em('2026-10-16', '09:00'));
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: em('2026-10-16', '09:00'), canal: 'email', tipo: 'lembrete_2h', agendadaPara: em('2026-10-16', '07:00') }), app.db);
    await processarNotificacoes(deps(em('2026-10-16', '09:30')), { tenantId: T.tenantId });
    expect(await linha(T, c, 'lembrete_2h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'prazo_passado' });
    // D6/D17: linha planejada para um horário que a consulta já não tem (a hora mudou depois da reserva) não sai
    const d = await consultaDireta(app.db, T.ctx, p.id, em('2026-10-20', '09:00'));
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: d, inicioConsulta: em('2026-10-19', '09:00'), canal: 'email', tipo: 'lembrete_24h', agendadaPara: em('2026-10-18', '09:00') }), app.db);
    await processarNotificacoes(deps(em('2026-10-18', '09:00')), { tenantId: T.tenantId });
    expect(await linha(T, d, 'lembrete_24h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'consulta_remarcada' });
  });

  it('horário silencioso na reserva (D7, rodada 1): o lembrete que venceu com o worker parado sai às 08:00 dizendo "hoje"; o de 2 h que só caberia depois da consulta é ignorado', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T); // 16/10 às 14:00: o de 24 h venceu em 15/10 às 14:00
    const noite = deps(em('2026-10-15', '23:30'));
    await processarNotificacoes(noite, { tenantId: T.tenantId });
    expect(noite.transport.enviados.filter((e) => e.subject.startsWith('Lembrete'))).toEqual([]);
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'pendente', tentativas: 0, agendadaPara: em('2026-10-16', '08:00') });
    const manha = deps(em('2026-10-16', '08:00'));
    await processarNotificacoes(manha, { tenantId: T.tenantId });
    expect(manha.transport.enviados.map((e) => e.subject)).toContain('Lembrete: sua consulta é hoje às 14:00');
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'enviada' });
    // o de 2 h de uma consulta às 07:00 que venceu às 21:50: as 08:00 já seriam depois do início
    const p = await novoPaciente(app.db, T.ctx);
    const cedo = em('2026-10-17', '07:00');
    const c = await consultaDireta(app.db, T.ctx, p.id, cedo);
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: cedo, canal: 'email', tipo: 'lembrete_2h', agendadaPara: em('2026-10-16', '21:50') }), app.db);
    await processarNotificacoes(deps(em('2026-10-16', '22:00')), { tenantId: T.tenantId });
    expect(await linha(T, c, 'lembrete_2h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'horario_silencioso' });
  });

  it('D7 (revisão da T5): fora do silêncio, o lembrete de 24 h atrasado não sai junto do de 2 h, que cobre a reta final; com o de 2 h no silêncio, vale até 30 min antes do início', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T); // 16/10 às 14:00: o worker parou antes de 15/10 14:00 e só voltou em 16/10 12:30
    const volta = deps(em('2026-10-16', '12:30'));
    await processarNotificacoes(volta, { tenantId: T.tenantId });
    expect(volta.transport.enviados.map((e) => e.subject).filter((s) => s.startsWith('Lembrete'))).toEqual(['Lembrete: sua consulta é hoje às 14:00']);
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'prazo_passado' });
    expect(await linha(T, id, 'lembrete_2h', 'email')).toMatchObject({ status: 'enviada' });
    // consulta às 08:30: o de 2 h (06:30) caiu no silêncio — o de 24 h atrasado ainda sai às 08:00 (30 min antes), como no adiamento
    await marcada(T, { data: '2026-10-17', hora: '08:30' });
    const as8 = deps(em('2026-10-17', '08:00'));
    await processarNotificacoes(as8, { tenantId: T.tenantId });
    expect(as8.transport.enviados.map((e) => e.subject).filter((s) => s.startsWith('Lembrete'))).toEqual(['Lembrete: sua consulta é hoje às 08:30']);
    // consulta às 08:20: às 08:00 já faltam menos de 30 min — não sai
    const tarde = await marcada(T, { data: '2026-10-18', hora: '08:20' });
    const as8b = deps(em('2026-10-18', '08:00'));
    await processarNotificacoes(as8b, { tenantId: T.tenantId });
    expect(as8b.transport.enviados.filter((e) => e.subject.startsWith('Lembrete'))).toEqual([]);
    expect(await linha(T, tarde.id, 'lembrete_24h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'prazo_passado' });
  });

  it('14:00 → 15:00 → 14:00: cada mudança do início manda uma "Consulta marcada" nova (3 ao todo, a última diz 14:00); os lembretes de 14:00 voltam a valer sem duplicar', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    const t = transporteFalso();
    await processarNotificacoes(deps(marcadaEm, t), { tenantId: T.tenantId });
    const minuto = (n: number) => new Date(marcadaEm.getTime() + n * 60_000);
    for (const [n, hora] of [[1, '15:00'], [2, '14:00']] as const) {
      await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora, duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: minuto(n) });
      await processarNotificacoes(deps(minuto(n), t), { tenantId: T.tenantId });
    }
    expect(t.enviados.map((e) => e.subject)).toEqual([
      'Consulta marcada: sex., 16/10/2026 às 14:00 (horário de Brasília)',
      'Consulta marcada: sex., 16/10/2026 às 15:00 (horário de Brasília)',
      'Consulta marcada: sex., 16/10/2026 às 14:00 (horário de Brasília)',
    ]);
    const todas = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, id)), app.db);
    const lembretes = (hora: string) => todas.filter((l) => l.tipo.startsWith('lembrete') && l.inicioConsulta?.getTime() === em('2026-10-16', hora).getTime());
    // uma linha por (canal, tipo) em cada início: as de 14:00 foram reabertas, não duplicadas
    expect(lembretes('14:00').map((l) => `${l.tipo}/${l.canal}/${l.status}`).sort()).toEqual([
      'lembrete_24h/email/pendente', 'lembrete_24h/push/pendente', 'lembrete_24h/whatsapp/pendente',
      'lembrete_2h/email/pendente', 'lembrete_2h/push/pendente', 'lembrete_2h/whatsapp/pendente',
    ]);
    expect(lembretes('15:00').every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'consulta_remarcada')).toBe(true);
    expect(lembretes('15:00')).toHaveLength(6);
  });

  it('o aviso de um início que mudou antes de sair não sai: 14:00 → 15:00 → 14:00 sem envio no meio manda só o último', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    const t = transporteFalso();
    await processarNotificacoes(deps(marcadaEm, t), { tenantId: T.tenantId }); // a marcação (14:00) saiu
    for (const hora of ['15:00', '14:00']) {
      await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora, duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: marcadaEm });
    }
    await processarNotificacoes(deps(marcadaEm, t), { tenantId: T.tenantId });
    expect(t.enviados.map((e) => e.subject)).toEqual(Array(2).fill('Consulta marcada: sex., 16/10/2026 às 14:00 (horário de Brasília)'));
    const avisos = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'consulta_marcada'), eq(notifications.canal, 'email'))), app.db);
    expect(avisos.map((l) => `${l.inicioConsulta?.toISOString()}/${l.status}/${l.motivoIgnorada}`).sort()).toEqual([
      `${em('2026-10-16', '14:00').toISOString()}/enviada/null`,
      `${em('2026-10-16', '14:00').toISOString()}/enviada/null`,
      `${em('2026-10-16', '15:00').toISOString()}/ignorada/consulta_remarcada`,
    ]);
  });

  it('a volta do cron começa num tenant diferente a cada minuto (D6, rodada 1)', () => {
    expect([0, 1, 2, 3].map((m) => ordemDaRodada(['a', 'b', 'c'], new Date(m * 60_000))[0])).toEqual(['a', 'b', 'c', 'a']);
    expect(ordemDaRodada([], new Date())).toEqual([]);
  });

  it('INT-02: e-mail recusado → novas tentativas em 1, 2 e 4 min; depois "falhou"', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    const t = transporteFalso({ falhar: 10 });
    let agora = marcadaEm;
    for (const espera of [60, 120, 240]) {
      await processarNotificacoes(deps(agora, t), { tenantId: T.tenantId });
      const l = await linha(T, id, 'consulta_marcada', 'email');
      expect(l.status).toBe('pendente');
      expect(l.agendadaPara.getTime() - agora.getTime()).toBe(espera * 1000);
      agora = l.agendadaPara;
    }
    await processarNotificacoes(deps(agora, t), { tenantId: T.tenantId });
    expect(await linha(T, id, 'consulta_marcada', 'email')).toMatchObject({ status: 'falhou', erro: 'email', tentativas: 4 });
  });

  it('falha do transporte de e-mail: o log leva o nome do erro (RNF-11), nunca a mensagem nem o destinatário', async () => {
    const T = await novoTenant(app.db);
    const { ana } = await marcada(T);
    const recusa = Object.assign(new Error(`recusado para ${ana.email}`), { name: 'ResendError' });
    const transport: TransporteFalso = {
      enviados: [],
      async send() {
        throw recusa;
      },
    };
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await processarNotificacoes(deps(marcadaEm, transport), { tenantId: T.tenantId });
      expect(aviso).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T.tenantId, canal: 'email', err: 'ResendError' }), 'falha no transporte de e-mail');
      expect(JSON.stringify(aviso.mock.calls)).not.toContain(ana.email);
    } finally {
      aviso.mockRestore();
    }
  });

  it('worker caiu no meio (Review Focus 4): e-mail "enviando" há 15 min volta (mesma chave); WhatsApp vira "falhou"/"interrompido" e nunca repete', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    const travada = new Date(marcadaEm.getTime() - TRAVADA_MS - 1000);
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviando', tentativas: 1, updatedAt: travada }).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'consulta_marcada'))), app.db);
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviando', tentativas: 1, updatedAt: travada, agendadaPara: travada }).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'lembrete_24h'), eq(notifications.canal, 'whatsapp'))), app.db);
    const d = deps(marcadaEm);
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect(await linha(T, id, 'consulta_marcada', 'email')).toMatchObject({ status: 'enviada' });
    expect(d.transport.enviados).toHaveLength(1);
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'interrompido' });
  });

  it('duas varreduras ao mesmo tempo não enviam a mesma linha duas vezes (FOR UPDATE SKIP LOCKED)', async () => {
    const T = await novoTenant(app.db);
    await marcada(T);
    const t = transporteFalso();
    await Promise.all([processarNotificacoes(deps(marcadaEm, t), { tenantId: T.tenantId }), processarNotificacoes(deps(marcadaEm, t), { tenantId: T.tenantId })]);
    expect(t.enviados.filter((e) => e.subject.startsWith('Consulta marcada'))).toHaveLength(1);
  });

  it('tenant suspenso: nada sai e o pendente vira "tenant_suspenso" (RN-15)', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    const d = deps(marcadaEm);
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect(d.transport.enviados).toEqual([]);
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'tenant_suspenso' });
  });

  it('RN-15: suspensa entre a leitura do tenant e a reserva — a reserva relê sob trava e nada sai', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    const ativa = await buscarTenant(app.db, T.tenantId);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    vi.mocked(buscarTenant).mockResolvedValueOnce(ativa); // a leitura de antes da suspensão
    const d = deps(marcadaEm);
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect(d.transport.enviados).toEqual([]);
    expect(await linha(T, id, 'consulta_marcada', 'email')).toMatchObject({ status: 'pendente', tentativas: 0 }); // a próxima volta (ou o job "suspenso") ignora
  });

  it('R14: o envio imediato ({ tenantId }) não lista os tenants; a volta do cron lista uma vez e passa por todos', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const a = await marcada(A);
    const b = await marcada(B);
    vi.mocked(listarTenantsParaVarredura).mockClear();
    const t = transporteFalso();
    await processarNotificacoes(deps(marcadaEm, t), { tenantId: A.tenantId });
    expect(listarTenantsParaVarredura).not.toHaveBeenCalled();
    expect(t.enviados.map((e) => e.to)).toEqual([a.ana.email]);
    // só os dois tenants deste teste: os outros arquivos rodam ao mesmo tempo no mesmo banco
    vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce([{ id: A.tenantId, fuso: SP }, { id: B.tenantId, fuso: SP }]);
    expect(await processarNotificacoes(deps(marcadaEm, t))).toEqual({ processadas: 2 }); // e-mail e push da "Consulta marcada" de B
    expect(listarTenantsParaVarredura).toHaveBeenCalledTimes(1);
    expect(t.enviados.map((e) => e.to)).toEqual([a.ana.email, b.ana.email]);
  });

  it('D6 (rodada 1): cada tenant tem a sua parte do lote; o que sobra vai, numa segunda passada, para quem encheu a parte', async () => {
    // o "grande" é o primeiro da volta (ids em ordem, e o minuto de `marcadaEm` não gira a lista): sem a parte, levaria o lote todo
    const [grande, pequeno] = [await novoTenant(app.db), await novoTenant(app.db)].sort((x, y) => (x.tenantId < y.tenantId ? -1 : 1));
    expect(ordemDaRodada([pequeno.tenantId, grande.tenantId].sort(), marcadaEm)[0]).toBe(grande.tenantId);
    // grande: 23 consultas → 46 linhas devidas ("Consulta marcada" por e-mail e push), mais que o lote; pequeno: 2
    for (const data of ['2026-10-16', '2026-10-17']) {
      for (let h = 8; h <= (data === '2026-10-16' ? 20 : 17); h++) await marcada(grande, { data, hora: `${String(h).padStart(2, '0')}:00` });
    }
    await marcada(pequeno);
    vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce([{ id: pequeno.tenantId, fuso: SP }, { id: grande.tenantId, fuso: SP }]);
    // parte de cada um = max(5, 40 ÷ 2) = 20: o grande leva 20, o pequeno 2 e, na segunda passada, o grande mais 18 (limite global de 40)
    expect(await processarNotificacoes(deps(marcadaEm))).toEqual({ processadas: LOTE_POR_EXECUCAO });
    const pendentes = async (T: TenantDeTeste) => (await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.tipo, 'consulta_marcada'), eq(notifications.status, 'pendente'))), app.db)).length;
    expect(await pendentes(pequeno)).toBe(0);
    expect(await pendentes(grande)).toBe(46 - 38);
  });
});
