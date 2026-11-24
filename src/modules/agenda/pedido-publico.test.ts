import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, novoLocal, semanaNoLocal, semanaToda, SP, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, consents, locaisAtendimento, notifications, patients, publicBookingRequests, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { openSecret, randomToken, sha256 } from '@/lib/crypto';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { aceitarPedidoPublico, desistirDoPedidoPublico } from './agendamento-publico';
import { MSG_SOLICITACOES } from './constantes';
import { ConsultaError } from './consultas';
import { quandoComFuso, somarDias } from './fuso';
import { aceitarSolicitacao, contarSolicitacoesNaTransacao, listarSolicitacoes, PedidoMudouError, recusarSolicitacao, vencerSolicitacoes } from './solicitacoes';

/**
 * Plano 23 (US-408, US-409, RN-424, RN-428, RN-429, AG-D23, AG-D42, AG-D48, AG-D63, AG-D75): o pedido da pessoa nova
 * aguardando — aceite (`aceitarPedidoPublico`, pela fila), recusa, vencimento e desistência pelo link do e-mail.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = em('2026-10-14', '10:00');
const depsSol = (a: Date = agora) => ({ db: app.db, agora: a, appUrl: 'http://localhost:3000' });
const SALA = 'https://meet.google.com/sala-da-pessoa-nova';

type Consultorio = TenantDeTeste & { slug: string; localId: string };
async function consultorio(extra: Partial<typeof tenants.$inferInsert> = {}): Promise<Consultorio> {
  const T = await novoTenant(app.db, 'Debby Silva');
  const [t] = await app.db.update(tenants).set({ agendamentoPublicoAtivo: true, ...extra }).where(eq(tenants.id, T.tenantId)).returning();
  const localId = await semanaToda(app.db, T.ctx);
  await withTenant(T.ctx, (tx) => tx.update(tenants).set({ agendaConfirmarPedidos: true }).where(eq(tenants.id, T.tenantId)), app.db);
  return { ...T, slug: t.slug, localId };
}

/** O pedido aguardando gravado direto (como `app_pedido_aguardar` o deixa), na sessão da nutricionista. Devolve id e token. */
async function aguardando(
  T: Consultorio,
  o: { inicio?: Date; email?: string; nome?: string; telefone?: string | null; whatsapp?: boolean; localId?: string; modalidade?: string; verificadoEm?: Date; ip?: string | null } = {},
): Promise<{ id: string; token: string; email: string }> {
  const id = randomUUID();
  const token = randomToken();
  const inicio = o.inicio ?? em('2026-10-16', '09:00');
  const email = o.email ?? `carla-${randomUUID().slice(0, 8)}@ex.com`;
  const verificadoEm = o.verificadoEm ?? em('2026-10-14', '09:30');
  await withTenant(
    T.ctx,
    (tx) =>
      tx.insert(publicBookingRequests).values({
        id,
        tenantId: T.tenantId,
        tokenHash: sha256(token),
        codigoHash: 'x',
        email,
        nome: o.nome ?? 'Carla Dias',
        telefoneE164: o.telefone === undefined ? '+5511912345678' : o.telefone,
        whatsappOptin: o.whatsapp ?? true,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        modalidade: o.modalidade ?? 'presencial',
        localId: o.localId ?? T.localId,
        termoVersao: TERMO_PACIENTE,
        ip: o.ip === undefined ? '198.51.100.7' : o.ip,
        expiraEm: new Date(verificadoEm.getTime() + 10 * 60_000),
        verificadoEm,
        aguardandoDesde: verificadoEm,
        createdAt: new Date(verificadoEm.getTime() - 60_000),
      }),
    app.db,
  );
  return { id, token, email };
}
const linhaDoPedido = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.id, id)), app.db))[0];
const pacientesCom = (T: TenantDeTeste, email: string) => withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.email, email)), app.db);
const emailDaNutri = async (T: TenantDeTeste) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId)))[0].email;
const erro = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
/** Os e-mails na fila com o `startAfter` do pg-boss (AG-D75: o adiamento para as 08:00). */
async function emailsComHora<T extends EmailMessage['tipo']>(tipo: T, para: string): Promise<{ msg: Extract<EmailMessage, { tipo: T }>; startAfter: Date }[]> {
  const jobs = await (await getBoss()).findJobs<EmailJobData>('email');
  return jobs
    .map((j) => ({ msg: JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage, startAfter: new Date(j.startAfter) }))
    .filter((x): x is { msg: Extract<EmailMessage, { tipo: T }>; startAfter: Date } => x.msg.tipo === tipo && x.msg.para === para);
}

