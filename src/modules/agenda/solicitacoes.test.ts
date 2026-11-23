import { inspect } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { chaveDosPedidos, consultaDireta, em, novoLocal, pedidoDireto, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { depsDeEnvio } from '../../../test/notificacoes';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, notifications, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { processarNotificacoes } from '@/modules/notificacoes/enviar';
import { agendarComoPaciente, horariosParaPaciente, janelaDoPaciente } from './agendamento-paciente';
import { remarcarComoPaciente } from './cancelamento';
import { JANELA_RESPOSTA_PEDIDO_H, MSG_AGENDA, MSG_SOLICITACOES } from './constantes';
import { ConsultaError, motivoDoCancelamentoDaNutri } from './consultas';
import { partesNoFuso } from './fuso';
import { aceitarSolicitacao, contarSolicitacoesNaTransacao, desistirDoPedido, listarSolicitacoes, PedidoMudouError, recusarSolicitacao, vencerSolicitacoes } from './solicitacoes';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só lê pg_stat_activity (quem ficou preso numa trava)
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const SP = 'America/Sao_Paulo';
const agora = em('2026-10-14', '10:00');
const deps = { db: app.db, now: agora, appUrl: 'http://localhost:3000' };
const depsSol = (a: Date = agora) => ({ db: app.db, agora: a, appUrl: 'http://localhost:3000' });
const consulta = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0];
const avisos = (T: TenantDeTeste, id: string) =>
  withTenant(T.ctx, (tx) => tx.select({ tipo: notifications.tipo, canal: notifications.canal, status: notifications.status }).from(notifications).where(eq(notifications.appointmentId, id)), app.db);
const emailDaNutri = async (T: TenantDeTeste) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId)))[0].email;
const erro = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

describe('pedido pelo portal com a chave ligada (US-408, RN-421, AG-D53)', () => {
  it('nasce `solicitada` (o status vem do RETURNING), sem lembretes nem "consulta marcada", com o aviso "pedido" à nutricionista; agendarComoPaciente devolve o status', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    await chaveDosPedidos(app.db, T);
    const r = await agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T, { agendaConfirmarPedidos: true }), { inicio: em('2026-10-16', '09:00').toISOString(), localId: L }, deps);
    expect(r).toEqual({ id: expect.any(String), status: 'solicitada' });
    expect(await consulta(T, r.id)).toMatchObject({ status: 'solicitada', origem: 'paciente' });
    expect(await avisos(T, r.id)).toEqual([]);
    const [aviso] = await emailsNaFila('aviso_agenda', await emailDaNutri(T));
    expect(aviso).toMatchObject({ evento: 'pedido', paciente: 'Ana Souza', quando: 'sex., 16/10/2026 às 09:00 (horário de Brasília)', link: 'http://localhost:3000/painel/agenda/solicitacoes' });
  });

  it('chave desligada: `agendada` com lembretes e "consulta marcada" (devolve o status)', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const r = await agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), localId: L }, deps);
    expect(r).toEqual({ id: expect.any(String), status: 'agendada' });
    expect((await avisos(T, r.id)).filter((n) => n.tipo === 'consulta_marcada').map((n) => n.canal).sort()).toEqual(['email', 'push']);
  });

  it('teto de 3 futuras conta o pedido: 2 consultas + 1 pedido → "Você já tem 3 consultas marcadas…" (RN-16, §4.3)', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-20', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-21', '09:00'));
    await pedidoDireto(app.db, T, ana.id, em('2026-10-22', '09:00'));
    const e = await erro(agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T, { agendaConfirmarPedidos: true }), { inicio: em('2026-10-23', '14:00').toISOString(), localId: L }, deps));
    expect((e as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.limitePublico });
  });

  it('janela de 12 h (AG-D41): antecedência 12 h, agora 10:00 → o primeiro horário oferecido é 10:00 do dia seguinte; desligada, 08:00', async () => {
    expect(JANELA_RESPOSTA_PEDIDO_H).toBe(12);
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    expect(janelaDoPaciente({ antecedenciaMinH: 12, agendaConfirmarPedidos: true }, agora).de).toEqual(em('2026-10-15', '10:00'));
    expect(janelaDoPaciente({ antecedenciaMinH: 12, agendaConfirmarPedidos: false }, agora).de).toEqual(em('2026-10-14', '22:00'));
    const primeiro = async (ligada: boolean) => partesNoFuso((await horariosParaPaciente(tenantAgenda(T, { agendaConfirmarPedidos: ligada }), agora, { db: app.db }))[0].inicio, SP);
    expect(await primeiro(true)).toMatchObject({ data: '2026-10-15', hora: '10:00' });
    expect(await primeiro(false)).toMatchObject({ data: '2026-10-15', hora: '08:00' });
  });

  it('remarcar consulta agendada com a chave ligada → a nova nasce agendada, sem passar pela fila (AG-D24)', async () => {
    // o gatilho só liga o marcador da remarcação com a consulta ainda por começar pelo relógio do banco: datas reais
    const hoje = new Date();
    const dia = (n: number) => partesNoFuso(new Date(hoje.getTime() + n * 86_400_000), SP).data;
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const antiga = await consultaDireta(app.db, T.ctx, ana.id, em(dia(10), '09:00'), 60, { origem: 'paciente', localId: L });
    await chaveDosPedidos(app.db, T);
    const r = await remarcarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T, { agendaConfirmarPedidos: true }), antiga, { inicio: em(dia(11), '14:00').toISOString(), localId: L }, { ...deps, now: hoje });
    expect(await consulta(T, r.id)).toMatchObject({ status: 'agendada', remarcadaDe: antiga });
    expect(await consulta(T, antiga)).toMatchObject({ status: 'cancelada', canceladoPor: 'paciente' });
  });
});

