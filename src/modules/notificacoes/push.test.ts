import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import webpush from 'web-push';
import { em, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { caminhoAte, fontesDe, grafoDeImports } from '../../../test/grafo-de-imports';
import { depsDeEnvio } from '../../../test/notificacoes';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { notifications, pushSubscriptions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { agendarPelaNutri } from '@/modules/agenda/consultas';
import { processarNotificacoes } from './enviar';
import { pushDoAmbiente, webPushProvedor, type InscricaoPush, type ProvedorPush, type ResultadoPush } from './push';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const marcadaEm = new Date('2026-10-01T12:00:00Z');
type Enviado = { i: InscricaoPush; payload: string; ttl: number };
const pushFalso = (r: (i: InscricaoPush) => ResultadoPush = () => ({ ok: true })): ProvedorPush & { enviados: Enviado[] } => {
  const enviados: Enviado[] = [];
  return {
    enviados,
    async enviar(i, payload, ttl) {
      enviados.push({ i, payload, ttl });
      return r(i);
    },
  };
};
// R12: o ajudante comum, com o provedor de push do teste
const deps = (agora: Date, push: ProvedorPush | null) => depsDeEnvio(agora, { db: app.db, push });

async function marcadaComInscricoes(T: TenantDeTeste, n: number, hora = '14:00') {
  const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', telefoneE164: '+5511912345678' });
  const endpoints = Array.from({ length: n }, () => `https://push.example.test/${randomUUID()}`);
  for (const endpoint of endpoints) {
    await withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: p.id, endpoint, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }), app.db);
  }
  const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-16', hora, duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: marcadaEm });
  return { p, id, endpoints };
}
const linha = async (T: TenantDeTeste, id: string, tipo: string) =>
  (await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, tipo), eq(notifications.canal, 'push'))), app.db))[0];
const inscricoes = (T: TenantDeTeste) => withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions), app.db);
const doTipo = (p: { enviados: Enviado[] }, titulo: string) => p.enviados.filter((e) => JSON.parse(e.payload).titulo === titulo);