describe('aceite da pessoa nova (RN-424, US-409)', () => {
  it('cria o paciente (origem agendamento_publico, opt-in do WhatsApp com a data da verificação), o aceite do termo (versão, momento e IP do pedido) e a consulta agendada; o pedido fica aceito', async () => {
    const T = await consultorio();
    const p = await aguardando(T);
    await aceitarSolicitacao(T.ctx, tenantAgenda(T, { agendaConfirmarPedidos: true }), { tipo: 'pessoa_nova', id: p.id }, depsSol());
    const [pac] = await pacientesCom(T, p.email);
    expect(pac).toMatchObject({ nome: 'Carla Dias', origem: 'agendamento_publico', telefoneE164: '+5511912345678', whatsappOptinEm: em('2026-10-14', '09:30'), whatsappOptinOrigem: 'paciente', status: 'ativo' });
    const [aceite] = await app.db.select().from(consents).where(eq(consents.patientId, pac.id));
    expect(aceite).toMatchObject({ tenantId: T.tenantId, userId: null, termoVersao: TERMO_PACIENTE, aceitoEm: em('2026-10-14', '09:30'), ip: '198.51.100.7' });
    const cs = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, pac.id)), app.db);
    expect(cs).toMatchObject([{ status: 'agendada', origem: 'paciente', inicio: em('2026-10-16', '09:00'), localId: T.localId, modalidade: 'presencial' }]);
    const avisos = await withTenant(T.ctx, (tx) => tx.select({ tipo: notifications.tipo }).from(notifications).where(eq(notifications.appointmentId, cs[0].id)), app.db);
    expect(avisos.map((a) => a.tipo)).toContain('consulta_marcada');
    expect(avisos.map((a) => a.tipo)).toContain('lembrete_24h');
    expect(await linhaDoPedido(T, p.id)).toMatchObject({ concluidoEm: agora, appointmentId: cs[0].id, resolvidoEm: agora, resolucao: 'aceito' });
    // respondido: aceitar ou recusar de novo → "já foi respondido"
    expect(await erro(aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol()))).toBeInstanceOf(PedidoMudouError);
    expect(await erro(recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol()))).toBeInstanceOf(PedidoMudouError);
  });

  it('sem opt-in (ou sem telefone): o paciente nasce sem whatsapp_optin_em', async () => {
    const T = await consultorio();
    const p1 = await aguardando(T, { whatsapp: false });
    const p2 = await aguardando(T, { inicio: em('2026-10-16', '11:00'), whatsapp: true, telefone: null });
    for (const p of [p1, p2]) {
      await aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol());
      expect((await pacientesCom(T, p.email))[0]).toMatchObject({ whatsappOptinEm: null, whatsappOptinOrigem: null });
    }
  });

  it('o e-mail virou paciente ativo: a consulta vai para ele, sem cadastro novo, opt-in dele intacto', async () => {
    const T = await consultorio();
    const ana = await novoPaciente(app.db, T.ctx, { email: `ana-${randomUUID().slice(0, 8)}@ex.com` });
    const p = await aguardando(T, { email: ana.email.toUpperCase() });
    await aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol());
    expect(await pacientesCom(T, ana.email)).toMatchObject([{ id: ana.id, whatsappOptinEm: null, origem: ana.origem }]);
    // revisão da T7 (M1): quem provou o código aceitou o termo na página — o aceite vale também para o paciente que já existia
    expect(await app.db.select().from(consents).where(eq(consents.patientId, ana.id))).toMatchObject([
      { tenantId: T.tenantId, userId: null, termoVersao: TERMO_PACIENTE, aceitoEm: em('2026-10-14', '09:30'), ip: '198.51.100.7' },
    ]);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, ana.id)), app.db)).toMatchObject([{ status: 'agendada' }]);
    expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolucao: 'aceito' });
  });

  it('e-mail de paciente arquivado ou bloqueado → "Este e-mail é de um paciente arquivado ou bloqueado…"; nada muda', async () => {
    const T = await consultorio();
    for (const extra of [{ status: 'arquivado' }, { status: 'bloqueado', bloqueadoEm: agora }] as const) {
      const x = await novoPaciente(app.db, T.ctx, extra);
      const p = await aguardando(T, { email: x.email, inicio: em('2026-10-16', extra.status === 'arquivado' ? '09:00' : '10:00') });
      const e = await erro(aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol()));
      expect((e as ConsultaError).erros).toEqual({ geral: MSG_SOLICITACOES.emailInativo });
      expect(await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, x.id)), app.db)).toEqual([]);
      expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: null, resolucao: null });
    }
  });

  it('a nutricionista marcou por cima → "Esse horário já está ocupado…"; nada muda (nem cadastro)', async () => {
    const T = await consultorio();
    const p = await aguardando(T);
    await consultaDireta(app.db, T.ctx, (await novoPaciente(app.db, T.ctx)).id, em('2026-10-16', '09:30'), 30);
    const e = await erro(aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol()));
    expect((e as ConsultaError).erros).toEqual({ geral: MSG_SOLICITACOES.horarioOcupado });
    expect(await pacientesCom(T, p.email)).toEqual([]);
    expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: null });
  });

  it('local online: a consulta nasce com o link da sala (cópia do gatilho, na sessão nutri)', async () => {
    const T = await consultorio();
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: SALA });
    await semanaNoLocal(app.db, T.ctx, video, 'online');
    const p = await aguardando(T, { localId: video, modalidade: 'online' });
    await aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol());
    const [pac] = await pacientesCom(T, p.email);
    expect(await withTenant(T.ctx, (tx) => tx.select({ link: appointments.linkOnline, localId: appointments.localId }).from(appointments).where(eq(appointments.patientId, pac.id)), app.db)).toEqual([
      { link: SALA, localId: video },
    ]);
  });

  it('/code-review do PR 3 (I-2): o local online perdeu a sala (ou o local foi arquivado) enquanto o pedido esperava → "Esse horário não está mais disponível…", sem exceção crua; nada muda (nem cadastro, nem consulta)', async () => {
    const T = await consultorio();
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: SALA });
    await semanaNoLocal(app.db, T.ctx, video, 'online');
    const semSala = await aguardando(T, { localId: video, modalidade: 'online' });
    await withTenant(T.ctx, (tx) => tx.update(locaisAtendimento).set({ linkSala: null, agendamentoOnline: false }).where(eq(locaisAtendimento.id, video)), app.db);
    const centro = await novoLocal(app.db, T.ctx, { nome: 'Centro' });
    const arquivado = await aguardando(T, { inicio: em('2026-10-16', '11:00'), localId: centro });
    await withTenant(T.ctx, (tx) => tx.update(locaisAtendimento).set({ agendamentoOnline: false, arquivadoEm: agora }).where(eq(locaisAtendimento.id, centro)), app.db);
    for (const p of [semSala, arquivado]) {
      const e = await erro(aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol()));
      expect(e, String(e)).toBeInstanceOf(ConsultaError);
      expect((e as ConsultaError).erros).toEqual({ geral: MSG_SOLICITACOES.localIndisponivel });
      expect(await pacientesCom(T, p.email)).toEqual([]);
      expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: null, resolucao: null, appointmentId: null });
    }
    expect(await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.tenantId, T.tenantId)), app.db)).toEqual([]);
  });

  it('vencido (início − antecedência ≤ agora) → "já foi respondido ou venceu", sem cadastro', async () => {
    const T = await consultorio();
    const p = await aguardando(T, { inicio: em('2026-10-14', '20:00') });
    expect(await erro(aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol()))).toBeInstanceOf(PedidoMudouError);
    expect(await pacientesCom(T, p.email)).toEqual([]);
    expect(await erro(aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: 'nao-e-uuid' }, depsSol()))).toBeInstanceOf(PedidoMudouError);
  });
});

