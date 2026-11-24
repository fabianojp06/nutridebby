import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { em, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { caminhoAte, grafoDeImports } from '../../../test/grafo-de-imports';
import { depsDeEnvio } from '../../../test/notificacoes';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { aniversarioAutorizacoes, auditLog, notifications, patientCadastro, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { processarNotificacoes } from '@/modules/notificacoes/enviar';
import { assinarLinkDeSaida } from './aniversario-link';
import {
  AniversarioError,
  contarAniversariantesDeHojeNaTransacao,
  aniversariantesDoMes,
  aniversarioNoApp,
  autorizarPeloApp,
  elegivel,
  enviarMensagensDeAniversario,
  estadoDoLinkDeSaida,
  LIMITE_SAIDA_POR_HORA,
  registrarAutorizacao,
  retirarAutorizacao,
  retirarPeloLink,
} from './aniversarios';

/**
 * Plano 23 (US-412 a US-414, RN-431 a RN-435, CS-404): aniversariantes do mês, envio por e-mail (uma por ano), autorização
 * pelos três canais e a saída pelo link do e-mail. O relógio do app vem de `agora`; o `registrado_em` é do relógio do banco
 * (gatilho) e, quando o teste precisa de uma data, o dono do banco a reescreve (o app não altera a tabela).
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const agora = em('2026-11-10', '15:00'); // terça, 15h em São Paulo
const deps = (a: Date = agora) => ({ db: app.db, agora: a });
const tenant = (T: TenantDeTeste) => tenantAgenda(T);
const erro = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** Autorização da nutricionista gravada direto, com o `registrado_em` reescrito pelo dono (o gatilho grava o relógio do banco). */
async function autorizado(T: TenantDeTeste, patientId: string, registradoEm = '2026-11-01T12:00:00Z') {
  const [a] = await withTenant(
    T.ctx,
    (tx) => tx.insert(aniversarioAutorizacoes).values({ tenantId: T.tenantId, patientId, evento: 'autorizou', origem: 'nutri', forma: 'escrito', registradoPor: T.nutriId }).returning({ id: aniversarioAutorizacoes.id }),
    app.db,
  );
  await owner.db.execute(sql`update aniversario_autorizacoes set registrado_em = ${registradoEm}::timestamptz where id = ${a.id}`);
}
const eventos = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(aniversarioAutorizacoes).where(eq(aniversarioAutorizacoes.patientId, patientId)).orderBy(asc(aniversarioAutorizacoes.registradoEm)), app.db);
const mensagens = (T: TenantDeTeste) =>
  withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'aniversario')).orderBy(asc(notifications.agendadaPara)), app.db);
const situacoes = (r: Awaited<ReturnType<typeof aniversariantesDoMes>>) => Object.fromEntries(r.lista.map((a) => [a.nome, a.situacao]));
/** Arquiva, bloqueia ou anonimiza pelo caminho do app (a equipe arquiva e bloqueia; só o worker anonimiza). */
const mudarPaciente = (T: TenantDeTeste, id: string, s: { status: 'arquivado' | 'bloqueado'; anonimizado?: boolean }) =>
  withTenant(
    s.anonimizado ? { tenantId: T.tenantId, role: 'worker' } : T.ctx,
    (tx) =>
      tx
        .update(patients)
        .set({ status: s.status, ...(s.status === 'bloqueado' ? { anonimizarApos: '2026-09-30' } : {}), ...(s.anonimizado ? { anonimizadoEm: new Date() } : {}) })
        .where(eq(patients.id, id)),
    app.db,
  );

