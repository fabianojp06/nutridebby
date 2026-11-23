import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { consultorioDoChat, esperarBloqueio, naSessao, pacienteDoChat, type PacienteDoChat } from '../../../test/mensagens';
import { depsDeEnvio } from '../../../test/notificacoes';
import { emailsNaFila, novoPaciente, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { pushSubscriptions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { renderEmail } from '@/email/templates';
import { getBoss, stopBoss } from '@/jobs/boss';
import { processarNotificacoes } from '@/modules/notificacoes/enviar';
import type { ProvedorPush } from '@/modules/notificacoes/push';
import { CONTA_COTA, FORA_DA_COTA } from '@/modules/notificacoes/whatsapp/cota';
import { avisarPaciente, quandoAvisar } from './avisos';
import { minhaConversa } from './conversa';
import { enviarComoNutri, enviarComoPaciente } from './envio';
import { salvarConfiguracao } from './horario';

/**
 * Plano 25, T4 (US-445; RN-456, RN-457, RN-458; CS-440; CH-D61, CH-D62, CH-D70): os avisos de mensagem nova ao paciente
 * (push e e-mail agrupados, com o silêncio das 21h às 8h) e à nutricionista (e-mail sem nome nem texto, no máximo a cada 2 h).
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});

const SP = 'America/Sao_Paulo';
/** Instante no horário de Brasília (o fuso padrão do consultório de teste). Segunda, 23/11/2026. */
const as = (hora: string, dia = '2026-11-23') => new Date(`${dia}T${hora}:00-03:00`);
const consultorio = () => consultorioDoChat(app.db, owner.pool);

type Aviso = { canal: string; tipo: string; status: string; motivo_ignorada: string | null; agendada_para: Date };
const avisosDe = async (T: TenantDeTeste, patientId: string) =>
  (
    (await naSessao(
      app.db,
      T.ctx,
      sql`select canal, tipo, status, motivo_ignorada, agendada_para from notifications where patient_id = ${patientId} order by created_at, canal`,
    )) as Aviso[]
  ).map((a) => ({ ...a, agendada_para: new Date(a.agendada_para) }));
const avisar = (T: TenantDeTeste, patientId: string, tipo: 'chat_mensagem' | 'recado', agora: Date) =>
  withTenant(T.ctx, (tx) => avisarPaciente(tx, { tenant: { id: T.tenantId, fuso: T.tenant.fuso }, patientId, tipo, agora }), app.db);
const disparos = async (T: TenantDeTeste) => (await (await getBoss()).findJobs<{ tenantId: string }>('notificacoes')).filter((j) => j.data.tenantId === T.tenantId).length;
const emailDaNutri = (T: TenantDeTeste) => `nutri-${T.nutriId.slice(0, 8)}@teste.dev`;

/** Relógio do JS parado em `instante` durante `f` (o horário do aviso é calculado no módulo; o banco segue no relógio real). */
async function noRelogio<T>(instante: Date, f: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'], now: instante });
  try {
    return await f();
  } finally {
    vi.useRealTimers();
  }
}

describe('Plano 25 — quandoAvisar (RN-456, CH-D61), puro', () => {
  it('fora do silêncio: push agora e e-mail 30 min depois; recado sem e-mail', () => {
    expect(quandoAvisar('chat_mensagem', as('10:00'), SP)).toEqual({ push: as('10:00'), email: as('10:30') });
    expect(quandoAvisar('recado', as('10:00'), SP)).toEqual({ push: as('10:00'), email: null });
  });

  it('22h → push às 8h do dia seguinte no fuso (e o e-mail 30 min depois dele); 7h50 → push às 8h, e-mail às 8h30', () => {
    expect(quandoAvisar('chat_mensagem', as('22:00'), SP)).toEqual({ push: as('08:00', '2026-11-24'), email: as('08:30', '2026-11-24') });
    expect(quandoAvisar('chat_mensagem', as('07:50'), SP)).toEqual({ push: as('08:00'), email: as('08:30') });
    expect(quandoAvisar('recado', as('23:59'), SP)).toEqual({ push: as('08:00', '2026-11-24'), email: null });
  });

  it('mensagem às 20h45 → push às 20h45 e e-mail às 8h do dia seguinte (o e-mail também respeita o silêncio), não às 21h15', () => {
    expect(quandoAvisar('chat_mensagem', as('20:45'), SP)).toEqual({ push: as('20:45'), email: as('08:00', '2026-11-24') });
    expect(quandoAvisar('chat_mensagem', as('20:29'), SP)).toEqual({ push: as('20:29'), email: as('20:59') });
  });

  it('no fuso do consultório, não no do servidor', () => {
    // 22h em Manaus (UTC-4) = 23h em Brasília: silêncio nos dois; 20h em Manaus = 21h em Brasília: só em Brasília
    expect(quandoAvisar('recado', new Date('2026-11-23T20:00:00-04:00'), 'America/Manaus').push).toEqual(new Date('2026-11-23T20:00:00-04:00'));
    expect(quandoAvisar('recado', new Date('2026-11-23T20:00:00-04:00'), SP).push).toEqual(as('08:00', '2026-11-24'));
  });
});

describe('Plano 25 — avisarPaciente (RN-456; CH-D61)', () => {
  it('três mensagens seguidas da nutricionista → um push e um e-mail pendentes (agrupados)', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    for (const texto of ['Bom dia!', 'Vi seu diário.', 'Até amanhã.']) expect(await enviarComoNutri(T.ctx, c.p, { texto }, app.db)).toEqual({ id: expect.any(String) });
    const avisos = await avisosDe(T, c.p);
    expect(avisos.map((a) => [a.canal, a.tipo, a.status])).toEqual([
      ['email', 'chat_mensagem', 'pendente'],
      ['push', 'chat_mensagem', 'pendente'],
    ]);
  });

  it('22h → push e e-mail para a manhã seguinte, sem disparo imediato; 10h → push já, com o disparo do envio', async () => {
    const T = await consultorio();
    const noite = await pacienteDoChat(app.db, T);
    await avisar(T, noite.p, 'chat_mensagem', as('22:00'));
    expect((await avisosDe(T, noite.p)).map((a) => [a.canal, a.agendada_para])).toEqual([
      ['email', as('08:30', '2026-11-24')],
      ['push', as('08:00', '2026-11-24')],
    ]);
    expect(await disparos(T)).toBe(0);
    const dia = await pacienteDoChat(app.db, T);
    await avisar(T, dia.p, 'chat_mensagem', as('10:00'));
    expect((await avisosDe(T, dia.p)).map((a) => [a.canal, a.agendada_para])).toEqual([
      ['email', as('10:30')],
      ['push', as('10:00')],
    ]);
    expect(await disparos(T)).toBe(1);
  });

  it('mensagem às 20h45 → push às 20h45 e e-mail às 8h do dia seguinte', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await avisar(T, c.p, 'chat_mensagem', as('20:45'));
    expect((await avisosDe(T, c.p)).map((a) => [a.canal, a.agendada_para])).toEqual([
      ['email', as('08:00', '2026-11-24')],
      ['push', as('20:45')],
    ]);
  });

  it('agrupado por tipo: push de recado pendente + mensagem individual em seguida → nasce o push e o e-mail da mensagem; recado só push', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await avisar(T, c.p, 'recado', as('10:00'));
    expect((await avisosDe(T, c.p)).map((a) => [a.canal, a.tipo])).toEqual([['push', 'recado']]);
    await avisar(T, c.p, 'chat_mensagem', as('10:05'));
    await avisar(T, c.p, 'recado', as('10:06')); // o push do recado ainda está pendente: nada novo
    expect((await avisosDe(T, c.p)).map((a) => [a.canal, a.tipo])).toEqual([
      ['push', 'recado'],
      ['email', 'chat_mensagem'],
      ['push', 'chat_mensagem'],
    ]);
  });

  it('paciente sem conta → nenhuma notifications', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    await avisar(T, p.id, 'chat_mensagem', as('10:00'));
    await avisar(T, p.id, 'recado', as('10:00'));
    expect(await avisosDe(T, p.id)).toEqual([]);
  });

  it('revisão da T4, M1: o motor marcando o aviso pendente como "enviando" (sem commit) não engole o aviso da mensagem nova — o FOR UPDATE espera e reavalia', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await avisar(T, c.p, 'chat_mensagem', as('10:00'));
    const motor = await app.pool.connect();
    let fechada = false;
    try {
      // como `reservar` do motor: as devidas travadas e levadas a "enviando", ainda sem commit
      await motor.query('begin');
      await motor.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [T.tenantId]);
      await motor.query("select id from notifications where patient_id = $1 and status = 'pendente' for update skip locked", [c.p]);
      await motor.query("update notifications set status = 'enviando', tentativas = tentativas + 1 where patient_id = $1 and status = 'pendente'", [c.p]);
      const pid = (await motor.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const aviso = avisar(T, c.p, 'chat_mensagem', as('10:05')).then(
        () => 'ok',
        (e: unknown) => e,
      );
      await esperarBloqueio(owner.pool, pid);
      await motor.query('commit');
      fechada = true;
      expect(await aviso).toBe('ok');
    } finally {
      if (!fechada) await motor.query('rollback').catch(() => undefined);
      motor.release();
    }
    expect((await avisosDe(T, c.p)).map((a) => [a.canal, a.status])).toEqual([
      ['email', 'enviando'],
      ['push', 'enviando'],
      ['email', 'pendente'],
      ['push', 'pendente'],
    ]);
  });

  it('o envio da nutricionista não chama o aviso à nutricionista (o e-mail "Mensagens novas" é só do envio do paciente)', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Oi' }, app.db);
    expect(await naSessao(app.db, T.ctx, sql`select 1 from chat_avisos_nutri`)).toEqual([]);
    expect(await emailsNaFila('aviso_mensagens_nutri', emailDaNutri(T))).toEqual([]);
  });
});

