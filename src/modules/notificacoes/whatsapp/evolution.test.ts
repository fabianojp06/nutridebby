import { describe, expect, it } from 'vitest';
import { evolutionProvedor } from './evolution';
import { chaveDoWebhook } from './jwt';

type Chamada = { url: string; init: RequestInit };
function fetchFalso(respostas: Record<string, { status: number; body?: unknown } | Error>) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const chave = `${init.method} ${new URL(url).pathname}`;
    const r = respostas[chave];
    if (!r) throw new Error(`sem resposta para ${chave}`);
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, chamadas };
}
const config = { url: 'http://evo:8080/', apiKey: 'chave-global-da-evolution', webhookUrl: 'http://app:3000/api/webhooks/whatsapp', webhookSecret: 's'.repeat(40) };

describe('Evolution API (D1)', () => {
  it('sendText: POST /message/sendText/<instância> com apikey e { number, text, delay, linkPreview }; devolve key.id e key.remoteJid', async () => {
    const { f, chamadas } = fetchFalso({ 'POST /message/sendText/nd-t1': { status: 201, body: { key: { id: 'WAID1', remoteJid: '551191234567@s.whatsapp.net', fromMe: true }, status: 'PENDING' } } });
    const r = await evolutionProvedor({ ...config, fetchImpl: f }).enviarTexto({ instancia: 'nd-t1', numero: '5511912345678', texto: 'Olá' });
    expect(r).toEqual({ ok: true, id: 'WAID1', jid: '551191234567@s.whatsapp.net' });
    expect(chamadas[0].url).toBe('http://evo:8080/message/sendText/nd-t1');
    expect(chamadas[0].init.headers).toMatchObject({ apikey: 'chave-global-da-evolution', 'content-type': 'application/json' });
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({ number: '5511912345678', text: 'Olá', delay: 1200, linkPreview: false });
  });

  it('falhas: número sem WhatsApp e 401/404 são definitivas; 5xx e conexão recusada repetem; timeout é definitivo (pode ter saído: no máximo 1)', async () => {
    const envio = { instancia: 'nd-t1', numero: '5511900000000', texto: 'x' };
    const com = (r: { status: number; body?: unknown } | Error) => evolutionProvedor({ ...config, fetchImpl: fetchFalso({ 'POST /message/sendText/nd-t1': r }).f }).enviarTexto(envio);
    expect(await com({ status: 400, body: { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: '5511900000000@s.whatsapp.net', number: '5511900000000' }] } } })).toEqual({ ok: false, definitivo: true, codigo: 'numero_sem_whatsapp' });
    expect(await com({ status: 400, body: { response: { message: ['Text is required'] } } })).toEqual({ ok: false, definitivo: true, codigo: 'recusado' });
    expect(await com({ status: 401 })).toEqual({ ok: false, definitivo: true, codigo: 'nao_autorizado' });
    expect(await com({ status: 404 })).toEqual({ ok: false, definitivo: true, codigo: 'instancia_inexistente' });
    expect(await com({ status: 502 })).toEqual({ ok: false, definitivo: false, codigo: 'indisponivel' });
    expect(await com(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toEqual({ ok: false, definitivo: false, codigo: 'indisponivel' });
    expect(await com(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toEqual({ ok: false, definitivo: true, codigo: 'sem_resposta' });
    expect(await com({ status: 201, body: { nada: true } })).toEqual({ ok: false, definitivo: true, codigo: 'resposta_invalida' });
  });

  it('rede (D6, no máximo uma vez): só repete o que falhou antes de o pedido sair (conexão recusada, DNS); conexão derrubada depois de enviar é definitiva', async () => {
    const envio = { instancia: 'nd-t1', numero: '5511912345678', texto: 'x' };
    const com = (e: Error) => evolutionProvedor({ ...config, fetchImpl: fetchFalso({ 'POST /message/sendText/nd-t1': e }).f }).enviarTexto(envio);
    const rede = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
    const repete = { ok: false, definitivo: false, codigo: 'indisponivel' };
    const saiuTalvez = { ok: false, definitivo: true, codigo: 'sem_resposta' };
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) expect(await com(rede(code)), code).toEqual(repete);
    // `localhost` com IPv4 e IPv6 recusando: AggregateError com os dois erros
    const recusadas = Object.assign(new AggregateError([Object.assign(new Error('a'), { code: 'ECONNREFUSED' }), Object.assign(new Error('b'), { code: 'ECONNREFUSED' })]), { code: 'ECONNREFUSED' });
    expect(await com(Object.assign(new TypeError('fetch failed'), { cause: recusadas }))).toEqual(repete);
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE']) expect(await com(rede(code)), code).toEqual(saiuTalvez);
    expect(await com(new TypeError('fetch failed')), 'sem causa conhecida').toEqual(saiuTalvez);
  });

  it('conectar: cria a instância que falta, configura o webhook com o jwt_key DESTA instância (D4 a) e devolve o QR', async () => {
    const qr = 'data:image/png;base64,iVBORw0KGgo=';
    const { f, chamadas } = fetchFalso({
      'GET /instance/connectionState/nd-t1': { status: 404 },
      'POST /instance/create': { status: 201, body: { instance: { instanceName: 'nd-t1', status: 'connecting' } } },
      'POST /webhook/set/nd-t1': { status: 201, body: {} },
      'GET /instance/connect/nd-t1': { status: 200, body: { pairingCode: null, code: '2@x', base64: qr, count: 1 } },
    });
    expect(await evolutionProvedor({ ...config, fetchImpl: f }).conectar('nd-t1')).toEqual({ estado: 'qr', qr });
    expect(JSON.parse(String(chamadas[1].init.body))).toMatchObject({ instanceName: 'nd-t1', integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true, readMessages: false, syncFullHistory: false });
    expect(JSON.parse(String(chamadas[2].init.body))).toEqual({
      webhook: { enabled: true, url: config.webhookUrl, headers: { jwt_key: chaveDoWebhook(config.webhookSecret, 'nd-t1') }, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] },
    });
    expect(String(chamadas[2].init.body)).not.toContain(config.webhookSecret); // o segredo-mestre nunca sai do app
  });

  it('conectar já conectado → "conectada"; estado pelo fetchInstances com o número; erro do serviço não vaza a chave', async () => {
    const { f } = fetchFalso({
      'GET /instance/connectionState/nd-t1': { status: 200, body: { instance: { instanceName: 'nd-t1', state: 'open' } } },
      'POST /webhook/set/nd-t1': { status: 201, body: {} },
      'GET /instance/connect/nd-t1': { status: 200, body: { instance: { instanceName: 'nd-t1', state: 'open' } } },
      'GET /instance/fetchInstances': { status: 200, body: [{ name: 'nd-t1', connectionStatus: 'open', ownerJid: '5511912345678@s.whatsapp.net', token: 'segredo-da-instancia' }] },
    });
    const p = evolutionProvedor({ ...config, fetchImpl: f });
    expect(await p.conectar('nd-t1')).toEqual({ estado: 'conectada' });
    expect(await p.estado('nd-t1')).toEqual({ estado: 'conectada', numero: '+5511912345678' });
    // só a linha desta instância: outra instância na resposta (filtro ignorado) não empresta o número
    const outra = fetchFalso({ 'GET /instance/fetchInstances': { status: 200, body: [{ name: 'nd-t2', connectionStatus: 'open', ownerJid: '5511988887777@s.whatsapp.net' }] } });
    expect(await evolutionProvedor({ ...config, fetchImpl: outra.f }).estado('nd-t1')).toEqual({ estado: 'desconectada', numero: null });
    expect(outra.chamadas[0].url).toBe('http://evo:8080/instance/fetchInstances?instanceName=nd-t1');
    const quebrado = evolutionProvedor({ ...config, fetchImpl: fetchFalso({ 'GET /instance/connectionState/nd-t1': { status: 500 } }).f });
    const erro = await quebrado.conectar('nd-t1').catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(String((erro as Error).message)).not.toContain(config.apiKey);
  });
});