describe('revisão da T7 (M4): aceitarPedidoPublico confere a sessão', () => {
  it('fora da sessão nutri (worker, paciente) ou com o consultório de outra sessão → erro antes de qualquer gravação', async () => {
    const T = await consultorio();
    const B = await consultorio();
    const p = await aguardando(T);
    const o = { agora, appUrl: 'http://localhost:3000' };
    const ana = await novoPaciente(app.db, T.ctx);
    for (const ctx of [{ tenantId: T.tenantId, role: 'worker' as const }, ctxPaciente(T.tenantId, ana.id)] as TenantContext[]) {
      expect(String(await erro(withTenant(ctx, (tx) => aceitarPedidoPublico(tx, tenantAgenda(T), p.id, o), app.db)))).toContain('agenda: só a sessão nutri');
    }
    expect(String(await erro(withTenant(B.ctx, (tx) => aceitarPedidoPublico(tx, tenantAgenda(T), p.id, o), app.db)))).toContain('consultório diferente');
    expect(await pacientesCom(T, p.email)).toEqual([]);
    expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: null });
  });
});

describe('fila com a pessoa nova (US-409)', () => {
  it('listar e contar: "Nova pessoa" com horário, local, origem "pagina", pedido em e responda até; vencido e resolvido fora', async () => {
    const T = await consultorio();
    const p = await aguardando(T, { nome: 'Carla Dias' });
    await aguardando(T, { inicio: em('2026-10-14', '21:00') }); // vencido (antecedência de 12 h)
    const r = await aguardando(T, { inicio: em('2026-10-17', '09:00') });
    await recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: r.id }, depsSol());
    const fila = await listarSolicitacoes(T.ctx, tenantAgenda(T), depsSol());
    expect(fila).toEqual([
      { tipo: 'pessoa_nova', id: p.id, nome: 'Carla Dias', inicio: em('2026-10-16', '09:00'), fim: em('2026-10-16', '10:00'), local: 'Consultório', origem: 'pagina', pedidoEm: em('2026-10-14', '09:30'), respondaAte: em('2026-10-15', '21:00'), primeiraOnline: false },
    ]);
    expect(JSON.stringify(fila)).not.toMatch(/@ex\.com|5511/); // nem e-mail nem telefone na fila
    expect(await withTenant(T.ctx, (tx) => contarSolicitacoesNaTransacao(tx, tenantAgenda(T), agora), app.db)).toBe(1);
  });

  it('T8 (RN-404): o pedido da pessoa nova num local de videoconferência é a primeira consulta online (aviso do TCLE na fila)', async () => {
    const T = await consultorio();
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: SALA });
    await aguardando(T, { localId: video, modalidade: 'online' });
    expect(await listarSolicitacoes(T.ctx, tenantAgenda(T), depsSol())).toEqual([expect.objectContaining({ tipo: 'pessoa_nova', local: 'Videoconferência', primeiraOnline: true })]);
  });
});