describe('push (INT-03, D19)', () => {
  it('envia para todos os dispositivos; payload sem dado de saúde, com o link da consulta; TTL até o início (no máximo 24 h)', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcadaComInscricoes(T, 2);
    // a confirmação da marcação: consulta daqui a 15 dias → TTL de 24 h
    const marcacao = pushFalso();
    await processarNotificacoes(deps(marcadaEm, marcacao), { tenantId: T.tenantId });
    const [m] = doTipo(marcacao, 'Consulta marcada');
    expect(JSON.parse(m.payload)).toMatchObject({ corpo: 'sex., 16/10/2026 às 14:00 (horário de Brasília), com Debby Silva.' });
    expect(m.ttl).toBe(86_400);
    // o lembrete de 24 h
    const p = pushFalso();
    await processarNotificacoes(deps(em('2026-10-15', '14:00'), p), { tenantId: T.tenantId });
    const doLembrete = doTipo(p, 'Consulta amanhã às 14:00');
    expect(doLembrete).toHaveLength(2);
    expect(new Set(doLembrete.map((e) => e.i.endpoint)).size).toBe(2);
    const corpo = JSON.parse(doLembrete[0].payload);
    expect(Object.keys(corpo).sort()).toEqual(['corpo', 'titulo', 'url']);
    expect(corpo.corpo).toBe('Com Debby Silva. Toque para confirmar ou remarcar.');
    expect(corpo.url).toMatch(/^http:\/\/localhost:3000\/consulta\/[A-Za-z0-9_-]{71}$/);
    // sem dado do paciente nem da consulta além do horário: nome, telefone, endereço, modalidade
    for (const dado of ['Ana', 'Souza', '912345678', 'Rua das Flores', 'presencial']) expect(doLembrete[0].payload, dado).not.toContain(dado);
    expect(doLembrete[0].ttl).toBe(86_400);
    expect(await linha(T, id, 'lembrete_24h')).toMatchObject({ status: 'enviada', tentativas: 1 });
    // o de 2 h: TTL até o início (2 h)
    const p2 = pushFalso();
    await processarNotificacoes(deps(em('2026-10-16', '12:00'), p2), { tenantId: T.tenantId });
    expect(doTipo(p2, 'Consulta hoje às 14:00').map((e) => e.ttl)).toEqual([7200, 7200]);
  });

  it('404/410 apaga a inscrição; se nenhuma sobrar, "sem_inscricao"; 5xx tenta de novo (só se ninguém recebeu); sem VAPID, "push_desligado"', async () => {
    const T = await novoTenant(app.db);
    const { id, endpoints } = await marcadaComInscricoes(T, 2);
    const p = pushFalso((i) => (i.endpoint === endpoints[0] ? { ok: false, remover: true, definitivo: true, codigo: 'http_410' } : { ok: true }));
    await processarNotificacoes(deps(marcadaEm, p), { tenantId: T.tenantId });
    expect((await inscricoes(T)).map((i) => i.endpoint)).toEqual([endpoints[1]]);
    expect(await linha(T, id, 'consulta_marcada')).toMatchObject({ status: 'enviada' });

    const U = await novoTenant(app.db);
    const u = await marcadaComInscricoes(U, 1);
    await processarNotificacoes(deps(marcadaEm, pushFalso(() => ({ ok: false, remover: true, definitivo: true, codigo: 'http_404' }))), { tenantId: U.tenantId });
    expect(await linha(U, u.id, 'consulta_marcada')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'sem_inscricao' });
    expect(await inscricoes(U)).toEqual([]);

    const V = await novoTenant(app.db);
    const v = await marcadaComInscricoes(V, 1);
    await processarNotificacoes(deps(marcadaEm, pushFalso(() => ({ ok: false, remover: false, definitivo: false, codigo: 'http_503' }))), { tenantId: V.tenantId });
    const repetir = await linha(V, v.id, 'consulta_marcada');
    expect(repetir).toMatchObject({ status: 'pendente', erro: 'http_503', tentativas: 1 });
    expect(repetir.agendadaPara.getTime() - marcadaEm.getTime()).toBe(60_000); // como o WhatsApp: 1, 5 e 25 min
    // na nova tentativa sai
    const depois = pushFalso();
    await processarNotificacoes(deps(repetir.agendadaPara, depois), { tenantId: V.tenantId });
    expect(doTipo(depois, 'Consulta marcada')).toHaveLength(1);
    expect(await linha(V, v.id, 'consulta_marcada')).toMatchObject({ status: 'enviada', tentativas: 2 });

    const X = await novoTenant(app.db);
    const x = await marcadaComInscricoes(X, 1);
    await processarNotificacoes(deps(marcadaEm, null), { tenantId: X.tenantId });
    expect(await linha(X, x.id, 'consulta_marcada')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'push_desligado' });
    expect(await inscricoes(X)).toHaveLength(1); // sem VAPID nada é apagado
  });

  it('push ligado e paciente sem inscrição (o normal até o P06-02): "sem_inscricao", sem chamar o serviço', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcadaComInscricoes(T, 0);
    const p = pushFalso();
    await processarNotificacoes(deps(marcadaEm, p), { tenantId: T.tenantId });
    expect(p.enviados).toEqual([]);
    expect(await linha(T, id, 'consulta_marcada')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'sem_inscricao' });
  });

  it('no máximo uma vez (D6): um dispositivo recebeu e o outro deu 5xx → "enviada", sem nova tentativa; falha definitiva ou exceção do provedor → "falhou"', async () => {
    const T = await novoTenant(app.db);
    const { id, endpoints } = await marcadaComInscricoes(T, 2);
    const p = pushFalso((i) => (i.endpoint === endpoints[0] ? { ok: false, remover: false, definitivo: false, codigo: 'http_503' } : { ok: true }));
    await processarNotificacoes(deps(marcadaEm, p), { tenantId: T.tenantId });
    expect(await linha(T, id, 'consulta_marcada')).toMatchObject({ status: 'enviada', tentativas: 1 });
    expect(await inscricoes(T)).toHaveLength(2);

    const U = await novoTenant(app.db);
    const u = await marcadaComInscricoes(U, 2);
    // um 413 (definitivo) e um 410 (inscrição morta): ninguém recebeu e não adianta repetir
    let k = 0;
    await processarNotificacoes(deps(marcadaEm, pushFalso(() => (k++ === 0 ? { ok: false, remover: false, definitivo: true, codigo: 'http_413' } : { ok: false, remover: true, definitivo: true, codigo: 'http_410' }))), { tenantId: U.tenantId });
    expect(await linha(U, u.id, 'consulta_marcada')).toMatchObject({ status: 'falhou', erro: 'http_413' });
    expect(await inscricoes(U)).toHaveLength(1);

    const V = await novoTenant(app.db);
    const v = await marcadaComInscricoes(V, 1);
    const quebra: ProvedorPush = {
      async enviar() {
        throw new Error('https://push.example.test/segredo'); // não se sabe se saiu: não repete, e a mensagem não vai para o log
      },
    };
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await processarNotificacoes(deps(marcadaEm, quebra), { tenantId: V.tenantId });
      expect(aviso).toHaveBeenCalledWith(expect.objectContaining({ tenantId: V.tenantId, canal: 'push', err: 'Error' }), 'falha no provedor de push');
      expect(JSON.stringify(aviso.mock.calls)).not.toContain('push.example.test');
    } finally {
      aviso.mockRestore();
    }
    expect(await linha(V, v.id, 'consulta_marcada')).toMatchObject({ status: 'falhou', erro: 'sem_resposta' });
  });

  it('webPushProvedor: 410/404 removem; outros 4xx definitivos; 429/5xx repetem; rede só repete se o pedido não saiu; manda VAPID, TTL e timeout', async () => {
    const chamadas: unknown[][] = [];
    const par = webpush.generateVAPIDKeys(); // só para o teste
    const com = (erro: unknown) =>
      webPushProvedor({
        publicKey: par.publicKey,
        privateKey: par.privateKey,
        subject: 'mailto:x@y.dev',
        enviar: (async (...a: unknown[]) => {
          chamadas.push(a);
          if (erro) throw erro;
          return { statusCode: 201, body: '', headers: {} };
        }) as never,
      }).enviar({ endpoint: 'https://push.example.test/1', p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }, '{"titulo":"x"}', 3600);
    expect(await com(null)).toEqual({ ok: true });
    expect(chamadas[0][0]).toEqual({ endpoint: 'https://push.example.test/1', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } });
    expect(chamadas[0][1]).toBe('{"titulo":"x"}');
    expect(chamadas[0][2]).toMatchObject({ TTL: 3600, timeout: 10_000, urgency: 'normal', vapidDetails: { subject: 'mailto:x@y.dev', publicKey: par.publicKey, privateKey: par.privateKey } });
    const http = (statusCode: number) => new webpush.WebPushError('Received unexpected response code', statusCode, {}, '', 'https://push.example.test/1');
    expect(await com(http(410))).toEqual({ ok: false, remover: true, definitivo: true, codigo: 'http_410' });
    expect(await com(http(404))).toEqual({ ok: false, remover: true, definitivo: true, codigo: 'http_404' });
    expect(await com(http(413))).toEqual({ ok: false, remover: false, definitivo: true, codigo: 'http_413' });
    expect(await com(http(403))).toEqual({ ok: false, remover: false, definitivo: true, codigo: 'http_403' }); // VAPID errada: não apaga a inscrição
    expect(await com(http(429))).toEqual({ ok: false, remover: false, definitivo: false, codigo: 'http_429' });
    expect(await com(http(502))).toEqual({ ok: false, remover: false, definitivo: false, codigo: 'http_502' });
    // D6 (como no WhatsApp, T9): repetir só quando o pedido não chegou a sair (conexão recusada, DNS, rota)
    const deRede = (code: string) => Object.assign(new Error(`connect ${code}`), { code });
    expect(await com(deRede('ECONNREFUSED'))).toEqual({ ok: false, remover: false, definitivo: false, codigo: 'rede' });
    expect(await com(deRede('ENOTFOUND'))).toEqual({ ok: false, remover: false, definitivo: false, codigo: 'rede' });
    expect(await com(new AggregateError([deRede('ECONNREFUSED'), deRede('ENETUNREACH')]))).toMatchObject({ definitivo: false, codigo: 'rede' });
    // conexão caída depois de enviar, timeout ou erro sem código: pode ter sido aceito → não repete
    expect(await com(deRede('ECONNRESET'))).toEqual({ ok: false, remover: false, definitivo: true, codigo: 'sem_resposta' });
    expect(await com(new Error('Socket timeout'))).toEqual({ ok: false, remover: false, definitivo: true, codigo: 'sem_resposta' });
    expect(pushDoAmbiente({})).toBeNull();
    expect(pushDoAmbiente({ VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey })).toBeNull();
    expect(pushDoAmbiente({ VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey, VAPID_SUBJECT: 'mailto:x@y.dev' })).not.toBeNull();
  });
});

describe('R1: web-push só no worker', () => {
  it('nenhum arquivo de src/app (nem src/proxy.ts) alcança push.ts ou web-push, direta ou indiretamente', () => {
    const g = grafoDeImports([...fontesDe('src/app'), 'src/proxy.ts']);
    // o grafo anda de verdade: as rotas chegam ao motor de lembretes por agendar.ts e ao webhook do WhatsApp
    expect([...g.arquivos.keys()]).toEqual(expect.arrayContaining(['src/modules/notificacoes/agendar.ts', 'src/modules/notificacoes/whatsapp/webhook.ts']));
    expect(g.pacotes.has('pg-boss'), 'o grafo também registra pacotes').toBe(true);
    for (const proibido of ['src/modules/notificacoes/push.ts', 'src/modules/notificacoes/enviar.ts']) {
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
    expect(g.pacotes.get('web-push'), 'web-push importado (no grafo do Next) por').toBeUndefined();
  });
});
