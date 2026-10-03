import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, em, SP, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { transporteFalso } from '../../../test/email';
import { depsDeEnvio } from '../../../test/notificacoes';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { conexaoDeTeste, whatsappFalso } from '../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { notifications, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { sealSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { agendarPelaNutri } from '@/modules/agenda/consultas';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { processarNotificacoes, WHATSAPP_POR_MINUTO, type DepsEnvio } from './enviar';
import { FINALIDADE_CONTEUDO } from './mensagens';
import type { ResultadoEnvio } from './whatsapp/provedor';

// a volta do cron só com os tenants do teste: os outros arquivos rodam ao mesmo tempo no mesmo banco (implementação real por baixo)
vi.mock('@/modules/plataforma/tenant-status', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/tenant-status')>();
  return { ...real, listarTenantsParaVarredura: vi.fn(real.listarTenantsParaVarredura) };
});

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const marcadaEm = new Date('2026-10-01T12:00:00Z');
const comWhats = { telefoneE164: '+5511912345678', whatsappOptinEm: marcadaEm, whatsappOptinOrigem: 'nutri' };
// R12: o ajudante único dos testes do motor (test/notificacoes.ts)
const deps = (agora: Date, whatsapp: DepsEnvio['whatsapp'], transport = transporteFalso()) => depsDeEnvio(agora, { db: app.db, whatsapp, transport });
async function marcada(T: TenantDeTeste, paciente: Record<string, unknown> = comWhats) {
  const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', ...paciente });
  const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: marcadaEm });
  return { p, id };
}
const linha = async (T: TenantDeTeste, id: string, tipo: string, canal: string) =>
  (await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, tipo), eq(notifications.canal, canal))), app.db))[0];
const vence24h = em('2026-10-15', '14:00');

