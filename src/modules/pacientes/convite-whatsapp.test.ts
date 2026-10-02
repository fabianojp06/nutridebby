import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { depsDeEnvio } from '../../../test/notificacoes';
import { emailsNaFila, novoTenant } from '../../../test/pacientes';
import { conexaoDeTeste, whatsappFalso } from '../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { notifications, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { openSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { ignorarPendentesDoTenant, reagendarTenantReativado } from '@/modules/notificacoes/agendar';
import { processarNotificacoes } from '@/modules/notificacoes/enviar';
import { FINALIDADE_CONTEUDO } from '@/modules/notificacoes/mensagens';
import { usoDoMes } from '@/modules/notificacoes/whatsapp/cota';
import { reativarConta, suspenderConta } from '@/modules/plataforma/suspensao';
import { reenviarConvitePaciente, situacaoDoConviteWhatsapp } from './convite-paciente';
import { atualizarPaciente, criarPaciente, listarPacientes, MSG_PACIENTE, PacienteError } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
afterEach(() => {
  vi.restoreAllMocks();
});
const now = new Date('2026-10-14T13:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3000' };
const cadastro = (extra: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: `ana-${randomUUID().slice(0, 8)}@ex.com`,
  telefone: '(11) 91234-5678', whatsappAutorizado: true, enviarConviteWhatsapp: true, ...extra,
});
const convites = (ctx: Parameters<typeof withTenant>[0], patientId: string) =>
  withTenant(ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, patientId), eq(notifications.tipo, 'convite_paciente'))), app.db);
// R12: o ajudante único dos testes do motor; sempre com `tenantId` (os outros arquivos rodam ao mesmo tempo no mesmo banco)
const varrer = (tenantId: string, whatsapp = whatsappFalso()) => processarNotificacoes(depsDeEnvio(now, { db: app.db, whatsapp }), { tenantId });
const textoConvite = (link: string) => `Olá, Ana! Debby Silva convidou você para acompanhar seu tratamento pelo NutriDebby. Crie sua senha pelo link (vale por 7 dias): ${link}`;

