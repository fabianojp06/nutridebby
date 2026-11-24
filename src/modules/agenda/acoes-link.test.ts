import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, dbQueMudaNoMeio, em, localPrincipal, novoLocal, semanaNoLocal, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, auditLog, locaisAtendimento, patients, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { abrirLinkConsulta, avisarRemarcacaoPeloLink, cancelarPeloLink, confirmarPeloLink, horariosDoLink, LinkError, MENSAGEM_DO_LINK, remarcarPeloLink, retornoDaConfirmacao } from './acoes-link';
import { confirmarPresenca, pedirRemarcacao } from './cancelamento';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, moverConsulta } from './consultas';
import { assinarLinkConsulta, chaveDosLinks } from './link-consulta';

// N7 (Plano 08): o contexto que o link entrega às ações (implementação real por baixo)
vi.mock('./cancelamento', async (importOriginal) => {
  const real = await importOriginal<typeof import('./cancelamento')>();
  return { ...real, confirmarPresenca: vi.fn(real.confirmarPresenca), pedirRemarcacao: vi.fn(real.pedirRemarcacao) };
});

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só lê pg_stat_activity (a ação ficou presa na trava)
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const chave = chaveDosLinks(Buffer.alloc(32, 9));
const deps = (agora: Date) => ({ db: app.db, agora, chave, ip: '203.0.113.9', appUrl: 'http://localhost:3000' });
const indisponivel = (e: unknown) => e instanceof LinkError && e.message === MSG_AGENDA.contaIndisponivel;
// controlador (complemento): link de um início que a consulta não tem mais = link expirado, não "conta indisponível"
const expirado = (e: unknown) => e instanceof LinkError && e.message === MSG_AGENDA.linkExpirado;
const invalido = (e: unknown) => e instanceof LinkError && e.message === MSG_AGENDA.linkInvalido;

async function cenario(extra: Partial<typeof appointments.$inferInsert> = {}) {
  const T = await novoTenant(app.db, 'Debby Silva');
  const L = await semanaToda(app.db, T.ctx);
  const ana = await novoPaciente(app.db, T.ctx);
  const inicio = em('2026-10-16', '14:00');
  const id = await consultaDireta(app.db, T.ctx, ana.id, inicio, 60, extra);
  return { T, L, ana, id, token: assinarLinkConsulta({ tenantId: T.tenantId, appointmentId: id, inicio, email: ana.email }, chave) };
}
const lerConsulta = async (T: Awaited<ReturnType<typeof cenario>>['T'], id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0];

