import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, em, SP, tenantAgenda } from '../../../../test/agenda';
import { makeDb } from '../../../../test/db';
import { depsDeEnvio } from '../../../../test/notificacoes';
import { emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { conexaoDeTeste, whatsappFalso } from '../../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { notifications, patients, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { sealSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { agendarPelaNutri, moverConsulta } from '@/modules/agenda/consultas';
import { processarNotificacoes, type DepsEnvio } from '../enviar';
import { FINALIDADE_CONTEUDO } from '../mensagens';
import { nivelDaCota, situacaoDaCota, usoDoMes } from './cota';

// o aviso à nutricionista é o real; um teste faz ele falhar uma vez
vi.mock('@/modules/agenda/aviso-nutri', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/agenda/aviso-nutri')>();
  return { ...real, avisarNutri: vi.fn(real.avisarNutri) };
});

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const comWhats = { telefoneE164: '+5511912345678', whatsappOptinEm: new Date('2026-10-01T12:00:00Z'), whatsappOptinOrigem: 'nutri' };
// R12: o ajudante único dos testes do motor (test/notificacoes.ts)
const deps = (agora: Date, whatsapp: DepsEnvio['whatsapp'] = whatsappFalso()) => depsDeEnvio(agora, { db: app.db, whatsapp });

type OpcoesDevidos = { dia?: string; tipo?: string; paciente?: Parameters<typeof novoPaciente>[2]; comEmail?: boolean };
/**
 * n WhatsApps vencidos em `vence` (lembrete de 24 h, salvo outro tipo), um por paciente/consulta; `comEmail`: também a
 * linha de e-mail do mesmo lembrete.
 */
async function devidos(T: TenantDeTeste, n: number, vence: Date, { dia = '2026-10-20', tipo = 'lembrete_24h', paciente = comWhats, comEmail = false }: OpcoesDevidos = {}) {
  for (let i = 0; i < n; i++) {
    const p = await novoPaciente(app.db, T.ctx, paciente);
    const inicio = em(dia, `${String(8 + i).padStart(2, '0')}:00`);
    const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
    const linha = { tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: inicio, tipo, agendadaPara: vence };
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values([{ ...linha, canal: 'whatsapp' }, ...(comEmail ? [{ ...linha, canal: 'email' }] : [])]), app.db);
  }
}
/** n convites por WhatsApp já aceitos em `enviadaEm` (uso do mês sem passar pelo motor). */
async function jaUsadas(T: TenantDeTeste, n: number, enviadaEm: Date) {
  const p = await novoPaciente(app.db, T.ctx);
  await withTenant(
    T.ctx,
    (tx) => tx.execute(sql`insert into notifications (tenant_id, patient_id, canal, tipo, status, agendada_para, enviada_em)
      select ${T.tenantId}, ${p.id}, 'whatsapp', 'convite_paciente', 'enviada', ${enviadaEm}::timestamptz, ${enviadaEm}::timestamptz from generate_series(1, ${n})`),
    app.db,
  );
}
const vezes = (n: number, s: string): string[] => Array(n).fill(s);
const cota = (T: TenantDeTeste, n: number) => app.db.update(tenants).set({ waCotaMensal: n }).where(eq(tenants.id, T.tenantId));
const emailDaNutri = async (T: TenantDeTeste) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId)))[0].email;
const whatsapps = (T: TenantDeTeste) => withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.canal, 'whatsapp')), app.db);