describe('WhatsApp nos lembretes (INT-01 adaptado, D6)', () => {
  it('com opt-in, telefone e conexão: envia o texto com "1"/"2" e grava id e jid do provedor', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const { id } = await marcada(T);
    const w = whatsappFalso();
    await processarNotificacoes(deps(vence24h, w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(1);
    expect(w.enviados[0]).toMatchObject({ instancia: `nd-${T.tenantId}`, numero: '5511912345678' });
    expect(w.enviados[0].texto).toContain('Responda 1 para confirmar ou 2 se precisar remarcar.');
    const l = await linha(T, id, 'lembrete_24h', 'whatsapp');
    expect(l).toMatchObject({ status: 'enviada', providerJid: '5511912345678@s.whatsapp.net' });
    expect(l.providerMsgId).toMatch(/^fake-/);
  });

  it('sem opt-in, com opt-out, sem telefone, desconectado ou desligado na plataforma → "ignorada" com o motivo (e-mail segue)', async () => {
    const casos: [Record<string, unknown>, 'conectada' | 'desconectada', boolean, string][] = [
      [{ telefoneE164: '+5511912345678' }, 'conectada', true, 'sem_optin'],
      [{ ...comWhats, whatsappOptoutEm: marcadaEm }, 'conectada', true, 'sem_optin'],
      [{ whatsappOptinEm: null }, 'conectada', true, 'sem_optin'],
      [{ telefoneE164: null, whatsappOptinEm: marcadaEm, whatsappOptinOrigem: 'nutri' }, 'conectada', true, 'sem_telefone'],
      [comWhats, 'desconectada', true, 'whatsapp_desconectado'],
      [comWhats, 'conectada', false, 'whatsapp_desligado'],
    ];
    for (const [paciente, estado, ligado, motivo] of casos) {
      const T = await novoTenant(app.db);
      await conexaoDeTeste(app.db, T.ctx, estado);
      const { id } = await marcada(T, paciente);
      const t = transporteFalso();
      await processarNotificacoes(deps(vence24h, ligado ? whatsappFalso() : null, t), { tenantId: T.tenantId });
      expect(await linha(T, id, 'lembrete_24h', 'whatsapp'), motivo).toMatchObject({ status: 'ignorada', motivoIgnorada: motivo });
      expect(t.enviados.some((e) => e.subject.startsWith('Lembrete'))).toBe(true);
    }
  });

  it('erro passageiro: novas tentativas em 1, 5 e 25 min; depois "falhou" e o e-mail do lembrete que tinha falhado sai de novo (US-034)', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const { id } = await marcada(T);
    // o e-mail deste lembrete já tinha falhado de vez
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'falhou', erro: 'email' }).where(and(eq(notifications.appointmentId, id), eq(notifications.canal, 'email'), eq(notifications.tipo, 'lembrete_24h'))), app.db);
    const fora: ResultadoEnvio = { ok: false, definitivo: false, codigo: 'indisponivel' };
    const w = whatsappFalso({ resposta: () => fora });
    let agora = vence24h;
    for (const espera of [60, 300, 1500]) {
      await processarNotificacoes(deps(agora, w), { tenantId: T.tenantId });
      const l = await linha(T, id, 'lembrete_24h', 'whatsapp');
      expect(l.status).toBe('pendente');
      expect(l.agendadaPara.getTime() - agora.getTime()).toBe(espera * 1000);
      agora = l.agendadaPara;
    }
    const t = transporteFalso();
    await processarNotificacoes(deps(agora, w, t), { tenantId: T.tenantId }); // 4ª = 1 + 3 novas tentativas
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'indisponivel', tentativas: 4 });
    expect(w.enviados).toHaveLength(4);
    await processarNotificacoes(deps(agora, w, t), { tenantId: T.tenantId });
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'enviada' });
    expect(t.enviados.map((e) => e.subject)).toContain('Lembrete: sua consulta é amanhã às 14:00');
  });

  it('número sem WhatsApp: "falhou" na hora, sem nova tentativa', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const { id } = await marcada(T);
    const w = whatsappFalso({ resposta: () => ({ ok: false, definitivo: true, codigo: 'numero_sem_whatsapp' }) });
    await processarNotificacoes(deps(vence24h, w), { tenantId: T.tenantId });
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'numero_sem_whatsapp', tentativas: 1 });
  });

  it('D6 (no máximo uma vez): timeout do provedor ou exceção no envio — não se sabe se saiu — vira "falhou" na hora e nunca repete', async () => {
    const respostas: [string, () => ResultadoEnvio][] = [
      ['timeout', () => ({ ok: false, definitivo: true, codigo: 'sem_resposta' })],
      [
        'exceção',
        () => {
          throw new Error('falha ao enviar para 5511912345678');
        },
      ],
    ];
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      for (const [caso, resposta] of respostas) {
        const T = await novoTenant(app.db);
        await conexaoDeTeste(app.db, T.ctx, 'conectada');
        const { id } = await marcada(T);
        const w = whatsappFalso({ resposta });
        await processarNotificacoes(deps(vence24h, w), { tenantId: T.tenantId });
        expect(await linha(T, id, 'lembrete_24h', 'whatsapp'), caso).toMatchObject({ status: 'falhou', erro: 'sem_resposta', tentativas: 1 });
        await processarNotificacoes(deps(new Date(vence24h.getTime() + 30 * 60_000), w), { tenantId: T.tenantId }); // depois da última espera (25 min)
        expect(w.enviados, caso).toHaveLength(1);
      }
      // RNF-11: só o nome do erro — nunca a mensagem (que pode trazer o número)
      expect(aviso).toHaveBeenCalledWith(expect.objectContaining({ canal: 'whatsapp', err: 'Error' }), 'falha no provedor de WhatsApp');
      expect(JSON.stringify(aviso.mock.calls)).not.toContain('5511912345678');
    } finally {
      aviso.mockRestore();
    }
  });

  it(`ritmo (D16): no máximo ${WHATSAPP_POR_MINUTO} por minuto por tenant; o resto sai na volta seguinte`, async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    for (let i = 0; i < WHATSAPP_POR_MINUTO + 2; i++) {
      const p = await novoPaciente(app.db, T.ctx, comWhats);
      const inicio = em('2026-10-16', `${String(8 + i).padStart(2, '0')}:00`);
      const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
      await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: inicio, canal: 'whatsapp', tipo: 'lembrete_24h', agendadaPara: em('2026-10-15', '08:00') }), app.db);
    }
    const w = whatsappFalso();
    await processarNotificacoes(deps(em('2026-10-15', '08:00'), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(WHATSAPP_POR_MINUTO);
    await processarNotificacoes(deps(em('2026-10-15', '08:00'), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(WHATSAPP_POR_MINUTO); // ainda no mesmo minuto
    await processarNotificacoes(deps(em('2026-10-15', '08:01'), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(WHATSAPP_POR_MINUTO + 2);
  });

  it('D16: um worker por vez decide o ritmo do tenant — a reserva espera a trava e conta o que o outro acabou de reservar', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const ids: string[] = [];
    for (let i = 0; i < WHATSAPP_POR_MINUTO + 2; i++) {
      const p = await novoPaciente(app.db, T.ctx, comWhats);
      const inicio = em('2026-10-17', `${String(8 + i).padStart(2, '0')}:00`);
      const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
      const [n] = await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: inicio, canal: 'whatsapp', tipo: 'lembrete_24h', agendadaPara: em('2026-10-16', '08:00') }).returning(), app.db);
      ids.push(n.id);
    }
    const trava = [`select pg_advisory_lock(hashtext('whatsapp-envio'), hashtext($1))`, `select pg_advisory_unlock(hashtext('whatsapp-envio'), hashtext($1))`];
    const outroWorker = await app.pool.connect();
    try {
      await outroWorker.query(trava[0], [T.tenantId]);
      const w = whatsappFalso();
      const rodada = processarNotificacoes(deps(em('2026-10-16', '08:00'), w), { tenantId: T.tenantId });
      // a reserva para na trava do tenant (sem a trava, a rodada terminaria sozinha e o laço só esgotaria o tempo)
      for (let i = 0; i < 100; i++) {
        const { rows } = await app.pool.query(`select 1 from pg_locks where locktype = 'advisory' and not granted and classid = hashtext('whatsapp-envio')::oid and objid = hashtext($1)::oid`, [T.tenantId]);
        if (rows.length) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      // enquanto isso, o outro worker reserva 8 (pendente → enviando) e solta a trava
      await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviando' }).where(inArray(notifications.id, ids.slice(0, WHATSAPP_POR_MINUTO))), app.db);
      await outroWorker.query(trava[1], [T.tenantId]);
      await rodada;
      expect(w.enviados).toEqual([]); // as 8 que estão saindo ocupam as vagas do minuto
    } finally {
      outroWorker.release();
    }
  });

  it('rodada 1 (D6): 100 WhatsApps atrasados de um tenant não seguram o e-mail e o push dele nem os de outro tenant na mesma volta do cron', async () => {
    const agora = em('2026-09-14', '10:00');
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const p = await novoPaciente(app.db, T.ctx, comWhats);
    const selado = sealSecret('Convite de teste', FINALIDADE_CONTEUDO);
    await withTenant(
      T.ctx,
      (tx) => tx.execute(sql`insert into notifications (tenant_id, patient_id, canal, tipo, conteudo_selado, agendada_para)
        select ${T.tenantId}, ${p.id}, 'whatsapp', 'convite_paciente', ${selado}, ${em('2026-09-14', '09:00')}::timestamptz from generate_series(1, 100)`),
      app.db,
    );
    try {
      const consultas: Record<string, string> = {};
      for (const X of [T, U]) {
        const q = await novoPaciente(app.db, X.ctx, comWhats);
        consultas[X.tenantId] = (await agendarPelaNutri(X.ctx, tenantAgenda(X), { patientId: q.id, data: '2026-10-20', hora: '10:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: agora })).id;
      }
      const w = whatsappFalso();
      const t = transporteFalso();
      // a volta do cron (sem tenantId: parte de cada um e segunda passada), só com T e U
      vi.mocked(listarTenantsParaVarredura).mockClear().mockResolvedValueOnce([{ id: T.tenantId, fuso: SP }, { id: U.tenantId, fuso: SP }]);
      await processarNotificacoes(deps(agora, w, t));
      expect(listarTenantsParaVarredura).toHaveBeenCalledTimes(1);
      for (const X of [T, U]) {
        expect(await linha(X, consultas[X.tenantId], 'consulta_marcada', 'email'), X.tenantId).toMatchObject({ status: 'enviada' });
        expect((await linha(X, consultas[X.tenantId], 'consulta_marcada', 'push')).status, X.tenantId).not.toBe('pendente');
      }
      expect(w.enviados).toHaveLength(WHATSAPP_POR_MINUTO); // o WhatsApp andou no ritmo, sem passar dele
    } finally {
      // os convites atrasados não ficam num tenant conectado para a próxima varredura sem lista simulada
      await withTenant(T.ctx, (tx) => tx.delete(notifications).where(eq(notifications.tipo, 'convite_paciente')), app.db);
    }
    expect(await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'convite_paciente')), app.db)).toEqual([]);
  });

  it('paciente que revogou o WhatsApp depois de marcar não recebe (US-011 "Revogar")', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const { p, id } = await marcada(T);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ whatsappOptoutEm: marcadaEm }).where(eq(patients.id, p.id)), app.db);
    const w = whatsappFalso();
    await processarNotificacoes(deps(vence24h, w), { tenantId: T.tenantId });
    expect(w.enviados).toEqual([]);
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ motivoIgnorada: 'sem_optin' });
  });
});