describe('link da consulta (D20, US-033, US-035)', () => {
  it('controlador (complemento): o retorno de "Confirmar presença" para o paciente tem texto próprio quando não dá mais para confirmar', () => {
    expect(retornoDaConfirmacao('confirmada')).toEqual({ ok: 'Presença confirmada. Até lá!' });
    expect(retornoDaConfirmacao('ja_confirmada')).toEqual({ ok: 'Presença confirmada. Até lá!' });
    expect(retornoDaConfirmacao('nao_confirmavel')).toEqual({ erro: 'Esta consulta não pode mais ser confirmada.' });
    expect(MSG_AGENDA.naoConfirmavel).toBe('Esta consulta não pode mais ser confirmada.');
  });

  it('abre com nutricionista, quando (com fuso) e o que pode fazer; o GET não muda nada', async () => {
    const { T, id, token } = await cenario();
    expect(await abrirLinkConsulta(token, deps(em('2026-10-14', '09:00')))).toMatchObject({
      estado: 'ok', nutri: 'Debby Silva', quando: 'sex., 16/10/2026 às 14:00 (horário de Brasília)', modalidade: 'presencial', local: { nome: null, endereco: null }, linkChamada: null, localId: null, ativa: true, podeAlterar: true, confirmada: false,
    });
    expect((await lerConsulta(T, id)).status).toBe('agendada');
    expect((await abrirLinkConsulta(token, deps(em('2026-10-16', '09:00')))) as { podeAlterar: boolean }).toMatchObject({ podeAlterar: false });
  });

  it('inválido, expirado (consulta começou), tenant suspenso', async () => {
    const { T, token } = await cenario();
    // troca um caractere do meio (o último carrega bits de preenchimento que o decodificador ignora)
    const adulterado = token.slice(0, 10) + (token[10] === 'A' ? 'B' : 'A') + token.slice(11);
    expect(await abrirLinkConsulta(adulterado, deps(em('2026-10-14', '09:00')))).toEqual({ estado: 'invalido' });
    expect(await abrirLinkConsulta(token, deps(em('2026-10-16', '14:00')))).toEqual({ estado: 'expirado' });
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    expect(await abrirLinkConsulta(token, deps(em('2026-10-14', '09:00')))).toEqual({ estado: 'indisponivel' });
    await expect(confirmarPeloLink(token, deps(em('2026-10-14', '09:00')))).rejects.toThrow(LinkError);
  });

  it('confirmar pelo link: "Confirmada pelo link", auditado como o paciente (sem ator, com o IP)', async () => {
    const { T, ana, id, token } = await cenario();
    await confirmarPeloLink(token, deps(em('2026-10-14', '09:00')));
    expect(await lerConsulta(T, id)).toMatchObject({ status: 'confirmada', confirmadaVia: 'link' });
    const [log] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'agenda'), eq(auditLog.entidadeId, id), eq(auditLog.acao, 'alterar'))), app.db);
    expect(log).toMatchObject({ patientId: ana.id, actorUserId: null, ip: '203.0.113.9' });
  });

  it('remarcar pelo link: os horários incluem o da própria consulta; a nova vale; dentro de 24 h, recusa', async () => {
    const { token, L } = await cenario();
    const hs = await horariosDoLink(token, em('2026-10-16', '00:00'), em('2026-10-17', '00:00'), deps(em('2026-10-14', '09:00')));
    expect(hs.map((h) => h.hora)).toContain('14:00');
    expect(await remarcarPeloLink(token, { inicio: em('2026-10-16', '16:00').toISOString(), localId: L }, deps(em('2026-10-14', '09:00')))).toEqual({ quando: 'sex., 16/10/2026 às 16:00 (horário de Brasília)' });
    const outro = await cenario();
    await expect(cancelarPeloLink(outro.token, deps(em('2026-10-16', '09:00')))).rejects.toSatisfy((e: unknown) => e instanceof ConsultaError && e.erros.geral === MSG_AGENDA.foraDoPrazo);
  });

  it('cancelar pelo link (dentro do prazo): "cancelada" pelo paciente, a nutricionista é avisada; o link passa a mostrar a consulta cancelada, sem ações', async () => {
    const { T, id, token } = await cenario();
    await cancelarPeloLink(token, deps(em('2026-10-14', '09:00')));
    expect(await lerConsulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'paciente' });
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).map((m) => m.evento)).toEqual(['cancelada']);
    expect(await abrirLinkConsulta(token, deps(em('2026-10-14', '09:05')))).toMatchObject({ estado: 'ok', status: 'cancelada', ativa: false, podeAlterar: false });
  });

  it('rodada 1 (RN-08, US-018): paciente arquivado, bloqueado ou anonimizado → link "indisponivel"; confirmar, cancelar, remarcar e avisar recusam (nunca 500) e nada muda', async () => {
    for (const mudanca of [{ status: 'arquivado' }, { status: 'bloqueado' }, { anonimizadoEm: em('2026-10-01', '09:00') }]) {
      const { T, L, ana, id, token } = await cenario();
      await withTenant(T.ctx, (tx) => tx.update(patients).set(mudanca).where(eq(patients.id, ana.id)), app.db);
      const d = deps(em('2026-10-14', '09:00'));
      expect(await abrirLinkConsulta(token, d), JSON.stringify(mudanca)).toEqual({ estado: 'indisponivel' });
      expect(await horariosDoLink(token, em('2026-10-16', '00:00'), em('2026-10-17', '00:00'), d)).toEqual([]);
      const acoes = [
        () => confirmarPeloLink(token, d),
        () => cancelarPeloLink(token, d),
        () => remarcarPeloLink(token, { inicio: em('2026-10-16', '16:00').toISOString(), localId: L }, d),
        () => avisarRemarcacaoPeloLink(token, d),
      ];
      for (const acao of acoes) await expect(acao()).rejects.toSatisfy(indisponivel);
      expect(await lerConsulta(T, id)).toMatchObject({ status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
    }
  });

  it('revisão da T5: link de um início que a consulta não tem mais (a nutricionista mudou o horário, para antes ou para depois) → "expirado" ("Este link expirou.") e nada muda; o link novo vale', async () => {
    const { T, L, ana, id, token } = await cenario(); // link de 16/10 às 14:00
    const d = deps(em('2026-10-14', '09:00'));
    for (const hora of ['10:00', '18:00']) {
      await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora, duracaoMin: '60', localId: await localPrincipal(app.db, T.ctx) }, { db: app.db, now: em('2026-10-14', '08:00') });
      expect(await abrirLinkConsulta(token, d), hora).toEqual({ estado: 'expirado' });
      expect(await horariosDoLink(token, em('2026-10-16', '00:00'), em('2026-10-17', '00:00'), d)).toEqual([]);
      const acoes = [
        () => confirmarPeloLink(token, d),
        () => cancelarPeloLink(token, d),
        () => remarcarPeloLink(token, { inicio: em('2026-10-17', '16:00').toISOString(), localId: L }, d),
        () => avisarRemarcacaoPeloLink(token, d),
      ];
      for (const acao of acoes) await expect(acao()).rejects.toSatisfy(expirado);
    }
    expect(await lerConsulta(T, id)).toMatchObject({ status: 'agendada', inicio: em('2026-10-16', '18:00'), confirmadaVia: null, pedidoRemarcacaoEm: null });
    const novo = assinarLinkConsulta({ tenantId: T.tenantId, appointmentId: id, inicio: em('2026-10-16', '18:00'), email: ana.email }, chave);
    expect(await abrirLinkConsulta(novo, d)).toMatchObject({ estado: 'ok', quando: 'sex., 16/10/2026 às 18:00 (horário de Brasília)' });
    // "indisponível" fica para conta suspensa e paciente inativo — e vale antes do "expirado" do link antigo
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, ana.id)), app.db);
    expect(await abrirLinkConsulta(token, d)).toEqual({ estado: 'indisponivel' });
  });

  it('revisão da T5: a nutricionista muda o horário entre abrir o link e clicar — a ação, presa na trava da consulta, confere o início de novo e recusa como link expirado', async () => {
    const { T, id, token } = await cenario();
    const outra = await app.pool.connect();
    let confirmada = false;
    try {
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      await outra.query('select 1 from appointments where id = $1 for update', [id]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const resultado = confirmarPeloLink(token, deps(em('2026-10-14', '09:00'))).then(
        () => null,
        (e: unknown) => e,
      );
      for (let i = 0; ; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 200) throw new Error('a ação não ficou presa na trava da consulta');
        await new Promise((r) => setTimeout(r, 10));
      }
      await outra.query(`update appointments set inicio = inicio - interval '2 hours', fim = fim - interval '2 hours' where id = $1`, [id]);
      await outra.query('commit');
      confirmada = true;
      expect(expirado(await resultado)).toBe(true);
    } finally {
      if (!confirmada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await lerConsulta(T, id)).toMatchObject({ status: 'agendada', confirmadaVia: null, inicio: em('2026-10-16', '12:00') });
  });
  it('decisão do dono (fechamento): corrigido o e-mail do paciente, o link emitido antes não vale ("Link inválido.") e nada muda; o mesmo e-mail com outra grafia continua valendo; o link com o e-mail novo vale', async () => {
    const { T, L, ana, id, token } = await cenario();
    const d = deps(em('2026-10-14', '09:00'));
    const trocarEmail = (email: string) => withTenant(T.ctx, (tx) => tx.update(patients).set({ email }).where(eq(patients.id, ana.id)), app.db);
    await trocarEmail(ana.email.toUpperCase()); // citext: o mesmo endereço
    expect(await abrirLinkConsulta(token, d)).toMatchObject({ estado: 'ok' });
    const novoEmail = `nova-${randomUUID().slice(0, 8)}@ex.com`;
    await trocarEmail(novoEmail);
    expect(await abrirLinkConsulta(token, d)).toEqual({ estado: 'invalido' });
    expect(MENSAGEM_DO_LINK.invalido).toBe('Link inválido.');
    expect(await horariosDoLink(token, em('2026-10-16', '00:00'), em('2026-10-17', '00:00'), d)).toEqual([]);
    const acoes = [
      () => confirmarPeloLink(token, d),
      () => cancelarPeloLink(token, d),
      () => remarcarPeloLink(token, { inicio: em('2026-10-16', '16:00').toISOString(), localId: L }, d),
      () => avisarRemarcacaoPeloLink(token, d),
    ];
    for (const acao of acoes) await expect(acao()).rejects.toSatisfy(invalido);
    expect(await lerConsulta(T, id)).toMatchObject({ status: 'agendada', inicio: em('2026-10-16', '14:00'), confirmadaVia: null, pedidoRemarcacaoEm: null });
    const novo = assinarLinkConsulta({ tenantId: T.tenantId, appointmentId: id, inicio: em('2026-10-16', '14:00'), email: novoEmail }, chave);
    expect(await abrirLinkConsulta(novo, d)).toMatchObject({ estado: 'ok' });
  });

  it('decisão do dono (fechamento): a nutricionista corrige o e-mail entre abrir o link e clicar — a ação, presa na trava do paciente, confere o e-mail de novo e recusa como link inválido', async () => {
    const { T, ana, id, token } = await cenario();
    const outra = await app.pool.connect();
    let confirmada = false;
    try {
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      await outra.query('select 1 from patients where id = $1 for update', [ana.id]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const resultado = confirmarPeloLink(token, deps(em('2026-10-14', '09:00'))).then(
        () => null,
        (e: unknown) => e,
      );
      for (let i = 0; ; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 200) throw new Error('a ação não ficou presa na trava do paciente');
        await new Promise((r) => setTimeout(r, 10));
      }
      await outra.query(`update patients set email = $2 where id = $1`, [ana.id, `outra-${randomUUID().slice(0, 8)}@ex.com`]);
      await outra.query('commit');
      confirmada = true;
      expect(invalido(await resultado)).toBe(true);
    } finally {
      if (!confirmada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await lerConsulta(T, id)).toMatchObject({ status: 'agendada', confirmadaVia: null });
  });

  it('N7 (Plano 08): o link age como o próprio paciente, sem conta (semConta) — a consulta de outro paciente do mesmo consultório segue invisível', async () => {
    const { T, ana, id, token } = await cenario();
    const bia = await novoPaciente(app.db, T.ctx);
    const daBia = await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-16', '16:00'));
    await confirmarPeloLink(token, deps(em('2026-10-14', '09:00')));
    await avisarRemarcacaoPeloLink(token, deps(em('2026-10-16', '09:00')));
    const ctxs = [vi.mocked(confirmarPresenca).mock.calls.at(-1)![0], vi.mocked(pedirRemarcacao).mock.calls.at(-1)![0]];
    for (const ctx of ctxs) {
      expect(ctx).toEqual<TenantContext>({ tenantId: T.tenantId, role: 'paciente', patientId: ana.id, semConta: true, ip: '203.0.113.9' });
      const vistas = await withTenant(ctx, (tx) => tx.select({ id: appointments.id }).from(appointments).where(inArray(appointments.id, [id, daBia])), app.db);
      expect(vistas).toEqual([{ id }]);
    }
  });
});