describe('recusa e vencimento da pessoa nova (RN-428, AG-D23, AG-D63, AG-D75)', () => {
  it('recusa → recusado + "Seu pedido de consulta não foi confirmado" com o link da página (ligada) ou sem link (desligada); sem motivo', async () => {
    for (const ativa of [true, false]) {
      const T = await consultorio({ agendamentoPublicoAtivo: ativa });
      const p = await aguardando(T);
      await recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id, motivo: 'motivo que ninguém deve ler' }, depsSol());
      expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: agora, resolucao: 'recusado', concluidoEm: null });
      const [m] = await emailsNaFila('pedido_nao_confirmado_publico', p.email);
      expect(m).toEqual({ tipo: 'pedido_nao_confirmado_publico', para: p.email, quando: 'sex., 16/10/2026 às 09:00 (horário de Brasília)', link: ativa ? `http://localhost:3000/n/${T.slug}` : null });
      expect(JSON.stringify(m)).not.toContain('ninguém');
      expect(await pacientesCom(T, p.email)).toEqual([]);
    }
  });

  it('vencimento (com `tenantId`): vencido + o mesmo e-mail; idempotente; o de outro consultório fica', async () => {
    const T = await consultorio();
    const B = await consultorio();
    const p = await aguardando(T, { inicio: em('2026-10-16', '16:00') });
    const deB = await aguardando(B, { inicio: em('2026-10-16', '16:00') });
    expect(await vencerSolicitacoes(app.db, em('2026-10-16', '03:59'), { tenantId: T.tenantId })).toBe(0);
    expect(await vencerSolicitacoes(app.db, em('2026-10-16', '04:00'), { tenantId: T.tenantId })).toBe(1);
    expect(await vencerSolicitacoes(app.db, em('2026-10-16', '04:00'), { tenantId: T.tenantId })).toBe(0);
    expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: em('2026-10-16', '04:00'), resolucao: 'vencido' });
    expect(await emailsNaFila('pedido_nao_confirmado_publico', p.email)).toHaveLength(1);
    expect(await linhaDoPedido(B, deB.id)).toMatchObject({ resolvidoEm: null });
    // vencido não se aceita
    expect(await erro(aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: p.id }, depsSol(em('2026-10-16', '03:00'))))).toBeInstanceOf(PedidoMudouError);
  });

  it('AG-D75: recusa às 22:00 e vencimento às 03:00 (fuso de São Paulo, servidor em UTC) → o e-mail sai às 08:00 locais; às 10:00, na hora', async () => {
    const T = await consultorio();
    const r22 = await aguardando(T, { inicio: em('2026-10-17', '09:00') });
    await recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: r22.id }, depsSol(em('2026-10-14', '22:00')));
    expect((await emailsComHora('pedido_nao_confirmado_publico', r22.email)).map((x) => x.startAfter)).toEqual([em('2026-10-15', '08:00')]);
    const v03 = await aguardando(T, { inicio: em('2026-10-16', '14:00') });
    await vencerSolicitacoes(app.db, em('2026-10-16', '03:00'), { tenantId: T.tenantId });
    expect((await emailsComHora('pedido_nao_confirmado_publico', v03.email)).map((x) => x.startAfter)).toEqual([em('2026-10-16', '08:00')]);
    const r10 = await aguardando(T, { inicio: em('2026-10-18', '09:00') });
    const antes = Date.now();
    await recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: r10.id }, depsSol(em('2026-10-14', '10:00')));
    const [x] = await emailsComHora('pedido_nao_confirmado_publico', r10.email);
    expect(x.startAfter.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(x.startAfter.getTime()).toBeGreaterThan(antes - 60_000);
  });
});

