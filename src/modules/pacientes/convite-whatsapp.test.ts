import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { depsDeEnvio } from '../../../test/notificacoes';
import { emailsNaFila, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { conexaoDeTeste, whatsappFalso } from '../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { notifications, tenants, type PatientRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { sealSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { ignorarPendentesDoTenant, reagendarTenantReativado } from '@/modules/notificacoes/agendar';
import { processarNotificacoes } from '@/modules/notificacoes/enviar';
import { FINALIDADE_CONTEUDO } from '@/modules/notificacoes/mensagens';
import { usoDoMes } from '@/modules/notificacoes/whatsapp/cota';
import { reativarConta, suspenderConta } from '@/modules/plataforma/suspensao';
import { aceitarConvitePaciente, inspecionarConvitePaciente, reenviarConvitePaciente, situacaoDoConviteWhatsapp } from './convite-paciente';
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
const varrer = (tenantId: string, whatsapp = whatsappFalso(), agora = now) => processarNotificacoes(depsDeEnvio(agora, { db: app.db, whatsapp }), { tenantId });
/** Decisão do dono (rodada 1): o WhatsApp só avisa; o link vai só no e-mail. */
const avisoDoConvite = (emailMascarado: string, nutri = 'Debby Silva') =>
  `Olá, Ana! ${nutri} convidou você para o NutriDebby. Enviamos o convite para o seu e-mail ${emailMascarado} (vale por 7 dias).`;
const SEM_LINK = /https?:|\/convite\/|[A-Za-z0-9_-]{43}/;
const tokenDo = (link: string) => link.split('/').pop()!;

describe('convite por WhatsApp (US-010)', () => {
  it('autorizado + "Enviar convite por WhatsApp": a linha do WhatsApp não guarda texto nem link; o e-mail leva o link válido', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    expect(p).toMatchObject({ whatsappOptinOrigem: 'nutri', telefoneE164: '+5511912345678' });
    const [email] = await emailsNaFila('convite_paciente', p.email);
    expect(email.link).toMatch(/^http:\/\/localhost:3000\/convite\/paciente\/[A-Za-z0-9_-]{43}$/);
    expect(await inspecionarConvitePaciente(app.db, tokenDo(email.link), now)).toMatchObject({ estado: 'valido', patientId: p.id });
    const [n] = await convites(T.ctx, p.id);
    expect(n).toMatchObject({ canal: 'whatsapp', status: 'pendente', appointmentId: null, inicioConsulta: null, agendadaPara: now, conteudoSelado: null });
    expect(JSON.stringify(n)).not.toContain(tokenDo(email.link));
    // a fila do envio imediato leva só o tenant
    const jobs = (await (await getBoss()).findJobs<Record<string, unknown>>('notificacoes')).filter((j) => j.data.tenantId === T.tenantId);
    expect(jobs.map((j) => j.data)).toEqual([{ tenantId: T.tenantId }]);
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

  it('o worker manda para "+5511912345678" o aviso sem link, com o e-mail mascarado; conta 1 na cota; nada sensível no log', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const logs = (['info', 'warn', 'error'] as const).map((nivel) => vi.spyOn(logger, nivel).mockImplementation(() => undefined));
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const [email] = await emailsNaFila('convite_paciente', p.email);
    const w = whatsappFalso();
    await varrer(T.tenantId, w);
    expect(w.enviados.map((e) => e.numero)).toEqual(['5511912345678']);
    expect(w.enviados[0].texto).toBe(avisoDoConvite('a***@ex.com'));
    expect(w.enviados[0].texto).not.toMatch(SEM_LINK);
    const [n] = await convites(T.ctx, p.id);
    expect(n).toMatchObject({ status: 'enviada', conteudoSelado: null, enviadaEm: now });
    expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, T.tenant.fuso, now), app.db)).toBe(1);
    expect(await situacaoDoConviteWhatsapp(T.ctx, p.id, app.db)).toEqual({ status: 'enviada', motivoIgnorada: null, agendadaPara: now, enviadaEm: now });
    // RNF-11 / regra 3: o envio foi logado (só ids) e nada logado traz o token, o e-mail ou o telefone
    const chamadas = logs.flatMap((s) => s.mock.calls).map((c) => JSON.stringify(c));
    expect(chamadas.length).toBeGreaterThan(0);
    for (const c of chamadas) for (const dado of [tokenDo(email.link), p.email, '5511912345678', 'a***@ex.com']) expect(c, dado).not.toContain(dado);
  });

  it('o texto não depende de o e-mail já ser conta de paciente de outra nutricionista (US-010: nada do tenant B aparece ao A)', async () => {
    // B: a Ana aceita o convite e passa a ter conta de paciente
    const B = await novoTenant(app.db, 'Outra Nutri');
    const comConta = await criarPaciente(B.ctx, B.tenant, cadastro({ enviarConviteWhatsapp: false }), deps);
    const [doB] = await emailsNaFila('convite_paciente', comConta.email);
    await aceitarConvitePaciente({ token: tokenDo(doB.link), senha: 'Paciente2026segura', confirmacao: 'Paciente2026segura', aceitouTermo: true, whatsapp: false, ip: null }, { db: app.db, now });
    // A: cadastra o mesmo e-mail e outro, sem conta (mesma inicial e domínio → mesmo e-mail mascarado)
    const A = await novoTenant(app.db, 'Debby Silva');
    await conexaoDeTeste(app.db, A.ctx, 'conectada');
    const existente = await criarPaciente(A.ctx, A.tenant, cadastro({ email: comConta.email }), deps);
    const nova = await criarPaciente(A.ctx, A.tenant, cadastro(), deps);
    expect((await emailsNaFila('convite_paciente', existente.email)).at(-1)).toMatchObject({ contaExistente: true }); // o e-mail continua diferente
    expect((await emailsNaFila('convite_paciente', nova.email))[0]).toMatchObject({ contaExistente: false });
    const w = whatsappFalso();
    await varrer(A.tenantId, w);
    expect(w.enviados.map((e) => e.texto)).toEqual([avisoDoConvite('a***@ex.com'), avisoDoConvite('a***@ex.com')]);
  });

  it('convite aceito pelo e-mail antes de o WhatsApp sair: não envia — "Não enviado: convite já aceito"', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const [email] = await emailsNaFila('convite_paciente', p.email);
    await aceitarConvitePaciente({ token: tokenDo(email.link), senha: 'Paciente2026segura', confirmacao: 'Paciente2026segura', aceitouTermo: true, whatsapp: true, ip: null }, { db: app.db, now });
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const w = whatsappFalso();
    await varrer(T.tenantId, w);
    expect(w.enviados).toEqual([]);
    expect(await situacaoDoConviteWhatsapp(T.ctx, p.id, app.db)).toMatchObject({ status: 'ignorada', motivoIgnorada: 'convite_aceito' });
  });

  it('e-mail corrigido (e convite reenviado) com o WhatsApp na fila: uma linha só, e o aviso que sai mostra o e-mail atual', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const dados = cadastro();
    const p = await criarPaciente(T.ctx, T.tenant, dados, deps);
    const novoEmail = `bruna-${randomUUID().slice(0, 8)}@novo.com.br`;
    await atualizarPaciente(T.ctx, T.tenant, p.id, { ...dados, email: novoEmail }, { ...deps, now: new Date(now.getTime() + 60_000) });
    await reenviarConvitePaciente(T.ctx, T.tenant, p.id, { ...deps, now: new Date(now.getTime() + 120_000) });
    const links = (await emailsNaFila('convite_paciente', novoEmail)).map((m) => m.link);
    expect(links).toHaveLength(2); // o e-mail corrigido e o reenvio, cada um com o seu link
    expect(await convites(T.ctx, p.id)).toHaveLength(1);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const w = whatsappFalso();
    await varrer(T.tenantId, w);
    expect(w.enviados.map((e) => e.texto)).toEqual([avisoDoConvite('b***@novo.com.br')]);
    for (const l of links) expect(w.enviados[0].texto).not.toContain(tokenDo(l));
    expect(await convites(T.ctx, p.id)).toMatchObject([{ status: 'enviada', conteudoSelado: null }]);
  });

  it('D7: o convite responde a uma ação de agora — cadastrado às 23:30, sai na hora (o horário silencioso é só dos lembretes)', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const noite = new Date('2026-10-15T02:30:00Z'); // 14/10, 23:30 em Brasília
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), { ...deps, now: noite });
    const w = whatsappFalso();
    await varrer(T.tenantId, w, noite);
    expect(w.enviados).toHaveLength(1);
    expect(await convites(T.ctx, p.id)).toMatchObject([{ status: 'enviada', enviadaEm: noite }]);
  });

  it('WhatsApp desconectado: o convite fica "ignorada"/"whatsapp_desconectado" (o e-mail já foi)', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'desconectada');
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const w = whatsappFalso();
    await varrer(T.tenantId, w);
    expect(w.enviados).toEqual([]);
    expect(await situacaoDoConviteWhatsapp(T.ctx, p.id, app.db)).toMatchObject({ status: 'ignorada', motivoIgnorada: 'whatsapp_desconectado' });
    expect(await emailsNaFila('convite_paciente', p.email)).toHaveLength(1);
  });

  it('cota do mês esgotada (D15): o convite por WhatsApp vira "cota_esgotada"; o e-mail sai do mesmo jeito', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await app.db.update(tenants).set({ waCotaMensal: 0 }).where(eq(tenants.id, T.tenantId));
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const w = whatsappFalso();
    await varrer(T.tenantId, w);
    expect(w.enviados).toEqual([]);
    expect(await convites(T.ctx, p.id)).toMatchObject([{ status: 'ignorada', motivoIgnorada: 'cota_esgotada' }]);
    expect(await emailsNaFila('convite_paciente', p.email)).toHaveLength(1);
  });

  /** Uma linha de WhatsApp com texto pronto cifrado (o motor ainda aceita `conteudo_selado`; nenhum fluxo grava link nele). */
  const comTextoCifrado = (T: TenantDeTeste, p: PatientRow) =>
    withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, canal: 'whatsapp', tipo: 'convite_paciente', conteudoSelado: sealSecret('Texto pronto', FINALIDADE_CONTEUDO), agendadaPara: now }).returning(), app.db);

  it('revisão da T11: conta suspensa com o convite na fila — vira "tenant_suspenso" (texto cifrado apagado), e a reativação não o reabre', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    await comTextoCifrado(T, p);
    await suspenderConta(T.tenantId, T.nutriId, app.db);
    await ignorarPendentesDoTenant(app.db, T.tenantId, now);
    const ignorado = { status: 'ignorada', motivoIgnorada: 'tenant_suspenso', conteudoSelado: null };
    expect(await convites(T.ctx, p.id)).toMatchObject([ignorado, ignorado]);
    await reativarConta(T.tenantId, T.nutriId, app.db);
    await reagendarTenantReativado(app.db, T.tenantId, now);
    expect(await convites(T.ctx, p.id)).toMatchObject([ignorado, ignorado]);
  });

  it('o banco recusa texto cifrado numa linha que já saiu ou não sai mais (CHECK notifications_conteudo_so_antes_do_envio)', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro({ enviarConviteWhatsapp: false }), deps);
    const [n] = await comTextoCifrado(T, p);
    const daLinha = eq(notifications.id, n.id);
    for (const fim of [{ status: 'enviada' }, { status: 'falhou' }, { status: 'ignorada', motivoIgnorada: 'tenant_suspenso' }]) {
      await expect(withTenant(T.ctx, (tx) => tx.update(notifications).set(fim).where(daLinha), app.db), fim.status).rejects.toMatchObject({
        cause: { code: '23514', constraint: 'notifications_conteudo_so_antes_do_envio' },
      });
    }
    // reservar (pendente → enviando) e voltar para nova tentativa mantêm o texto
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviando' }).where(daLinha), app.db);
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'pendente' }).where(daLinha), app.db);
    expect((await convites(T.ctx, p.id))[0].conteudoSelado).not.toBeNull();
  });
});