describe('convite por WhatsApp (US-010)', () => {
  it('autorizado + "Enviar convite por WhatsApp": e-mail de convite e mensagem com o mesmo link (cifrada até o envio)', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    expect(p).toMatchObject({ whatsappOptinOrigem: 'nutri', telefoneE164: '+5511912345678' });
    const [email] = await emailsNaFila('convite_paciente', p.email);
    const [n] = await convites(T.ctx, p.id);
    expect(n).toMatchObject({ canal: 'whatsapp', status: 'pendente', appointmentId: null, inicioConsulta: null, agendadaPara: now });
    expect(n.conteudoSelado).not.toContain('/convite/paciente/'); // em claro, nunca
    const texto = openSecret(n.conteudoSelado!, FINALIDADE_CONTEUDO);
    expect(texto).toBe(textoConvite(email.link));
  });

  it('"Enviar convite por WhatsApp" sem a autorização → "Marque que o paciente autorizou o WhatsApp"; nada é criado', async () => {
    const T = await novoTenant(app.db);
    const dados = cadastro({ whatsappAutorizado: false });
    const e = await criarPaciente(T.ctx, T.tenant, dados, deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PacienteError);
    expect((e as PacienteError).erros).toEqual({ enviarConviteWhatsapp: MSG_PACIENTE.conviteSemAutorizacao });
    expect(MSG_PACIENTE.conviteSemAutorizacao).toBe('Marque que o paciente autorizou o WhatsApp');
    expect(await listarPacientes(T.ctx, { busca: dados.email }, app.db)).toEqual([]);
  });

  it('sem marcar o convite por WhatsApp, só o e-mail', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro({ enviarConviteWhatsapp: false }), deps);
    expect(await emailsNaFila('convite_paciente', p.email)).toHaveLength(1);
    expect(await convites(T.ctx, p.id)).toEqual([]);
    expect(await situacaoDoConviteWhatsapp(T.ctx, p.id, app.db)).toBeNull();
  });

  it('o worker envia para "+5511912345678", apaga o texto cifrado, conta 1 na cota e a tela mostra a situação; o link não vai para o log', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const logs = (['info', 'warn', 'error'] as const).map((nivel) => vi.spyOn(logger, nivel).mockImplementation(() => undefined));
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const [email] = await emailsNaFila('convite_paciente', p.email);
    const w = whatsappFalso();
    await varrer(T.tenantId, w);
    expect(w.enviados.map((e) => e.numero)).toEqual(['5511912345678']);
    expect(w.enviados[0].texto).toBe(textoConvite(email.link));
    const [n] = await convites(T.ctx, p.id);
    expect(n).toMatchObject({ status: 'enviada', conteudoSelado: null, enviadaEm: now });
    expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, T.tenant.fuso, now), app.db)).toBe(1);
    expect(await situacaoDoConviteWhatsapp(T.ctx, p.id, app.db)).toEqual({ status: 'enviada', motivoIgnorada: null, agendadaPara: now, enviadaEm: now });
    // RNF-11 / regra 3: o envio foi logado (só ids), e nada do que foi logado traz o link ou o token
    expect(logs.flatMap((s) => s.mock.calls).length).toBeGreaterThan(0);
    const token = email.link.split('/').pop()!;
    for (const chamada of logs.flatMap((s) => s.mock.calls)) expect(JSON.stringify(chamada)).not.toContain(token);
  });

  it('D7: o convite responde a uma ação de agora — cadastrado às 23:30, sai na hora (o horário silencioso é só dos lembretes)', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const noite = new Date('2026-10-15T02:30:00Z'); // 14/10, 23:30 em Brasília
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), { ...deps, now: noite });
    const w = whatsappFalso();
    await processarNotificacoes(depsDeEnvio(noite, { db: app.db, whatsapp: w }), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(1);
    expect(await convites(T.ctx, p.id)).toMatchObject([{ status: 'enviada', enviadaEm: noite, conteudoSelado: null }]);
  });

  it('WhatsApp desconectado: o convite fica "ignorada"/"whatsapp_desconectado", sem o texto cifrado (o e-mail já foi)', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'desconectada');
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const w = whatsappFalso();
    await varrer(T.tenantId, w);
    expect(w.enviados).toEqual([]);
    expect(await situacaoDoConviteWhatsapp(T.ctx, p.id, app.db)).toMatchObject({ status: 'ignorada', motivoIgnorada: 'whatsapp_desconectado' });
    expect((await convites(T.ctx, p.id))[0].conteudoSelado).toBeNull();
    expect(await emailsNaFila('convite_paciente', p.email)).toHaveLength(1);
  });

  it('cota do mês esgotada (D15): o convite por WhatsApp vira "cota_esgotada" sem o texto cifrado; o e-mail sai do mesmo jeito', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await app.db.update(tenants).set({ waCotaMensal: 0 }).where(eq(tenants.id, T.tenantId));
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const w = whatsappFalso();
    await varrer(T.tenantId, w);
    expect(w.enviados).toEqual([]);
    expect(await convites(T.ctx, p.id)).toMatchObject([{ status: 'ignorada', motivoIgnorada: 'cota_esgotada', conteudoSelado: null }]);
    expect(await emailsNaFila('convite_paciente', p.email)).toHaveLength(1);
  });

  it('reenviar o convite (ou corrigir o e-mail) com o WhatsApp ainda na fila: a mensagem passa a levar o link novo — uma linha só', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const dados = cadastro();
    const p = await criarPaciente(T.ctx, T.tenant, dados, deps);
    await reenviarConvitePaciente(T.ctx, T.tenant, p.id, { ...deps, now: new Date(now.getTime() + 60_000) });
    const [primeiro, segundo] = await emailsNaFila('convite_paciente', p.email);
    expect(segundo.link).not.toBe(primeiro.link);
    let ls = await convites(T.ctx, p.id);
    expect(ls).toHaveLength(1);
    expect(openSecret(ls[0].conteudoSelado!, FINALIDADE_CONTEUDO)).toBe(textoConvite(segundo.link));
    const novoEmail = `ana-${randomUUID().slice(0, 8)}@ex.com`;
    await atualizarPaciente(T.ctx, T.tenant, p.id, { ...dados, email: novoEmail }, { ...deps, now: new Date(now.getTime() + 120_000) });
    const [terceiro] = await emailsNaFila('convite_paciente', novoEmail);
    ls = await convites(T.ctx, p.id);
    expect(ls).toHaveLength(1);
    expect(openSecret(ls[0].conteudoSelado!, FINALIDADE_CONTEUDO)).toBe(textoConvite(terceiro.link));
    // o que já saiu não muda: depois do envio, reenviar não cria nem reescreve mensagem de WhatsApp
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await varrer(T.tenantId);
    await reenviarConvitePaciente(T.ctx, T.tenant, p.id, { ...deps, now: new Date(now.getTime() + 180_000) });
    expect(await convites(T.ctx, p.id)).toMatchObject([{ status: 'enviada', conteudoSelado: null }]);
  });

  it('revisão da T11: conta suspensa com o convite na fila — vira "tenant_suspenso" sem o texto cifrado, e a reativação não o reabre', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    await suspenderConta(T.tenantId, T.nutriId, app.db);
    await ignorarPendentesDoTenant(app.db, T.tenantId, now);
    const ignorado = [{ status: 'ignorada', motivoIgnorada: 'tenant_suspenso', conteudoSelado: null }];
    expect(await convites(T.ctx, p.id)).toMatchObject(ignorado);
    await reativarConta(T.tenantId, T.nutriId, app.db);
    await reagendarTenantReativado(app.db, T.tenantId, now);
    expect(await convites(T.ctx, p.id)).toMatchObject(ignorado);
  });

  it('o banco recusa texto cifrado numa linha que já saiu ou não sai mais (CHECK notifications_conteudo_so_antes_do_envio)', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const doConvite = and(eq(notifications.patientId, p.id), eq(notifications.tipo, 'convite_paciente'));
    for (const fim of [{ status: 'enviada' }, { status: 'falhou' }, { status: 'ignorada', motivoIgnorada: 'tenant_suspenso' }]) {
      await expect(withTenant(T.ctx, (tx) => tx.update(notifications).set(fim).where(doConvite), app.db), fim.status).rejects.toMatchObject({
        cause: { code: '23514', constraint: 'notifications_conteudo_so_antes_do_envio' },
      });
    }
    // reservar (pendente → enviando) e voltar para nova tentativa mantêm o texto
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviando' }).where(doConvite), app.db);
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'pendente' }).where(doConvite), app.db);
    expect((await convites(T.ctx, p.id))[0].conteudoSelado).not.toBeNull();
  });
});