/** O consultório do mês de novembro de 2026: as seis situações e os que não entram na lista. */
async function novembro() {
  const T = await novoTenant(app.db);
  const p = async (nome: string, dataNascimento: string | null, extra: Record<string, unknown> = {}) => novoPaciente(app.db, T.ctx, { nome, dataNascimento, ...(dataNascimento ? {} : { sexo: null, origem: 'agendamento_publico' }), ...extra });
  const ana = await p('Ana Souza', '1990-11-20', { telefoneE164: '+5511912345678' });
  const bia = await p('Bia Lima', '1985-11-25');
  const caio = await p('Caio Menor', '2010-11-15');
  const duda = await p('Duda Passou', '1990-11-05');
  const eva = await p('Eva Hoje', '1990-11-10');
  const fabi = await p('Fabi Enviada', '1990-11-12');
  const outubro = await p('Gil Outubro', '1990-10-20');
  const semData = await p('Hugo Sem Data', null);
  const arquivado = await p('Iara Arquivada', '1990-11-21');
  const bloqueado = await p('João Bloqueado', '1990-11-22');
  const anonimizado = await p('Kim Anonimizado', '1990-11-23');
  for (const x of [ana, caio, duda, eva, fabi, arquivado, bloqueado, anonimizado]) await autorizado(T, x.id);
  await mudarPaciente(T, arquivado.id, { status: 'arquivado' });
  await mudarPaciente(T, bloqueado.id, { status: 'bloqueado' });
  await mudarPaciente(T, anonimizado.id, { status: 'bloqueado', anonimizado: true });
  // a mensagem deste ano da Fabi já existe (agendada antes)
  await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: fabi.id, tipo: 'aniversario', canal: 'email', status: 'pendente', agendadaPara: em('2026-11-12', '09:00') }), app.db);
  return { T, ana, bia, caio, duda, eva, fabi, outubro, semData, arquivado, bloqueado, anonimizado };
}