describe('fila, aceite e recusa (US-409, RN-427a, RN-428, AG-D23)', () => {
  it('a fila: o pedido com nome, local, origem "App", pedido em e responda até (início − antecedência); vencido fora; só a sessão nutri', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online' });
    const id = await pedidoDireto(app.db, T, ana.id, em('2026-10-16', '16:00'), 60, { localId: video, modalidade: 'online', createdAt: em('2026-10-13', '18:00') });
    await pedidoDireto(app.db, T, ana.id, em('2026-10-14', '20:00')); // vence às 08:00 de hoje: fora da fila (leitura preguiçosa)
    const fila = await listarSolicitacoes(T.ctx, tenantAgenda(T, { agendaConfirmarPedidos: true }), depsSol());
    expect(fila).toEqual([
      { tipo: 'consulta', id, patientId: ana.id, nome: 'Ana Souza', inicio: em('2026-10-16', '16:00'), fim: em('2026-10-16', '17:00'), local: 'Videoconferência', origem: 'app', pedidoEm: em('2026-10-13', '18:00'), respondaAte: em('2026-10-16', '04:00'), primeiraOnline: true },
    ]);
    expect(await withTenant(T.ctx, (tx) => contarSolicitacoesNaTransacao(tx, { antecedenciaMinH: 12 }, agora), app.db)).toBe(1);
    await expect(listarSolicitacoes(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), depsSol())).rejects.toThrow('agenda: só a sessão nutri');
    // com uma consulta realizada antes, o pedido online é "Retorno": sem o aviso de primeira consulta
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-09-10', '09:00'), 60, { status: 'realizada' });
    expect((await listarSolicitacoes(T.ctx, tenantAgenda(T), depsSol()))[0]).toMatchObject({ primeiraOnline: false });
  });

  it('aceitar → agendada, lembretes, "consulta marcada" e envio já; só a sessão nutri', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await pedidoDireto(app.db, T, ana.id, em('2026-10-20', '09:00'));
    await expect(aceitarSolicitacao(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { tipo: 'consulta', id }, depsSol())).rejects.toThrow('agenda: só a sessão nutri');
    await aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id }, depsSol());
    expect(await consulta(T, id)).toMatchObject({ status: 'agendada', canceladoPor: null });
    const ns = await avisos(T, id);
    expect(ns.filter((n) => n.tipo === 'lembrete_24h')).toHaveLength(3);
    expect(ns.filter((n) => n.tipo === 'consulta_marcada').map((n) => n.canal).sort()).toEqual(['email', 'push']);
    expect(ns.filter((n) => n.tipo === 'pedido_nao_confirmado')).toEqual([]);
  });

  it('recusar → pedido_recusado + "não confirmado" por e-mail e push (nada de WhatsApp); o motivo só a nutricionista vê, nunca no e-mail', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await pedidoDireto(app.db, T, ana.id, em('2026-10-20', '09:00'));
    const motivo = 'Agenda cheia por suspeita de diabetes';
    await expect(recusarSolicitacao(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { tipo: 'consulta', id, motivo }, depsSol())).rejects.toThrow('agenda: só a sessão nutri');
    expect((await erro(recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id, motivo: 'x'.repeat(301) }, depsSol())) as ConsultaError).erros).toEqual({ motivo: MSG_AGENDA.motivoCancelamentoLongo });
    await recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id, motivo }, depsSol());
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'pedido_recusado', canceladaEm: agora, motivoCancelamento: motivo });
    expect(await motivoDoCancelamentoDaNutri(T.ctx, id, app.db)).toBe(motivo);
    expect((await avisos(T, id)).map((n) => [n.tipo, n.canal]).sort()).toEqual([['pedido_nao_confirmado', 'email'], ['pedido_nao_confirmado', 'push']]);
    const d = depsDeEnvio(agora, { db: app.db });
    await processarNotificacoes(d, { tenantId: T.tenantId });
    const [e] = d.transport.enviados;
    expect(e.subject).toBe('Seu pedido de consulta não foi confirmado');
    expect(e.text).toContain('O horário de ter., 20/10/2026 às 09:00 (horário de Brasília) não foi confirmado.');
    expect(e.text).toContain(`Escolha outro horário: http://localhost:3000/p/agenda/nova?v=${T.tenantId}`);
    expect(`${e.subject}${e.text}${e.html}`).not.toContain('diabetes');
    expect((await avisos(T, id)).filter((n) => n.canal === 'email')).toEqual([{ tipo: 'pedido_nao_confirmado', canal: 'email', status: 'enviada' }]);
  });

  it('aceitar ou recusar pedido vencido ou já respondido → "Este pedido já foi respondido ou venceu."', async () => {
    expect(new PedidoMudouError().message).toBe('Este pedido já foi respondido ou venceu.');
    expect(MSG_SOLICITACOES.mudou).toBe('Este pedido já foi respondido ou venceu.');
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const vencido = await pedidoDireto(app.db, T, ana.id, em('2026-10-14', '20:00')); // venceu às 08:00
    for (const f of [aceitarSolicitacao, recusarSolicitacao]) await expect(f(T.ctx, tenantAgenda(T), { tipo: 'consulta', id: vencido }, depsSol())).rejects.toBeInstanceOf(PedidoMudouError);
    const id = await pedidoDireto(app.db, T, ana.id, em('2026-10-20', '09:00'));
    await aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id }, depsSol());
    for (const f of [aceitarSolicitacao, recusarSolicitacao]) await expect(f(T.ctx, tenantAgenda(T), { tipo: 'consulta', id }, depsSol())).rejects.toBeInstanceOf(PedidoMudouError);
    await expect(aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id: 'nao-e-uuid' }, depsSol())).rejects.toBeInstanceOf(PedidoMudouError);
    const outro = await novoTenant(app.db);
    await expect(aceitarSolicitacao(outro.ctx, tenantAgenda(outro), { tipo: 'consulta', id: vencido }, depsSol())).rejects.toBeInstanceOf(PedidoMudouError);
    expect(await consulta(T, vencido)).toMatchObject({ status: 'solicitada' });
  });

  it('duas abas aceitando o mesmo pedido → uma aceita, a outra "Este pedido já foi respondido ou venceu."', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await pedidoDireto(app.db, T, ana.id, em('2026-10-20', '09:00'));
    const r = await Promise.allSettled([1, 2].map(() => aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id }, depsSol())));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(PedidoMudouError);
    expect((await avisos(T, id)).filter((n) => n.tipo === 'consulta_marcada')).toHaveLength(2); // e-mail e push, uma vez
  });
});