describe('Plano 23 (T4): local no link da consulta (US-402, US-403, RN-406, CS-401)', () => {
  const SALA = 'https://meet.google.com/sala-do-link';
  const agoraLink = em('2026-10-14', '09:00');

  it('presencial num local: nome e endereço do local; nada de link nas chaves (nem a sala do outro local, nem link_online)', async () => {
    const { T, ana } = await cenario();
    const centro = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
    await owner.db.update(locaisAtendimento).set({ endereco: 'Av. Central, 500', cidade: 'Campinas' }).where(eq(locaisAtendimento.id, centro));
    await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: SALA });
    const inicio = em('2026-10-17', '14:00');
    const id = await consultaDireta(app.db, T.ctx, ana.id, inicio, 60, { localId: centro });
    const token = assinarLinkConsulta({ tenantId: T.tenantId, appointmentId: id, inicio, email: ana.email }, chave);
    const e = await abrirLinkConsulta(token, deps(agoraLink));
    expect(e).toMatchObject({ estado: 'ok', modalidade: 'presencial', local: { nome: 'Clínica Centro', endereco: 'Av. Central, 500' }, linkChamada: null, localId: centro });
    expect(JSON.stringify(e)).not.toMatch(/https?:|linkOnline|linkSala|link_online|temOnline/);
    if (e.estado !== 'ok') throw new Error();
    expect(e.locais.map((l) => l.nome)).toEqual(['Consultório', 'Clínica Centro', 'Videoconferência']);
  });

  it('consulta antiga (sem local) mostra o endereço do Perfil; online ativa mostra o link da própria consulta; online cancelada, não', async () => {
    const { T, ana, token } = await cenario();
    await app.db.update(tenants).set({ enderecoConsultorio: 'Rua do Perfil, 1' }).where(eq(tenants.id, T.tenantId));
    expect(await abrirLinkConsulta(token, deps(agoraLink))).toMatchObject({ local: { nome: null, endereco: 'Rua do Perfil, 1' }, linkChamada: null });
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: SALA });
    const inicio = em('2026-10-17', '14:00');
    const id = await consultaDireta(app.db, T.ctx, ana.id, inicio, 60, { localId: video, modalidade: 'online', linkOnline: SALA });
    const tk = assinarLinkConsulta({ tenantId: T.tenantId, appointmentId: id, inicio, email: ana.email }, chave);
    expect(await abrirLinkConsulta(tk, deps(agoraLink))).toMatchObject({ modalidade: 'online', local: { nome: 'Videoconferência', endereco: null }, linkChamada: SALA });
    await withTenant(T.ctx, (tx) => tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agoraLink }).where(eq(appointments.id, id)), app.db);
    const cancelada = await abrirLinkConsulta(tk, deps(agoraLink));
    expect(cancelada).toMatchObject({ ativa: false, linkChamada: null });
    expect(JSON.stringify(cancelada)).not.toContain(SALA);
  });

  it('remarcar pelo link para outro local: a consulta nova fica no local escolhido', async () => {
    const { T, id, token } = await cenario();
    const centro = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
    await semanaNoLocal(app.db, T.ctx, centro);
    const hs = await horariosDoLink(token, em('2026-10-16', '00:00'), em('2026-10-17', '00:00'), deps(agoraLink));
    expect(hs.filter((h) => h.hora === '16:00').map((h) => h.localId)).toContain(centro);
    await remarcarPeloLink(token, { inicio: em('2026-10-16', '16:00').toISOString(), localId: centro }, deps(agoraLink));
    const [nova] = await withTenant(T.ctx, (tx) => tx.select({ localId: appointments.localId }).from(appointments).where(eq(appointments.remarcadaDe, id)), app.db);
    expect(nova).toEqual({ localId: centro });
  });

  it('local sem agendamento entre a tela e o envio: o 42501 do gatilho vira "Esse horário não está mais disponível. Escolha outro." (não 500)', async () => {
    const { T, id, token } = await cenario();
    const centro = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
    await semanaNoLocal(app.db, T.ctx, centro);
    // 1ª transação: o link (resolver); 2ª: a escolha do horário; 3ª: a gravação, recusada pelo gatilho
    const m = dbQueMudaNoMeio(app.db, 2, () => owner.db.update(locaisAtendimento).set({ agendamentoOnline: false }).where(eq(locaisAtendimento.id, centro)));
    await expect(remarcarPeloLink(token, { inicio: em('2026-10-16', '16:00').toISOString(), localId: centro }, { ...deps(agoraLink), db: m.db })).rejects.toSatisfy(
      (e: unknown) => e instanceof ConsultaError && e.erros.inicio === MSG_AGENDA.indisponivel,
    );
    expect([m.rodou(), m.transacoes()]).toEqual([true, 3]);
    expect(await lerConsulta(T, id)).toMatchObject({ status: 'agendada' });
  });
});