describe('aniversariantes do mês (US-412, RN-431)', () => {
  it('as seis situações; só ativos, não anonimizados, com data de nascimento e aniversário no mês; ordem do dia', async () => {
    const { T } = await novembro();
    const r = await aniversariantesDoMes(T.ctx, tenant(T), '2026-11', deps());
    expect(r.mes).toBe('2026-11');
    expect(r.corrente).toBe(true);
    expect(r.lista.map((a) => [a.nome, a.dia, a.faz, a.situacao])).toEqual([
      ['Duda Passou', '2026-11-05', 36, 'ja_passou'],
      ['Eva Hoje', '2026-11-10', 36, 'pode_receber'],
      ['Fabi Enviada', '2026-11-12', 36, 'ja_enviada'],
      ['Caio Menor', '2026-11-15', 16, 'menor'],
      ['Ana Souza', '2026-11-20', 36, 'pode_receber'],
      ['Bia Lima', '2026-11-25', 41, 'sem_autorizacao'],
    ]);
    const ana = r.lista.find((a) => a.nome === 'Ana Souza')!;
    expect(ana).toMatchObject({ autorizadoEm: '2026-11-01T12:00:00.000Z', telefone: true, podeRetirar: true, menorHoje: false, whatsapp: { telefone: '+5511912345678', nome: 'Ana Souza' } });
    // sem telefone ou sem autorização: sem "Abrir no WhatsApp" (RN-435)
    expect(r.lista.find((a) => a.nome === 'Eva Hoje')).toMatchObject({ telefone: false, whatsapp: null });
    expect(r.lista.find((a) => a.nome === 'Bia Lima')).toMatchObject({ autorizadoEm: null, podeRetirar: false, whatsapp: null });
    expect(r.lista.find((a) => a.nome === 'Caio Menor')).toMatchObject({ menorHoje: true });
  });

  it('AG-D35: o nome da saudação do WhatsApp é o social, quando há (a lista mostra o de registro, C-408)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Maria Souza', dataNascimento: '1990-11-20', telefoneE164: '+5511912345678' });
    await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: p.id, nomeSocial: 'Bia Souza' }), app.db);
    await autorizado(T, p.id);
    const [a] = (await aniversariantesDoMes(T.ctx, tenant(T), '2026-11', deps())).lista;
    expect(a).toMatchObject({ nome: 'Ana Maria Souza', whatsapp: { telefone: '+5511912345678', nome: 'Bia Souza' } });
  });

  it('relógio às 22h: o aniversariante de hoje fica "Passou do horário de hoje"', async () => {
    const { T } = await novembro();
    const r = await aniversariantesDoMes(T.ctx, tenant(T), '2026-11', deps(em('2026-11-10', '22:00')));
    expect(situacoes(r)['Eva Hoje']).toBe('passou_do_horario');
    expect(situacoes(r)['Ana Souza']).toBe('pode_receber');
  });

  it('29/02 aparece em 28/02 no ano não bissexto; no bissexto, em 29/02', async () => {
    const T = await novoTenant(app.db);
    await novoPaciente(app.db, T.ctx, { nome: 'Leo Bissexto', dataNascimento: '2000-02-29' });
    expect((await aniversariantesDoMes(T.ctx, tenant(T), '2027-02', deps())).lista.map((a) => [a.dia, a.faz])).toEqual([['2027-02-28', 27]]);
    expect((await aniversariantesDoMes(T.ctx, tenant(T), '2028-02', deps())).lista.map((a) => [a.dia, a.faz])).toEqual([['2028-02-29', 28]]);
    // elegível em 28/02 de 2027 (puro)
    expect(elegivel({ status: 'ativo', anonimizadoEm: null, dataNascimento: '2000-02-29' }, { evento: 'autorizou', registradoEm: new Date('2026-01-01T12:00:00Z') }, '2027-02-28', '2027-02-28', { hora: 10, fuso: 'America/Sao_Paulo' })).toBe('pode_receber');
  });

  it('mês seguinte só consulta (corrente: false) e não envia; mês inválido vira o corrente; o mês corrente vem do fuso (virada às 21h de UTC)', async () => {
    const T = await novoTenant(app.db);
    const dez = await novoPaciente(app.db, T.ctx, { nome: 'Davi Dezembro', dataNascimento: '1990-12-02' });
    await autorizado(T, dez.id);
    const r = await aniversariantesDoMes(T.ctx, tenant(T), '2026-12', deps());
    expect(r).toMatchObject({ mes: '2026-12', corrente: false });
    expect(r.lista.map((a) => a.situacao)).toEqual(['pode_receber']);
    expect(await enviarMensagensDeAniversario(T.ctx, tenant(T), [dez.id], deps())).toEqual({ agendadas: 0, agora: 0 });
    for (const mes of ['2026-13', 'x', '', undefined, '2026-1']) expect((await aniversariantesDoMes(T.ctx, tenant(T), mes as string, deps())).mes).toBe('2026-11');
    // 30/11 às 22h em São Paulo já é 01/12 em UTC: o mês corrente continua novembro
    expect((await aniversariantesDoMes(T.ctx, tenant(T), undefined as never, deps(em('2026-11-30', '22:00')))).mes).toBe('2026-11');
  });

  it('a lista não grava "Visualizou" (sem auditRead, US-412)', async () => {
    const { T } = await novembro();
    const antes = await withTenant(T.ctx, (tx) => tx.select({ id: auditLog.id }).from(auditLog), app.db);
    await aniversariantesDoMes(T.ctx, tenant(T), '2026-11', deps());
    expect(await withTenant(T.ctx, (tx) => tx.select({ id: auditLog.id }).from(auditLog), app.db)).toHaveLength(antes.length);
  });

  it('só a sessão nutri (RN-400)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await erro(aniversariantesDoMes(ctxPaciente(T.tenantId, p.id), tenant(T), '2026-11', deps()))).toMatchObject({ message: 'agenda: só a sessão nutri' });
    expect(await erro(enviarMensagensDeAniversario(ctxPaciente(T.tenantId, p.id), tenant(T), [p.id], deps()))).toMatchObject({ message: 'agenda: só a sessão nutri' });
  });

  it('Início: os aniversariantes de hoje (ativos, com data), sem olhar a autorização', async () => {
    const { T } = await novembro();
    await novoPaciente(app.db, T.ctx, { nome: 'Lia Hoje Sem Autorização', dataNascimento: '2001-11-10' });
    expect(await withTenant(T.ctx, (tx) => contarAniversariantesDeHojeNaTransacao(tx, 'America/Sao_Paulo', agora), app.db)).toBe(2);
  });
});