describe('desistência do paciente (AG-D42, AG-D44, AG-D70)', () => {
  it('desistir → pedido_desistido + aviso "Pedido de consulta retirado" à nutricionista (primeiro nome); de novo → PedidoMudouError; só a sessão do paciente', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza Lima' });
    const id = await pedidoDireto(app.db, T, ana.id, em('2026-10-20', '09:00'));
    await expect(desistirDoPedido(T.ctx, tenantAgenda(T), id, depsSol())).rejects.toThrow(/sessão de paciente/);
    await desistirDoPedido(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), id, depsSol());
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'pedido_desistido', canceladaEm: agora });
    const [aviso] = await emailsNaFila('aviso_agenda', await emailDaNutri(T));
    expect(aviso).toMatchObject({ evento: 'pedido_desistido', paciente: 'Ana', quando: 'ter., 20/10/2026 às 09:00 (horário de Brasília)', link: `http://localhost:3000/painel/agenda/consultas/${id}` });
    expect(await avisos(T, id)).toEqual([]); // nada ao paciente
    await expect(desistirDoPedido(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), id, depsSol())).rejects.toBeInstanceOf(PedidoMudouError);
    // consulta já aceita: não é pedido (o cancelamento é cancelarConsulta)
    const aceita = await pedidoDireto(app.db, T, ana.id, em('2026-10-21', '09:00'));
    await aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id: aceita }, depsSol());
    await expect(desistirDoPedido(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), aceita, depsSol())).rejects.toBeInstanceOf(PedidoMudouError);
    // pedido de outro paciente: a RLS esconde
    const bia = await novoPaciente(app.db, T.ctx);
    const daBia = await pedidoDireto(app.db, T, bia.id, em('2026-10-22', '09:00'));
    await expect(desistirDoPedido(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), daBia, depsSol())).rejects.toBeInstanceOf(PedidoMudouError);
    expect(await consulta(T, daBia)).toMatchObject({ status: 'solicitada' });
  });
});

