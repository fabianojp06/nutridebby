import { createECDH, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import webpush from 'web-push';
import { em, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { caminhoAte, grafoDeImports, raizesDoNext } from '../../../test/grafo-de-imports';
import { depsDeEnvio } from '../../../test/notificacoes';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb, type Db, type Tx } from '@/db/client';
import { notifications, pushSubscriptions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { agendarPelaNutri } from '@/modules/agenda/consultas';
import { processarNotificacoes } from './enviar';
import { endpointDePush, opcoesDeEnvio, pushDoAmbiente, webPushProvedor, type InscricaoPush, type ProvedorPush, type ResultadoPush } from './push';

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
/** Inscrição com chaves de verdade (p256dh na curva P-256, auth de 16 bytes) num serviço de push conhecido — só para teste. */
/**
 * Rodada 2: o host que o WHATWG lê termina com o domínio de um serviço de push, mas o `url.parse` (que o web-push usa para
 * discar) corta o host em `;`, `'`, `"`, `` ` ``, `{`, `}` — e discaria 127.0.0.1, um serviço interno, o IP de metadados…
 */
const DESVIOS_DO_URL_PARSE = [
  'https://127.0.0.1;.push.apple.com/x',
  'https://nutridebby_app;.push.apple.com/x',
  'https://localhost;.push.apple.com/x',
  'https://169.254.169.254;.notify.windows.com/x',
  'https://easypanel-traefik;.push.apple.com/x',
  "https://evil.tld'.push.apple.com/x",
  'https://a{.push.apple.com/x',
  'https://a}.push.apple.com/x',
  'https://a".push.apple.com/x',
  'https://a`.push.apple.com/x',
  'https://10.0.1.7;x.fcm.googleapis.com/x',
];
const inscricaoReal = (endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`): InscricaoPush => {
  const ecdh = createECDH('prime256v1');
  return { endpoint, p256dh: ecdh.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') };
};
const inscrever = (T: TenantDeTeste, patientId: string, i: InscricaoPush) => withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId, ...i }), app.db);
/** web-push "de verdade" até a montagem do pedido; o POST é trocado por um espião (nada sai para a rede). */
function provedorReal(resposta: (endpoint: string) => unknown = () => ({ statusCode: 201, body: '', headers: {} })) {
  const par = webpush.generateVAPIDKeys(); // só para o teste
  const posts: string[] = [];
  const provedor = webPushProvedor({
    publicKey: par.publicKey,
    privateKey: par.privateKey,
    subject: 'mailto:x@y.dev',
    enviar: (async (sub: { endpoint: string }) => {
      posts.push(sub.endpoint);
      return resposta(sub.endpoint);
    }) as never,
  });
  return { provedor, posts, par };
}
/** `db` real, menos o DELETE em push_subscriptions, que falha (com o endpoint na mensagem: não pode ir para o log). */
const semApagarInscricoes = (db: Db, segredo: string): Db =>
  new Proxy(db, {
    get(alvo, prop) {
      if (prop === 'transaction') {
        return (fn: (tx: Tx) => Promise<unknown>) =>
          alvo.transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(t, k) {
                  if (k === 'delete') {
                    return (tabela: unknown) => {
                      if (tabela === pushSubscriptions) throw new Error(`delete falhou para ${segredo}`);
                      return t.delete(tabela as never);
                    };
                  }
                  const v = Reflect.get(t, k, t);
                  return typeof v === 'function' ? v.bind(t) : v;
                },
              }),
            ),
          );
      }
      const v = Reflect.get(alvo, prop, alvo);
      return typeof v === 'function' ? v.bind(alvo) : v;
    },
  });
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
    const i = inscricaoReal();
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
      }).enviar(i, '{"titulo":"x"}', 3600);
    expect(await com(null)).toEqual({ ok: true });
    expect(chamadas[0][0]).toEqual({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } });
    expect(chamadas[0][1]).toBe('{"titulo":"x"}');
    expect(chamadas[0][2]).toEqual(opcoesDeEnvio({ ...par, subject: 'mailto:x@y.dev' }, 3600));
    expect(chamadas[0][2]).toMatchObject({ TTL: 3600, timeout: 10_000, urgency: 'normal', vapidDetails: { subject: 'mailto:x@y.dev', publicKey: par.publicKey, privateKey: par.privateKey } });
    const http = (statusCode: number) => new webpush.WebPushError('Received unexpected response code', statusCode, {}, '', i.endpoint);
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
    // conexão caída depois de enviar, timeout ou erro sem código: pode ter sido aceito → incerto, não repete
    expect(await com(deRede('ECONNRESET'))).toEqual({ ok: false, remover: false, definitivo: true, incerto: true, codigo: 'sem_resposta' });
    expect(await com(new Error('Socket timeout'))).toEqual({ ok: false, remover: false, definitivo: true, incerto: true, codigo: 'sem_resposta' });
    expect(pushDoAmbiente({})).toBeNull();
    expect(pushDoAmbiente({ VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey })).toBeNull();
    expect(pushDoAmbiente({ VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey, VAPID_SUBJECT: 'mailto:x@y.dev' })).not.toBeNull();
  });

  it('rodada 1 (D6 entre dispositivos): um de resultado incerto (pode ter recebido) e outro com 5xx → "falhou"/"sem_resposta", sem reenviar a ninguém', async () => {
    const incertos: (() => ResultadoPush)[] = [
      () => {
        throw new Error('ECONNRESET'); // exceção do provedor
      },
      () => ({ ok: false, remover: false, definitivo: true, incerto: true, codigo: 'sem_resposta' }), // timeout / conexão caída depois de enviar
    ];
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      for (const incerto of incertos) {
        const T = await novoTenant(app.db);
        const { id, endpoints } = await marcadaComInscricoes(T, 2);
        const p = pushFalso((i) => (i.endpoint === endpoints[0] ? incerto() : { ok: false, remover: false, definitivo: false, codigo: 'http_503' }));
        await processarNotificacoes(deps(marcadaEm, p), { tenantId: T.tenantId });
        expect(await linha(T, id, 'consulta_marcada')).toMatchObject({ status: 'falhou', erro: 'sem_resposta', tentativas: 1 });
        // na hora em que a nova tentativa sairia, nada sai: o celular que talvez tenha recebido não recebe de novo
        const depois = pushFalso();
        await processarNotificacoes(deps(new Date(marcadaEm.getTime() + 60_000), depois), { tenantId: T.tenantId });
        expect(doTipo(depois, 'Consulta marcada')).toEqual([]);
      }
    } finally {
      aviso.mockRestore();
    }
  });

  it('rodada 1: só envia para serviços de push conhecidos (https, porta padrão, sem usuário, forma canônica); o resto é apagado sem POST', async () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
      'https://web.push.apple.com/QGx3Uf8a',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAABk%2bx',
    ]) {
      expect(endpointDePush(ok), ok).toBe(true);
    }
    for (const nao of [
      'http://fcm.googleapis.com/fcm/send/x', // sem TLS
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://10.0.1.7/x',
      'https://nutridebby_app/x', // nome interno da rede do Easypanel
      'https://nutri_evolution:8080/x',
      'https://fcm.googleapis.com.evil.tld/x', // parecido
      'https://x.fcm.googleapis.com/x', // fcm: só o host exato
      'https://push.apple.com/x', // *.push.apple.com: só subdomínio
      'https://evilpush.apple.com/x',
      'https://notify.windows.com.evil.tld/x',
      'https://user:pw@fcm.googleapis.com/x', // usuário/senha
      'https://fcm.googleapis.com@evil.tld/x',
      'https://fcm.googleapis.com:8443/x', // porta
      'https://fcm.googleapis.com:443/x', // forma não canônica
      'https://fcm.googleapis.com\\evil/x', // barra invertida: forma não canônica (cada leitor de URL a entende de um jeito)
      'https://fcm.googleapis.com./x',
      'não é url',
      ...DESVIOS_DO_URL_PARSE,
    ]) {
      expect(endpointDePush(nao), nao).toBe(false);
    }
    // no provedor: recusado sem POST
    const { provedor, posts } = provedorReal();
    expect(await provedor.enviar(inscricaoReal('https://nutridebby_app:3000/api/x'), '{}', 60)).toEqual({ ok: false, remover: true, definitivo: true, codigo: 'endpoint_recusado' });
    expect(posts).toEqual([]);
    // no motor: a inscrição de endereço interno é apagada, a do FCM recebe
    const T = await novoTenant(app.db);
    const { p, id } = await marcadaComInscricoes(T, 0);
    const [interna, fcm] = [inscricaoReal('https://nutri_evolution/hook'), inscricaoReal()];
    for (const i of [interna, fcm]) await inscrever(T, p.id, i);
    const real = provedorReal();
    await processarNotificacoes(deps(marcadaEm, real.provedor), { tenantId: T.tenantId });
    expect(real.posts).toEqual([fcm.endpoint]);
    expect((await inscricoes(T)).map((s) => s.endpoint)).toEqual([fcm.endpoint]);
    expect(await linha(T, id, 'consulta_marcada')).toMatchObject({ status: 'enviada' });
  });

  it('rodada 2: o web-push de verdade, com o https.request trocado (sem rede) — endereço que o url.parse lê com outro host não é discado', async () => {
    const discados: { hostname?: string | null; port?: unknown; path?: string | null }[] = [];
    const espiao = vi.spyOn(https, 'request').mockImplementation(((opcoes: { hostname?: string | null; port?: unknown; path?: string | null }) => {
      discados.push({ hostname: opcoes.hostname, port: opcoes.port, path: opcoes.path });
      const pedido: EventEmitter & { write: () => boolean; end: () => void; destroy: () => void } = Object.assign(new EventEmitter(), {
        write: () => true,
        end: () => queueMicrotask(() => pedido.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))),
        destroy: () => undefined,
      });
      return pedido;
    }) as never);
    try {
      const par = webpush.generateVAPIDKeys(); // só para o teste
      const real = webPushProvedor({ publicKey: par.publicKey, privateKey: par.privateKey, subject: 'mailto:x@y.dev' }); // sem `enviar`: o sendNotification real
      // controle: o espião pega o pedido de verdade — para um endpoint do FCM, o web-push disca o host do FCM
      expect(await real.enviar(inscricaoReal(), '{}', 60)).toEqual({ ok: false, remover: false, definitivo: false, codigo: 'rede' });
      expect(discados).toEqual([{ hostname: 'fcm.googleapis.com', port: null, path: expect.stringMatching(/^\/fcm\/send\//) }]);
      discados.length = 0;
      const resultados: ResultadoPush[] = [];
      for (const desvio of DESVIOS_DO_URL_PARSE) resultados.push(await real.enviar(inscricaoReal(desvio), '{}', 60));
      expect(discados, 'nenhum pedido discado para os desvios').toEqual([]);
      expect(resultados).toEqual(DESVIOS_DO_URL_PARSE.map(() => ({ ok: false, remover: true, definitivo: true, codigo: 'endpoint_recusado' })));
    } finally {
      espiao.mockRestore();
    }
  });

  it('rodada 1: inscrição cujas chaves não montam o pedido (p256dh fora da curva, auth curta) é apagada sem sair nada; VAPID inválida derruba na criação', async () => {
    const par = webpush.generateVAPIDKeys(); // só para o teste
    // sem `enviar`: o web-push de verdade — o erro acontece ao montar/cifrar, antes de qualquer rede
    const real = webPushProvedor({ publicKey: par.publicKey, privateKey: par.privateKey, subject: 'mailto:x@y.dev' });
    const boa = inscricaoReal();
    const invalida = { ok: false, remover: true, definitivo: true, codigo: 'inscricao_invalida' };
    expect(await real.enviar({ ...boa, p256dh: 'a'.repeat(87) }, '{}', 60)).toEqual(invalida);
    expect(await real.enviar({ ...boa, auth: 'AAAAAAAAAA' }, '{}', 60)).toEqual(invalida);
    expect(() => webPushProvedor({ publicKey: par.publicKey, privateKey: 'curta', subject: 'mailto:x@y.dev' })).toThrow();
    expect(() => webPushProvedor({ publicKey: par.publicKey, privateKey: par.privateKey, subject: 'suporte@exemplo.com' })).toThrow();
    // no motor: a inválida é apagada, a boa recebe
    const T = await novoTenant(app.db);
    const { p, id } = await marcadaComInscricoes(T, 0);
    const lixo = { ...inscricaoReal(), p256dh: 'a'.repeat(87) };
    for (const i of [lixo, boa]) await inscrever(T, p.id, i);
    const espiao = provedorReal();
    await processarNotificacoes(deps(marcadaEm, espiao.provedor), { tenantId: T.tenantId });
    expect(espiao.posts).toEqual([boa.endpoint]);
    expect((await inscricoes(T)).map((s) => s.endpoint)).toEqual([boa.endpoint]);
    expect(await linha(T, id, 'consulta_marcada')).toMatchObject({ status: 'enviada' });
  });

  it('rodada 1: o pedido de verdade — o web-push monta com as opções do push.ts: TTL, Urgency, timeout e o VAPID assinado (ES256)', () => {
    const par = webpush.generateVAPIDKeys(); // só para o teste
    const i = inscricaoReal();
    const d = webpush.generateRequestDetails({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, '{"titulo":"x"}', opcoesDeEnvio({ ...par, subject: 'mailto:x@y.dev' }, 3600));
    expect(d).toMatchObject({ method: 'POST', endpoint: i.endpoint });
    expect(d.headers).toMatchObject({ TTL: 3600, Urgency: 'normal', 'Content-Encoding': 'aes128gcm' });
    expect((d as { timeout?: number }).timeout).toBe(10_000);
    expect(d.body!.length).toBeGreaterThan('{"titulo":"x"}'.length); // cifrado (aes128gcm)
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(String(d.headers.Authorization));
    expect(m, 'cabeçalho Authorization do VAPID').not.toBeNull();
    const [, cab, corpo, sig, k] = m!;
    expect(k).toBe(par.publicKey);
    expect(JSON.parse(Buffer.from(cab, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const jwt = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    expect(jwt).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:x@y.dev' });
    expect(jwt.exp - Date.now() / 1000).toBeGreaterThan(0);
    expect(jwt.exp - Date.now() / 1000).toBeLessThanOrEqual(24 * 3600);
    const pub = Buffer.from(par.publicKey, 'base64url');
    const chave = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${cab}.${corpo}`), { key: chave, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('rodada 1: falha ao apagar as inscrições mortas — o que já saiu fica "enviada" (sem reenviar); o log só leva o nome do erro', async () => {
    const T = await novoTenant(app.db);
    const { id, endpoints } = await marcadaComInscricoes(T, 2);
    const p = pushFalso((i) => (i.endpoint === endpoints[0] ? { ok: false, remover: true, definitivo: true, codigo: 'http_410' } : { ok: true }));
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await processarNotificacoes(depsDeEnvio(marcadaEm, { db: semApagarInscricoes(app.db, endpoints[0]), push: p }), { tenantId: T.tenantId });
      expect(aviso).toHaveBeenCalledWith({ tenantId: T.tenantId, notificacaoId: expect.any(String), canal: 'push', err: 'Error' }, 'falha ao apagar inscrições de push');
      expect(JSON.stringify(aviso.mock.calls)).not.toContain('push.example.test');
    } finally {
      aviso.mockRestore();
    }
    expect(await linha(T, id, 'consulta_marcada')).toMatchObject({ status: 'enviada', tentativas: 1 });
    expect(await inscricoes(T)).toHaveLength(2); // a morta fica para a próxima notificação
    const depois = pushFalso();
    await processarNotificacoes(deps(new Date(marcadaEm.getTime() + 60_000), depois), { tenantId: T.tenantId });
    expect(doTipo(depois, 'Consulta marcada')).toEqual([]);
  });
});

describe('R1: web-push só no worker', () => {
  it('nada do grafo do Next (src/app, proxy, instrumentation, next.config) alcança push.ts, enviar.ts ou web-push, direta ou indiretamente', () => {
    const g = grafoDeImports(raizesDoNext());
    // o grafo anda de verdade: as rotas chegam ao motor de lembretes por agendar.ts e ao webhook do WhatsApp
    expect([...g.arquivos.keys()]).toEqual(expect.arrayContaining(['src/modules/notificacoes/agendar.ts', 'src/modules/notificacoes/whatsapp/webhook.ts']));
    expect(g.pacotes.has('pg-boss'), 'o grafo também registra pacotes').toBe(true);
    for (const proibido of ['src/modules/notificacoes/push.ts', 'src/modules/notificacoes/enviar.ts']) {
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
    expect(g.pacotes.get('web-push'), 'web-push importado (no grafo do Next) por').toBeUndefined();
  });
});