describe('envio da mensagem de aniversário (US-413, RN-432, CS-404)', () => {
  it('"Selecionar todos" mandado inteiro: só os "Pode receber" de hoje ao fim do mês; às 15h o de hoje sai agora, os outros às 9h do dia', async () => {
    const m = await novembro();
    const todos = [m.ana, m.bia, m.caio, m.duda, m.eva, m.fabi, m.outubro, m.semData, m.arquivado, m.bloqueado, m.anonimizado].map((p) => p.id);
    expect(await enviarMensagensDeAniversario(m.T.ctx, tenant(m.T), [...todos, 'nao-e-uuid', m.ana.id], deps())).toEqual({ agendadas: 2, agora: 1 });
    const ms = await mensagens(m.T);
    expect(ms.map((n) => [n.patientId, n.canal, n.status, n.agendadaPara.toISOString(), n.appointmentId])).toEqual([
      [m.eva.id, 'email', 'pendente', agora.toISOString(), null],
      [m.fabi.id, 'email', 'pendente', em('2026-11-12', '09:00').toISOString(), null],
      [m.ana.id, 'email', 'pendente', em('2026-11-20', '09:00').toISOString(), null],
    ]);
  });

  it('às 22h o de hoje não sai ("Passou do horário de hoje"); antes das 9h, o de hoje fica para as 9h', async () => {
    const m = await novembro();
    expect(await enviarMensagensDeAniversario(m.T.ctx, tenant(m.T), [m.eva.id], deps(em('2026-11-10', '22:00')))).toEqual({ agendadas: 0, agora: 0 });
    expect(await enviarMensagensDeAniversario(m.T.ctx, tenant(m.T), [m.eva.id], deps(em('2026-11-10', '07:30')))).toEqual({ agendadas: 1, agora: 0 });
    expect((await mensagens(m.T)).find((n) => n.patientId === m.eva.id)?.agendadaPara.toISOString()).toBe(em('2026-11-10', '09:00').toISOString());
  });

  it('CS-404: autorização registrada antes dos 18 não conta — "Sem autorização" e nada agendado', async () => {
    const T = await novoTenant(app.db);
    const leo = await novoPaciente(app.db, T.ctx, { nome: 'Leo Fez 18', dataNascimento: '2008-11-30' });
    await autorizado(T, leo.id, '2026-11-01T12:00:00Z'); // tinha 17
    const r = await aniversariantesDoMes(T.ctx, tenant(T), '2026-11', deps());
    expect(r.lista.map((a) => [a.faz, a.situacao, a.autorizadoEm, a.podeRetirar, a.menorHoje])).toEqual([[18, 'sem_autorizacao', null, true, true]]);
    expect(await enviarMensagensDeAniversario(T.ctx, tenant(T), [leo.id], deps())).toEqual({ agendadas: 0, agora: 0 });
    // controle: registrada no dia em que fez 18, conta
    await autorizado(T, leo.id, '2026-11-30T12:00:00Z');
    expect(elegivel({ status: 'ativo', anonimizadoEm: null, dataNascimento: '2008-11-30' }, { evento: 'autorizou', registradoEm: new Date('2026-11-30T12:00:00Z') }, '2026-11-30', '2026-11-30', { hora: 10, fuso: 'America/Sao_Paulo' })).toBe('pode_receber');
  });

  it('bloqueado, arquivado, anonimizado e menor nunca recebem (todos com autorização)', async () => {
    const m = await novembro();
    expect(await enviarMensagensDeAniversario(m.T.ctx, tenant(m.T), [m.arquivado.id, m.bloqueado.id, m.anonimizado.id, m.caio.id], deps())).toEqual({ agendadas: 0, agora: 0 });
    expect((await mensagens(m.T)).map((n) => n.patientId)).toEqual([m.fabi.id]);
  });

  it('uma por ano: o segundo envio devolve 0 — também com a primeira ignorada — e retirar e reautorizar não reenvia', async () => {
    const m = await novembro();
    expect(await enviarMensagensDeAniversario(m.T.ctx, tenant(m.T), [m.ana.id], deps())).toEqual({ agendadas: 1, agora: 0 });
    expect(await enviarMensagensDeAniversario(m.T.ctx, tenant(m.T), [m.ana.id], deps())).toEqual({ agendadas: 0, agora: 0 });
    await withTenant({ tenantId: m.T.tenantId, role: 'worker' }, (tx) => tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'sem_autorizacao' }).where(and(eq(notifications.patientId, m.ana.id), eq(notifications.tipo, 'aniversario'))), app.db);
    await retirarAutorizacao(m.T.ctx, m.ana.id, deps());
    await registrarAutorizacao(m.T.ctx, m.ana.id, 'mensagem', deps());
    expect(await enviarMensagensDeAniversario(m.T.ctx, tenant(m.T), [m.ana.id], deps())).toEqual({ agendadas: 0, agora: 0 });
    expect((await mensagens(m.T)).filter((n) => n.patientId === m.ana.id)).toHaveLength(1);
    expect(situacoes(await aniversariantesDoMes(m.T.ctx, tenant(m.T), '2026-11', deps()))['Ana Souza']).toBe('ja_enviada');
  });

  it('autorização retirada depois do agendamento: às 9h a mensagem é ignorada (sem_autorizacao); a de quem continua autorizado sai', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', dataNascimento: '1990-11-20' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima', dataNascimento: '1991-11-20' });
    for (const p of [ana, bia]) await autorizado(T, p.id);
    expect(await enviarMensagensDeAniversario(T.ctx, tenant(T), [ana.id, bia.id], deps())).toEqual({ agendadas: 2, agora: 0 });
    await retirarAutorizacao(T.ctx, ana.id, deps());
    const d = depsDeEnvio(em('2026-11-20', '09:00'), { db: app.db });
    await processarNotificacoes(d, { tenantId: T.tenantId });
    const ms = await mensagens(T);
    expect(ms.find((n) => n.patientId === ana.id)).toMatchObject({ status: 'ignorada', motivoIgnorada: 'sem_autorizacao' });
    expect(ms.find((n) => n.patientId === bia.id)).toMatchObject({ status: 'enviada' });
    expect(d.transport.enviados.map((e) => e.subject)).toEqual(['Uma mensagem da sua nutricionista']);
  });
});