describe('cota de WhatsApp (RN-09, US-036)', () => {
  it('nível: 80% é aviso, 100% esgotada; cota 0 = esgotada', () => {
    expect([nivelDaCota(399, 500), nivelDaCota(400, 500), nivelDaCota(499, 500), nivelDaCota(500, 500), nivelDaCota(0, 0)]).toEqual(['ok', 'aviso', 'aviso', 'esgotada', 'esgotada']);
  });

  it('conta só WhatsApps que contam (lembretes e convite) aceitos no mês civil do tenant — 31/10 às 23:30 de Brasília ainda é outubro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const linhas = [
      { tipo: 'lembrete_24h', canal: 'whatsapp', enviadaEm: em('2026-10-31', '23:30') },
      { tipo: 'convite_paciente', canal: 'whatsapp', enviadaEm: em('2026-10-02', '10:00') },
      { tipo: 'resposta_confirmacao', canal: 'whatsapp', enviadaEm: em('2026-10-10', '10:00') }, // resposta livre não conta
      { tipo: 'lembrete_24h', canal: 'email', enviadaEm: em('2026-10-10', '10:00') },
      { tipo: 'lembrete_2h', canal: 'whatsapp', enviadaEm: em('2026-11-01', '00:30') },
    ];
    for (const [i, l] of linhas.entries()) {
      const inicio = new Date(em('2026-12-01', '08:00').getTime() + i * 7_200_000);
      const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
      const semConsulta = l.tipo === 'convite_paciente';
      await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: semConsulta ? null : c, inicioConsulta: semConsulta ? null : inicio, canal: l.canal, tipo: l.tipo, status: 'enviada', agendadaPara: l.enviadaEm, enviadaEm: l.enviadaEm }), app.db);
    }
    expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, SP, em('2026-10-31', '23:59')), app.db)).toBe(2);
    expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, SP, em('2026-11-01', '00:00')), app.db)).toBe(1); // virada do mês
  });

  it('100%: o que passa da cota fica para a volta seguinte e vira "ignorada"/"cota_esgotada"; o e-mail do mesmo lembrete sai; o admin amplia e volta na hora', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await cota(T, 2);
    const vence = em('2026-10-19', '09:00');
    await devidos(T, 3, vence, { comEmail: true });
    const w = whatsappFalso();
    const d = deps(vence, w);
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(2);
    await processarNotificacoes(deps(vence, w), { tenantId: T.tenantId }); // uso real: 2 de 2 → esgotada
    expect(w.enviados).toHaveLength(2);
    const esgotadas = (await whatsapps(T)).filter((n) => n.motivoIgnorada === 'cota_esgotada');
    expect(esgotadas).toHaveLength(1);
    // US-036 "E os lembretes por e-mail e push continuam": o e-mail do lembrete que ficou sem WhatsApp saiu
    const [{ appointmentId, patientId }] = esgotadas;
    const doEmail = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, appointmentId!), eq(notifications.canal, 'email'))), app.db);
    expect(doEmail.map((n) => [n.tipo, n.status])).toEqual([['lembrete_24h', 'enviada']]);
    const [paciente] = await withTenant(T.ctx, (tx) => tx.select({ email: patients.email }).from(patients).where(eq(patients.id, patientId)), app.db);
    expect(d.transport.enviados.map((e) => e.to)).toContain(paciente.email);
    expect(await situacaoDaCota(T.ctx, { fuso: SP, waCotaMensal: 2 }, vence, app.db)).toEqual({ usadas: 2, cota: 2, nivel: 'esgotada' });
    await cota(T, 1000);
    await devidos(T, 1, new Date(vence.getTime() + 60_000), { dia: '2026-10-21' });
    await processarNotificacoes(deps(new Date(vence.getTime() + 61_000), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(3);
  });

  it('100% (D15): a resposta a "1"/"2" segue saindo e não conta; o lembrete fica "cota_esgotada"', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await cota(T, 0);
    const vence = em('2026-10-19', '09:00');
    await devidos(T, 1, vence);
    await devidos(T, 1, vence, { dia: '2026-10-21', tipo: 'resposta_confirmacao' });
    const w = whatsappFalso();
    await processarNotificacoes(deps(vence, w), { tenantId: T.tenantId });
    expect(w.enviados.map((e) => e.texto)).toEqual(['Presença confirmada. Até lá!']);
    expect((await whatsapps(T)).map((n) => [n.tipo, n.status, n.motivoIgnorada]).sort()).toEqual([
      ['lembrete_24h', 'ignorada', 'cota_esgotada'],
      ['resposta_confirmacao', 'enviada', null],
    ]);
    expect(await situacaoDaCota(T.ctx, { fuso: SP, waCotaMensal: 0 }, vence, app.db)).toEqual({ usadas: 0, cota: 0, nivel: 'esgotada' });
  });

  it('rodada 1 da revisão: na reta final da cota, as linhas que o envio vai ignorar (sem opt-in) não gastam o saldo das válidas — o que não cabe na volta fica "pendente"', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await cota(T, 500);
    const vence = em('2026-10-19', '08:00');
    await jaUsadas(T, 497, em('2026-10-05', '10:00')); // saldo 3
    // as 3 primeiras pela agendada_para são de pacientes sem opt-in; depois, 5 válidas
    await devidos(T, 3, new Date(vence.getTime() - 60_000), { paciente: { telefoneE164: '+5511912345678' } });
    await devidos(T, 5, vence, { dia: '2026-10-21' });
    const w = whatsappFalso();
    const uso = () => withTenant(T.ctx, (tx) => usoDoMes(tx, SP, vence), app.db);
    const lembretes = async () => (await whatsapps(T)).filter((n) => n.tipo === 'lembrete_24h').map((n) => n.motivoIgnorada ?? n.status).sort();
    try {
      await processarNotificacoes(deps(vence, w), { tenantId: T.tenantId });
      // a volta reservou só o saldo (as 3 sem opt-in): as 5 válidas não viram "cota_esgotada" com cota sobrando
      expect(await lembretes()).toEqual([...vezes(5, 'pendente'), ...vezes(3, 'sem_optin')]);
      expect(await uso()).toBe(497);
      await processarNotificacoes(deps(vence, w), { tenantId: T.tenantId });
      expect(await lembretes()).toEqual([...vezes(3, 'enviada'), ...vezes(2, 'pendente'), ...vezes(3, 'sem_optin')]);
      expect(await uso()).toBe(500);
      await processarNotificacoes(deps(vence, w), { tenantId: T.tenantId }); // agora sim, uso real 500 de 500
      expect(await lembretes()).toEqual([...vezes(2, 'cota_esgotada'), ...vezes(3, 'enviada'), ...vezes(3, 'sem_optin')]);
      expect(w.enviados).toHaveLength(3);
      expect(await uso()).toBe(500); // nunca passa da cota
    } finally {
      // nada vencido fica num tenant conectado para a varredura de outro arquivo
      await withTenant(T.ctx, (tx) => tx.delete(notifications).where(eq(notifications.status, 'pendente')), app.db);
    }
  });

  it('100%: o convite que vira "cota_esgotada" na reserva não guarda o conteúdo cifrado (conteudo_selado), como as outras saídas finais', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await cota(T, 0);
    const vence = em('2026-10-19', '09:00');
    const p = await novoPaciente(app.db, T.ctx, comWhats);
    const conteudoSelado = sealSecret('Convite de teste', FINALIDADE_CONTEUDO);
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, canal: 'whatsapp', tipo: 'convite_paciente', conteudoSelado, agendadaPara: vence }), app.db);
    const w = whatsappFalso();
    await processarNotificacoes(deps(vence, w), { tenantId: T.tenantId });
    expect(w.enviados).toEqual([]);
    expect((await whatsapps(T)).map((n) => [n.tipo, n.status, n.motivoIgnorada, n.conteudoSelado])).toEqual([['convite_paciente', 'ignorada', 'cota_esgotada', null]]);
  });

  it('reserva (comEnviando): o WhatsApp que conta e está saindo agora entra no uso; resposta, e-mail e o de outro mês não', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const agora = em('2026-10-19', '09:00');
    const linhas = [
      { canal: 'whatsapp', tipo: 'convite_paciente', status: 'enviando' }, // saindo agora: conta na reserva
      { canal: 'whatsapp', tipo: 'resposta_confirmacao', status: 'enviando' }, // resposta: não conta
      { canal: 'email', tipo: 'convite_paciente', status: 'enviando' }, // e-mail: não conta
      { canal: 'whatsapp', tipo: 'convite_paciente', status: 'enviada', enviadaEm: em('2026-10-05', '10:00') },
      { canal: 'whatsapp', tipo: 'convite_paciente', status: 'enviada', enviadaEm: em('2026-09-30', '10:00') }, // mês anterior
    ];
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values(linhas.map((l) => ({ tenantId: T.tenantId, patientId: p.id, agendadaPara: agora, ...l }))), app.db);
    try {
      expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, SP, agora), app.db)).toBe(1); // a tela e o aviso: só as aceitas
      expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, SP, agora, { comEnviando: true }), app.db)).toBe(2);
    } finally {
      // as "enviando" de mentira não ficam para o destravar de outra varredura
      await withTenant(T.ctx, (tx) => tx.delete(notifications).where(eq(notifications.status, 'enviando')), app.db);
    }
  });

  it('sem provedor (produção hoje): nem trava do ritmo nem cota — o WhatsApp vira "whatsapp_desligado", não "cota_esgotada"', async () => {
    const T = await novoTenant(app.db);
    await cota(T, 0);
    const vence = em('2026-10-19', '09:00');
    await devidos(T, 2, vence);
    const outroWorker = await app.pool.connect();
    let rodada: Promise<unknown> | undefined;
    try {
      // outro worker segura a trava do ritmo deste tenant: sem provedor, a reserva não precisa dela
      await outroWorker.query(`select pg_advisory_lock(hashtext('whatsapp-envio'), hashtext($1))`, [T.tenantId]);
      rodada = processarNotificacoes(deps(vence, null), { tenantId: T.tenantId });
      expect(await Promise.race([rodada.then(() => 'terminou'), new Promise((r) => setTimeout(() => r('presa na trava'), 3000))])).toBe('terminou');
    } finally {
      await outroWorker.query(`select pg_advisory_unlock(hashtext('whatsapp-envio'), hashtext($1))`, [T.tenantId]);
      outroWorker.release();
      await rodada?.catch(() => undefined); // presa (falha), a rodada termina depois de a trava sair
    }
    expect((await whatsapps(T)).map((n) => n.motivoIgnorada)).toEqual(['whatsapp_desligado', 'whatsapp_desligado']);
  });

  it('rodada 1 (D6): o lembrete enviado é imutável — enviar, a nutricionista mudar a hora e enviar de novo contam 2; mudar a hora não reduz o uso do mês', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const p = await novoPaciente(app.db, T.ctx, comWhats);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: em('2026-10-01', '09:00') });
    try {
      const w = whatsappFalso();
      const uso = (agora: Date) => withTenant(T.ctx, (tx) => usoDoMes(tx, SP, agora), app.db);
      await processarNotificacoes(deps(em('2026-10-15', '14:00'), w), { tenantId: T.tenantId });
      expect(await uso(em('2026-10-15', '15:00'))).toBe(1);
      await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-17', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: em('2026-10-15', '15:00') });
      expect(await uso(em('2026-10-15', '15:00'))).toBe(1); // a enviada continua lá, com enviada_em
      await processarNotificacoes(deps(em('2026-10-16', '14:00'), w), { tenantId: T.tenantId });
      expect(w.enviados).toHaveLength(2);
      expect(await uso(em('2026-10-16', '15:00'))).toBe(2);
      const enviadas = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.canal, 'whatsapp'), eq(notifications.status, 'enviada'))), app.db);
      expect(enviadas.map((n) => n.inicioConsulta?.toISOString()).sort()).toEqual([em('2026-10-16', '14:00').toISOString(), em('2026-10-17', '14:00').toISOString()]);
    } finally {
      // os lembretes de 2 h do horário novo ficam pendentes num tenant conectado: não sobram para a varredura de outro arquivo
      await withTenant(T.ctx, (tx) => tx.delete(notifications).where(eq(notifications.status, 'pendente')), app.db);
    }
    expect(await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.status, 'pendente')), app.db)).toEqual([]);
  });

  it('80%: e-mail "Você usou 80% dos WhatsApps do mês" uma vez por mês', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await cota(T, 5);
    const vence = em('2026-10-19', '09:00');
    await devidos(T, 5, vence);
    await processarNotificacoes(deps(vence), { tenantId: T.tenantId });
    const avisos = await emailsNaFila('cota_whatsapp', await emailDaNutri(T));
    expect(avisos.map((a) => [a.usadas, a.cota])).toEqual([[4, 5]]);
    expect(avisos[0].link).toBe('http://localhost:3000/painel/whatsapp');
    const nov = em('2026-11-02', '09:00');
    await devidos(T, 4, nov, { dia: '2026-11-20' });
    await processarNotificacoes(deps(nov), { tenantId: T.tenantId });
    expect(await emailsNaFila('cota_whatsapp', await emailDaNutri(T))).toHaveLength(2); // novo mês, novo aviso
    const marcado = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.canal, 'whatsapp'), eq(notifications.status, 'enviada'))), app.db);
    expect(marcado).toHaveLength(9);
  });

  it('D6: o aviso de 80% falhar não desfaz o registro do envio (a mensagem já saiu); o próximo que conta avisa', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await cota(T, 5);
    const vence = em('2026-10-19', '09:00');
    await devidos(T, 5, vence);
    vi.mocked(avisarNutri).mockRejectedValueOnce(new Error('fila fora do ar'));
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await processarNotificacoes(deps(vence), { tenantId: T.tenantId });
      expect(aviso).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T.tenantId, err: 'Error' }), 'falha no aviso de 80% da cota de WhatsApp');
    } finally {
      aviso.mockRestore();
    }
    expect((await whatsapps(T)).map((n) => n.status)).toEqual(Array(5).fill('enviada')); // a 4ª não ficou "enviando"
    expect((await emailsNaFila('cota_whatsapp', await emailDaNutri(T))).map((a) => [a.usadas, a.cota])).toEqual([[5, 5]]);
  });
});