describe('vencimento (RN-427, RN-427a, AG-D67)', () => {
  // O gatilho confere o prazo do pedido_vencido pelo relógio do banco (now()): os pedidos destes testes estão no passado real.
  it('o pedido das 16:00 com antecedência de 12 h vence às 04:00 (03:59 não): cancelada/pedido_vencido + "não confirmado"; idempotente', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await pedidoDireto(app.db, T, ana.id, em('2026-10-16', '16:00'));
    expect(await vencerSolicitacoes(app.db, em('2026-10-16', '03:59'), { tenantId: T.tenantId })).toBe(0);
    expect(await consulta(T, id)).toMatchObject({ status: 'solicitada' });
    expect(await vencerSolicitacoes(app.db, em('2026-10-16', '04:00'), { tenantId: T.tenantId })).toBe(1);
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'pedido_vencido', canceladaEm: em('2026-10-16', '04:00') });
    expect((await avisos(T, id)).map((n) => [n.tipo, n.canal]).sort()).toEqual([['pedido_nao_confirmado', 'email'], ['pedido_nao_confirmado', 'push']]);
    expect(await vencerSolicitacoes(app.db, em('2026-10-16', '04:01'), { tenantId: T.tenantId })).toBe(0);
    expect(await avisos(T, id)).toHaveLength(2);
  });

  it('com `tenantId`, só aquele consultório: um job avulso de A não vence o pedido de B', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const a = await pedidoDireto(app.db, A, (await novoPaciente(app.db, A.ctx)).id, em('2026-10-16', '16:00'));
    const b = await pedidoDireto(app.db, B, (await novoPaciente(app.db, B.ctx)).id, em('2026-10-16', '16:00'));
    expect(await vencerSolicitacoes(app.db, em('2026-10-17', '00:00'), { tenantId: A.tenantId })).toBe(1);
    expect((await consulta(A, a)).status).toBe('cancelada');
    expect((await consulta(B, b)).status).toBe('solicitada');
  });

  it('um pedido que falha não para os outros: o erro é registrado só com o código (regra 3) e a varredura segue', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const vencido = await pedidoDireto(app.db, T, ana.id, em('2026-10-16', '16:00'));
    // no prazo pelo relógio do banco, vencido pelo `agora` do job: o gatilho recusa (42501)
    const futuro = new Date(Date.now() + 3 * 86_400_000);
    const noPrazo = await pedidoDireto(app.db, T, ana.id, new Date(futuro.getTime() + 6 * 3_600_000));
    const aviso = vi.spyOn(logger, 'warn');
    try {
      expect(await vencerSolicitacoes(app.db, futuro, { tenantId: T.tenantId })).toBe(1);
      expect((await consulta(T, vencido)).status).toBe('cancelada');
      expect((await consulta(T, noPrazo)).status).toBe('solicitada');
      const chamadas = aviso.mock.calls.filter((c) => c[1] === 'falha ao vencer pedido de consulta');
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0][0]).toEqual({ tenantId: T.tenantId, consultaId: noPrazo, err: expect.any(String), sqlstate: '42501' });
      expect(inspect(aviso.mock.calls)).not.toContain('Ana');
    } finally {
      aviso.mockRestore();
    }
  });

  it('corrida aceite × vencimento: só um vence — o aceite ganha (e o vencimento pula) ou o vencimento ganha (e o aceite recebe PedidoMudouError)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await pedidoDireto(app.db, T, ana.id, em('2026-10-16', '16:00'));
    const [aceite, venc] = await Promise.allSettled([
      aceitarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id }, depsSol(em('2026-10-16', '03:00'))),
      vencerSolicitacoes(app.db, em('2026-10-16', '04:00'), { tenantId: T.tenantId }),
    ]);
    expect(venc.status).toBe('fulfilled');
    const vencidos = (venc as PromiseFulfilledResult<number>).value;
    const c = await consulta(T, id);
    if (aceite.status === 'fulfilled') expect([vencidos, c.status]).toEqual([0, 'agendada']);
    else expect([(aceite.reason as Error).name, vencidos, c.status]).toEqual(['PedidoMudouError', 1, 'cancelada']);
  });
});