describe('autorização (US-414, RN-433, AG-D61)', () => {
  it('pela nutricionista: com a forma, em nome da própria usuária; sem forma (ou forma inválida) → recusado, nada gravado; menor → "Menor de idade"', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-20' });
    for (const forma of [undefined, '', 'telefone', null]) {
      expect(await erro(registrarAutorizacao(T.ctx, ana.id, forma as never, deps()))).toBeInstanceOf(AniversarioError);
    }
    expect(await eventos(T, ana.id)).toEqual([]);
    await registrarAutorizacao(T.ctx, ana.id, 'verbal', deps());
    expect((await eventos(T, ana.id)).map((e) => [e.evento, e.origem, e.forma, e.registradoPor])).toEqual([['autorizou', 'nutri', 'verbal', T.nutriId]]);
    // já autorizado: nada novo (cada mudança é uma linha; repetir não é mudança)
    await registrarAutorizacao(T.ctx, ana.id, 'escrito', deps());
    expect(await eventos(T, ana.id)).toHaveLength(1);
    const caio = await novoPaciente(app.db, T.ctx, { dataNascimento: '2010-11-15' });
    expect(await erro(registrarAutorizacao(T.ctx, caio.id, 'escrito', deps()))).toMatchObject({ name: 'AniversarioError', message: 'Menor de idade' });
    expect(await eventos(T, caio.id)).toEqual([]);
  });

  it('a nutricionista retira sem a forma (AG-D61); sem autorização vigente, retirar não cria linha', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-20' });
    await retirarAutorizacao(T.ctx, ana.id, deps());
    expect(await eventos(T, ana.id)).toEqual([]);
    await registrarAutorizacao(T.ctx, ana.id, 'escrito', deps());
    await retirarAutorizacao(T.ctx, ana.id, deps());
    await retirarAutorizacao(T.ctx, ana.id, deps());
    expect((await eventos(T, ana.id)).map((e) => [e.evento, e.origem, e.forma, e.registradoPor])).toEqual([
      ['autorizou', 'nutri', 'escrito', T.nutriId],
      ['retirou', 'nutri', null, T.nutriId],
    ]);
  });

  it('pelo app (paciente com conta): autorizar e retirar com a própria conta; menor recusado; não retira a de outro paciente', async () => {
    const T = await novoTenant(app.db);
    const { paciente: p, userId } = await pacienteComConta(app.db, T, { dataNascimento: '1990-11-20' });
    const ctx = ctxPaciente(T.tenantId, p.id, userId);
    expect(await aniversarioNoApp(ctx, tenant(T), deps())).toEqual({ situacao: 'nao_autorizado', autorizadoEm: null });
    await autorizarPeloApp(ctx, deps());
    await autorizarPeloApp(ctx, deps()); // já autorizado: nada novo
    expect(await aniversarioNoApp(ctx, tenant(T), deps())).toEqual({ situacao: 'autorizado', autorizadoEm: expect.any(Date) });
    await retirarAutorizacao(ctx, p.id, deps());
    expect((await eventos(T, p.id)).map((e) => [e.evento, e.origem, e.forma, e.registradoPor])).toEqual([
      ['autorizou', 'app', null, userId],
      ['retirou', 'app', null, userId],
    ]);
    const outro = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-21' });
    await registrarAutorizacao(T.ctx, outro.id, 'escrito', deps());
    expect(await erro(retirarAutorizacao(ctx, outro.id, deps()))).toBeInstanceOf(Error);
    expect(await eventos(T, outro.id)).toHaveLength(1);
    const { paciente: menor, userId: u2 } = await pacienteComConta(app.db, T, { dataNascimento: '2012-01-01' });
    const ctxMenor = ctxPaciente(T.tenantId, menor.id, u2);
    expect(await aniversarioNoApp(ctxMenor, tenant(T), deps())).toEqual({ situacao: 'menor', autorizadoEm: null });
    expect(await erro(autorizarPeloApp(ctxMenor, deps()))).toMatchObject({ message: 'Menor de idade' });
    // sem data de nascimento (só quem veio da página pública pode não ter): o bloco não aparece
    const { paciente: semData, userId: u3 } = await pacienteComConta(app.db, T, { dataNascimento: null, sexo: null, origem: 'agendamento_publico' });
    expect(await aniversarioNoApp(ctxPaciente(T.tenantId, semData.id, u3), tenant(T), deps())).toBeNull();
  });

  it('a autorização de antes dos 18 aparece no app como "não autorizado" (CS-404)', async () => {
    const T = await novoTenant(app.db);
    const { paciente: p, userId } = await pacienteComConta(app.db, T, { dataNascimento: '2008-11-30' });
    await autorizado(T, p.id, '2026-01-01T12:00:00Z');
    expect(await aniversarioNoApp(ctxPaciente(T.tenantId, p.id, userId), tenant(T), deps(em('2026-12-01', '10:00')))).toEqual({ situacao: 'nao_autorizado', autorizadoEm: null });
  });

  it('corrida autorizar × retirar: a retirada espera a trava do paciente e vem depois da autorização em andamento (RN-433)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-20' });
    let retirou = false;
    let retirada: Promise<void> = Promise.resolve();
    await withTenant(
      T.ctx,
      async (tx) => {
        await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, ana.id)).for('no key update');
        await tx.insert(aniversarioAutorizacoes).values({ tenantId: T.tenantId, patientId: ana.id, evento: 'autorizou', origem: 'nutri', forma: 'escrito', registradoPor: T.nutriId });
        retirada = retirarAutorizacao(T.ctx, ana.id, deps()).then(() => void (retirou = true));
        await new Promise((r) => setTimeout(r, 400));
        expect(retirou).toBe(false); // presa na trava do paciente
      },
      app.db,
    );
    await retirada;
    expect((await eventos(T, ana.id)).map((e) => e.evento)).toEqual(['autorizou', 'retirou']);
  });
});