describe('desistência pelo link do e-mail (AG-D42, AG-D48, AG-D49, AG-D63)', () => {
  /** A função confere o prazo pelo `now()` do banco: horário de verdade, 3 dias depois de hoje. */
  const inicioReal = em(somarDias(hojeNoFuso(SP, new Date()), 3), '09:00');

  it('GET não grava; POST grava `desistido`, avisa a nutricionista uma vez ("Nova pessoa: {primeiro nome}"); o segundo POST não avisa de novo; token inválido ou de pedido concluído → inválido', async () => {
    const T = await consultorio();
    const p = await aguardando(T, { inicio: inicioReal, nome: 'Carla Dias Souza', verificadoEm: new Date() });
    const quando = quandoComFuso(inicioReal, SP);
    const o = { ip: '198.51.100.9', db: app.db, appUrl: 'http://localhost:3000' };
    expect(await desistirDoPedidoPublico(T.slug, p.token, { ...o, confirmar: false })).toEqual({ estado: 'aguardando', quando });
    expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: null });
    expect(await desistirDoPedidoPublico(T.slug, p.token, { ...o, confirmar: true })).toEqual({ estado: 'cancelado', quando });
    expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: expect.any(Date), resolucao: 'desistido' });
    expect(await desistirDoPedidoPublico(T.slug, p.token, { ...o, confirmar: true })).toEqual({ estado: 'cancelado', quando });
    const avisos = await emailsNaFila('aviso_agenda', await emailDaNutri(T));
    expect(avisos).toEqual([{ tipo: 'aviso_agenda', para: await emailDaNutri(T), evento: 'pedido_desistido', paciente: 'Nova pessoa: Carla', quando, link: 'http://localhost:3000/painel/agenda' }]);
    // o horário volta a ficar livre: a fila não tem mais o pedido
    expect(await listarSolicitacoes(T.ctx, tenantAgenda(T), depsSol(new Date()))).toEqual([]);
    for (const token of ['curto', randomToken(), `${p.token}x`]) expect(await desistirDoPedidoPublico(T.slug, token, { ...o, confirmar: true })).toEqual({ estado: 'invalido' });
    expect(await desistirDoPedidoPublico('nao-existe-xyz', p.token, { ...o, confirmar: false })).toEqual({ estado: 'invalido' });
    // outro consultório não acha o pedido deste
    const B = await consultorio();
    expect(await desistirDoPedidoPublico(B.slug, p.token, { ...o, confirmar: false })).toEqual({ estado: 'invalido' });
    // aceito → inválido
    const q = await aguardando(T, { inicio: new Date(inicioReal.getTime() + 3 * 3_600_000), verificadoEm: new Date() });
    await aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'pessoa_nova', id: q.id }, depsSol(new Date()));
    expect(await desistirDoPedidoPublico(T.slug, q.token, { ...o, confirmar: true })).toEqual({ estado: 'invalido' });
    expect((await linhaDoPedido(T, q.id)).resolucao).toBe('aceito');
  });

  it('POST: limite por IP (o balde da página pública) → `limite`, nada gravado; o GET não gasta', async () => {
    const T = await consultorio();
    const p = await aguardando(T, { inicio: inicioReal, verificadoEm: new Date() });
    const ip = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 12; i++) await desistirDoPedidoPublico(T.slug, p.token, { ip, confirmar: false, db: app.db });
    for (let i = 0; i < 10; i++) await desistirDoPedidoPublico(T.slug, randomToken(), { ip, confirmar: true, db: app.db });
    expect(await desistirDoPedidoPublico(T.slug, p.token, { ip, confirmar: true, db: app.db })).toEqual({ estado: 'limite' });
    expect(await linhaDoPedido(T, p.id)).toMatchObject({ resolvidoEm: null });
  });

  it('revisão da T7 (M3): o GET tem um balde próprio (30 por hora e IP) — acima dele, `limite` sem chamar a função; o POST do mesmo IP segue valendo', async () => {
    const T = await consultorio();
    const p = await aguardando(T, { inicio: inicioReal, verificadoEm: new Date() });
    const ip = `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 30; i++) expect((await desistirDoPedidoPublico(T.slug, p.token, { ip, confirmar: false, db: app.db })).estado).toBe('aguardando');
    expect(await desistirDoPedidoPublico(T.slug, p.token, { ip, confirmar: false, db: app.db })).toEqual({ estado: 'limite' });
    expect((await desistirDoPedidoPublico(T.slug, p.token, { ip, confirmar: true, db: app.db, appUrl: 'http://localhost:3000' })).estado).toBe('cancelado');
  });
});