describe('ordem global de travas (AG-D65): o portal toma a trava do tenant antes da do paciente', () => {
  it('quem segura a trava do tenant e grava para o mesmo paciente (o aceite da pessoa nova) não entra em ciclo com o portal: um fica, sem 40P01', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const inicio = em('2026-10-16', '15:00');
    // a outra transação: trava do tenant → consulta do mesmo paciente no mesmo horário (FK: KEY SHARE no paciente), como aceitarPedidoPublico
    const outra = await app.pool.connect();
    try {
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      await outra.query(`select pg_advisory_xact_lock(hashtext('agenda-pedidos-tenant'), hashtext($1))`, [T.tenantId]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const portal = agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: inicio.toISOString(), localId: L }, deps).then(
        () => null,
        (e: unknown) => e,
      );
      for (let i = 0; ; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 500) throw new Error('o portal não esperou a trava do tenant');
        await new Promise((r) => setTimeout(r, 10));
      }
      // o portal está preso na trava do tenant, sem ter travado o paciente: a outra grava e confirma
      await outra.query(`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values ($1, $2, $3, $4, 'presencial', 'nutri')`, [T.tenantId, ana.id, inicio, new Date(inicio.getTime() + 3_600_000)]);
      await outra.query('commit');
      const e = await portal;
      expect(e, inspect(e)).toBeInstanceOf(ConsultaError);
      expect((e as ConsultaError).erros).toEqual({ inicio: MSG_AGENDA.ocupado });
    } finally {
      await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    const doHorario = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(and(eq(appointments.patientId, ana.id), inArray(appointments.status, ['agendada', 'solicitada']))), app.db);
    expect(doHorario).toHaveLength(1);
  });
});

describe('desligar a chave com pedidos pendentes (US-407, RN-420)', () => {
  it('os pendentes continuam na fila; os novos voltam a nascer agendada', async () => {
    const T = await novoTenant(app.db);
    const L = await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    await pedidoDireto(app.db, T, ana.id, em('2026-10-20', '09:00'));
    await pedidoDireto(app.db, T, ana.id, em('2026-10-21', '09:00'));
    await chaveDosPedidos(app.db, T, false);
    expect(await listarSolicitacoes(T.ctx, tenantAgenda(T), depsSol())).toHaveLength(2);
    const r = await agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: em('2026-10-22', '09:00').toISOString(), localId: L }, deps);
    expect(r.status).toBe('agendada');
  });
});