describe('saída pelo link do e-mail (RN-434)', () => {
  it('{nutricionista} = nome profissional; sem ele, o nome de exibição; o GET não grava', async () => {
    const T = await novoTenant(app.db, 'Consultório Debby');
    const ana = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-20' });
    await autorizado(T, ana.id);
    const token = assinarLinkDeSaida({ tenantId: T.tenantId, patientId: ana.id });
    expect(await estadoDoLinkDeSaida(token, deps())).toEqual({ estado: 'ok', nutri: 'Consultório Debby', vigente: true });
    await app.db.update(tenants).set({ nomeProfissional: 'Débora Silva' }).where(eq(tenants.id, T.tenantId));
    expect(await estadoDoLinkDeSaida(token, deps())).toEqual({ estado: 'ok', nutri: 'Débora Silva', vigente: true });
    expect(await eventos(T, ana.id)).toHaveLength(1);
    expect(await estadoDoLinkDeSaida('x'.repeat(66), deps())).toEqual({ estado: 'invalido' });
  });

  it('retirar pelo link: linha `retirou` de origem link, sem conta; de novo → já retirada, sem linha nova; token inválido → inválido', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-20' });
    await autorizado(T, ana.id);
    const token = assinarLinkDeSaida({ tenantId: T.tenantId, patientId: ana.id });
    expect(await retirarPeloLink(token, deps())).toBe('retirada');
    expect(await retirarPeloLink(token, deps())).toBe('ja_retirada');
    expect((await eventos(T, ana.id)).map((e) => [e.evento, e.origem, e.forma, e.registradoPor])).toEqual([
      ['autorizou', 'nutri', 'escrito', T.nutriId],
      ['retirou', 'link', null, null],
    ]);
    expect(await estadoDoLinkDeSaida(token, deps())).toEqual({ estado: 'ok', nutri: T.tenant.nomeExibicao, vigente: false });
    expect(await retirarPeloLink(`${token.slice(0, 65)}${token[65] === 'A' ? 'B' : 'A'}`, deps())).toBe('invalido');
  });

  it('titular anonimizado: o link não vale; limite por token (não por IP)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-20' });
    const bia = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-21' });
    const tAna = assinarLinkDeSaida({ tenantId: T.tenantId, patientId: ana.id });
    const tBia = assinarLinkDeSaida({ tenantId: T.tenantId, patientId: bia.id });
    for (let i = 0; i < LIMITE_SAIDA_POR_HORA; i++) expect(await retirarPeloLink(tAna, deps())).toBe('ja_retirada');
    expect(await retirarPeloLink(tAna, deps())).toBe('limite');
    expect(await retirarPeloLink(tBia, deps())).toBe('ja_retirada'); // outro token, outro balde
    await mudarPaciente(T, bia.id, { status: 'bloqueado', anonimizado: true });
    expect(await estadoDoLinkDeSaida(tBia, deps())).toEqual({ estado: 'invalido' });
    expect(await retirarPeloLink(tBia, deps())).toBe('invalido');
  });
});

describe('grafo de imports (Global Constraints)', () => {
  it('aniversarios.ts nunca alcança enviar.ts, push.ts nem mensagens.ts (o motor de envio só no worker)', () => {
    const g = grafoDeImports(['src/modules/agenda/aniversarios.ts']);
    expect(g.arquivos.has('src/db/tenant.ts')).toBe(true); // o grafo anda
    for (const p of ['src/modules/notificacoes/enviar.ts', 'src/modules/notificacoes/push.ts', 'src/modules/notificacoes/mensagens.ts']) {
      expect(g.arquivos.has(p), caminhoAte(g, p).join(' → ')).toBe(false);
    }
  });
});