describe('Plano 25 — no envio do motor (RN-456, RN-457; CH-D62; US-445)', () => {
  const pushFalso = (): ProvedorPush & { payloads: string[] } => {
    const payloads: string[] = [];
    return {
      payloads,
      async enviar(_i, payload) {
        payloads.push(payload);
        return { ok: true };
      },
    };
  };
  const comAparelho = (T: TenantDeTeste, c: PacienteDoChat) =>
    withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: c.p, endpoint: `https://push.example.test/${c.p}`, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }), app.db);
  /** Tudo vencido: o motor roda no dia seguinte (o push e o e-mail já passaram do horário, qualquer que seja a hora do teste). */
  const amanha = () => new Date(Date.now() + 36 * 3_600_000);

  it('US-445: push "Você tem uma nova mensagem." (título NutriDebby, toque em /p/mensagens do consultório) e o e-mail fixo, sem o texto', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T, { nome: 'Ana Souza Lima' });
    await comAparelho(T, c);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Seu exame de ferritina está baixo' }, app.db);
    const push = pushFalso();
    const d = depsDeEnvio(amanha(), { db: app.db, push });
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect((await avisosDe(T, c.p)).map((a) => [a.canal, a.status])).toEqual([
      ['email', 'enviada'],
      ['push', 'enviada'],
    ]);
    expect(push.payloads.map((p) => JSON.parse(p))).toEqual([{ titulo: 'NutriDebby', corpo: 'Você tem uma nova mensagem.', url: `http://localhost:3000/p/mensagens?v=${T.tenantId}` }]);
    const [e] = d.transport.enviados;
    expect(e.subject).toBe('Você tem uma nova mensagem');
    expect(e.text).toBe(`Olá, Ana! Você tem uma nova mensagem de Débora Nutricionista no app. Para ler, entre no app: http://localhost:3000/p/mensagens?v=${T.tenantId}`);
    for (const parte of [e.subject, e.text, e.html, ...push.payloads]) expect(parte).not.toMatch(/ferritina|exame/i);
  });

  it('o paciente leu tudo antes do envio → push e e-mail "ignorada" com "mensagem_lida"', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Oi' }, app.db);
    await minhaConversa(c.P, {}, app.db); // abrir a conversa marca como lida
    const d = depsDeEnvio(amanha(), { db: app.db, push: pushFalso() });
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect((await avisosDe(T, c.p)).map((a) => [a.canal, a.status, a.motivo_ignorada])).toEqual([
      ['email', 'ignorada', 'mensagem_lida'],
      ['push', 'ignorada', 'mensagem_lida'],
    ]);
    expect(d.transport.enviados).toEqual([]);
  });

  it('US-445 "Aviso agrupado não perde mensagem": leu a 1ª, chega a 2ª com o e-mail ainda pendente → nada novo nasce, e o e-mail sai', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Primeira' }, app.db);
    await minhaConversa(c.P, {}, app.db);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Segunda' }, app.db);
    expect(await avisosDe(T, c.p)).toHaveLength(2); // agrupado: o e-mail (e o push) da 1ª ainda pendentes
    const d = depsDeEnvio(amanha(), { db: app.db });
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect((await avisosDe(T, c.p)).find((a) => a.canal === 'email')).toMatchObject({ status: 'enviada' });
    expect(d.transport.enviados.map((e) => e.subject)).toEqual(['Você tem uma nova mensagem']);
  });

  it('titular bloqueado → "paciente_inativo"; sem inscrição de push → push "sem_inscricao" e o e-mail sai', async () => {
    const T = await consultorio();
    const bloqueado = await pacienteDoChat(app.db, T);
    const semAparelho = await pacienteDoChat(app.db, T);
    for (const c of [bloqueado, semAparelho]) await enviarComoNutri(T.ctx, c.p, { texto: 'Oi' }, app.db);
    await owner.pool.query("update patients set status = 'bloqueado' where id = $1", [bloqueado.p]);
    const d = depsDeEnvio(amanha(), { db: app.db, push: pushFalso() });
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect((await avisosDe(T, bloqueado.p)).map((a) => [a.canal, a.status, a.motivo_ignorada])).toEqual([
      ['email', 'ignorada', 'paciente_inativo'],
      ['push', 'ignorada', 'paciente_inativo'],
    ]);
    expect((await avisosDe(T, semAparelho.p)).map((a) => [a.canal, a.status, a.motivo_ignorada])).toEqual([
      ['email', 'enviada', null],
      ['push', 'ignorada', 'sem_inscricao'],
    ]);
  });

  it('recado → push "Você tem um novo recado.", sem e-mail', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await comAparelho(T, c);
    await owner.pool.query(
      `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, autor_nome, autor_crn, texto) values ($1, $2, 'nutri', $3, 'Débora Nutricionista', 'CRN-4 12345', 'Feriado na segunda')`,
      [T.tenantId, c.p, T.nutriId],
    );
    await avisar(T, c.p, 'recado', new Date());
    const push = pushFalso();
    const d = depsDeEnvio(amanha(), { db: app.db, push });
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect((await avisosDe(T, c.p)).map((a) => [a.canal, a.tipo, a.status])).toEqual([['push', 'recado', 'enviada']]);
    expect(push.payloads.map((p) => JSON.parse(p).corpo)).toEqual(['Você tem um novo recado.']);
    expect(d.transport.enviados).toEqual([]);
  });
});

describe('Plano 25 — aviso à nutricionista no envio do paciente (RN-458; CH-D70; US-445)', () => {
  it('no padrão (sem linha de configuração nem de aviso): o primeiro envio manda o e-mail fixo; o segundo, antes de 2 h, não', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(app.db, T, { nome: 'Ana Souza' });
    const bia = await pacienteDoChat(app.db, T, { nome: 'Beatriz Lima' });
    await noRelogio(as('11:00'), () => enviarComoPaciente(ana.P, { texto: 'Posso trocar a banana?' }, app.db));
    await noRelogio(as('11:40'), () => enviarComoPaciente(bia.P, { texto: 'Tomei o suplemento' }, app.db));
    const emails = await emailsNaFila('aviso_mensagens_nutri', emailDaNutri(T));
    expect(emails).toEqual([{ tipo: 'aviso_mensagens_nutri', para: emailDaNutri(T), link: 'http://localhost:3000/painel/mensagens?filtro=nao-lidas' }]);
    const r = renderEmail(emails[0]);
    expect(r.subject).toBe('Mensagens novas de pacientes');
    expect(r.text).toBe('Você tem mensagens novas de pacientes no NutriDebby. Para ler, entre no painel: http://localhost:3000/painel/mensagens?filtro=nao-lidas');
    for (const parte of [r.subject, r.text, r.html]) expect(parte).not.toMatch(/Ana|Beatriz|Souza|Lima|banana|suplemento/);
  });

  it('com o horário ligado (9h–18h), uma mensagem às 20h não gera e-mail; às 11h, gera', async () => {
    const T = await consultorio();
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: true, faixas: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, inicioMin: 9 * 60, fimMin: 18 * 60 })) }, app.db);
    const c = await pacienteDoChat(app.db, T);
    await noRelogio(as('20:00'), () => enviarComoPaciente(c.P, { texto: 'Oi' }, app.db));
    expect(await emailsNaFila('aviso_mensagens_nutri', emailDaNutri(T))).toHaveLength(0);
    await noRelogio(as('11:00'), () => enviarComoPaciente(c.P, { texto: 'Oi' }, app.db));
    expect(await emailsNaFila('aviso_mensagens_nutri', emailDaNutri(T))).toHaveLength(1);
  });

  it('com o horário desligado (RN-458, M7): entre 21h e 8h não envia (21h, 22h, 7h59); às 8h01 envia', async () => {
    for (const horario of [{ horarioAtivo: false, faixas: [{ diaSemana: 1, inicioMin: 0, fimMin: 1440 }] }, { horarioAtivo: true, faixas: [] }]) {
      const T = await consultorio();
      await salvarConfiguracao(T.ctx, { ...horario, avisoEmail: true }, app.db);
      const c = await pacienteDoChat(app.db, T);
      for (const h of ['21:00', '22:00']) await noRelogio(as(h), () => enviarComoPaciente(c.P, { texto: 'Oi' }, app.db));
      await noRelogio(as('07:59', '2026-11-24'), () => enviarComoPaciente(c.P, { texto: 'Oi' }, app.db));
      expect(await emailsNaFila('aviso_mensagens_nutri', emailDaNutri(T))).toHaveLength(0);
      await noRelogio(as('08:01', '2026-11-24'), () => enviarComoPaciente(c.P, { texto: 'Oi' }, app.db));
      expect(await emailsNaFila('aviso_mensagens_nutri', emailDaNutri(T))).toHaveLength(1);
    }
  });

  it('"Avisar por e-mail" desligado → nenhum e-mail, mesmo no horário', async () => {
    const T = await consultorio();
    await salvarConfiguracao(T.ctx, { horarioAtivo: false, avisoEmail: false, faixas: [] }, app.db);
    const c = await pacienteDoChat(app.db, T);
    await noRelogio(as('11:00'), () => enviarComoPaciente(c.P, { texto: 'Oi' }, app.db));
    expect(await emailsNaFila('aviso_mensagens_nutri', emailDaNutri(T))).toEqual([]);
  });

  it('app_chat_aviso_nutri_devido e avisarNutriDeMensagem: uma CHAMADA cada, só em gravarDoPaciente, a função antes do INSERT (CH-D72; a T1c prova a recusa da função fora da sessão de paciente)', () => {
    const fontes = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .map((f) => path.join('src', f))
      .filter((f) => /\.(tsx?|sql)$/.test(f) && !/\.test\./.test(f));
    /** As chamadas (não a declaração `function nome(`) em cada arquivo. */
    const chamadas = (nome: string) =>
      fontes.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(new RegExp(`(?<!function\\s+)\\b${nome}\\(`, 'g'))].map((m) => ({ f, i: m.index })));
    const devido = chamadas('app_chat_aviso_nutri_devido');
    const aviso = chamadas('avisarNutriDeMensagem');
    expect(devido.map((c) => c.f)).toEqual(['src/modules/mensagens/envio.ts']);
    expect(aviso.map((c) => c.f)).toEqual(['src/modules/mensagens/envio.ts']);
    const envio = readFileSync('src/modules/mensagens/envio.ts', 'utf8');
    const inicio = envio.indexOf('async function gravarDoPaciente');
    const fim = envio.indexOf('export async function enviarComoPaciente');
    const insert = envio.indexOf('.insert(chatMensagens)', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(inicio);
    expect(insert).toBeLessThan(fim);
    // a função roda antes do INSERT (CH-D72: ordena os envios); o e-mail sai depois dele
    expect(devido[0].i).toBeGreaterThan(inicio);
    expect(devido[0].i).toBeLessThan(insert);
    expect(aviso[0].i).toBeGreaterThan(insert);
    expect(aviso[0].i).toBeLessThan(fim);
  });
});

describe('Plano 25 — sigilo dos avisos (CS-440) e nada por WhatsApp', () => {
  it('notifications sem coluna nova (nenhuma coluna de conteúdo; o conteudo_selado é só do WhatsApp do Plano 05)', async () => {
    const r = await owner.pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'notifications' order by column_name");
    expect(r.rows.map((x) => x.column_name)).toEqual(
      [
        'agendada_para',
        'appointment_id',
        'canal',
        'conteudo_selado',
        'created_at',
        'enviada_em',
        'erro',
        'id',
        'inicio_consulta',
        'motivo_ignorada',
        'patient_id',
        'provider_jid',
        'provider_msg_id',
        'status',
        'tenant_id',
        'tentativas',
        'tipo',
        'updated_at',
      ].sort(),
    );
  });

  it('nenhum aviso do chat conta na cota de WhatsApp nem sai por ele', () => {
    for (const t of ['chat_mensagem', 'recado']) {
      expect(CONTA_COTA as readonly string[]).not.toContain(t);
      expect(FORA_DA_COTA as readonly string[]).not.toContain(t);
    }
  });
});
