import { describe, expect, it, vi } from 'vitest';
import type { PedidoGeracao, PedidoLeitura } from './provedor';
import { provedorAnthropic, TIMEOUT_MS } from './provedor-anthropic';

const CHAVE = 'sk-ant-api03-' + 'x'.repeat(40);
const pedido: PedidoLeitura = {
  modelo: 'claude-opus-5-5',
  geo: 'us',
  sistema: 'SISTEMA',
  instrucao: 'INSTRUCAO',
  arquivo: { tipo: 'pdf', base64: 'JVBERi0xLjcK', paginas: 1 },
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  maxTokens: 16_000,
  esforco: 'low',
};

type Chamada = { url: string; corpo: Record<string, unknown>; cabecalhos: Headers };
function fetchFalso(respostas: (() => Response | Promise<Response>)[]) {
  const chamadas: Chamada[] = [];
  const f: typeof fetch = async (entrada, init) => {
    const req = new Request(entrada as RequestInfo, init);
    chamadas.push({ url: req.url, corpo: JSON.parse(await req.text()), cabecalhos: req.headers });
    const r = respostas.shift();
    if (!r) throw new Error('chamada a mais');
    return r();
  };
  return { f, chamadas };
}
const json = (status: number, corpo: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_teste', ...extra } });
const mensagem = (texto: string, stop = 'end_turn', stopDetails: unknown = null) =>
  json(200, {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: texto }],
    stop_reason: stop, stop_details: stopDetails, stop_sequence: null,
    usage: { input_tokens: 12_000, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, inference_geo: 'us' },
  });
const erroApi = (status: number, tipo: string, extra: Record<string, unknown> = {}, cab: Record<string, string> = {}) =>
  json(status, { type: 'error', error: { type: tipo, message: 'mensagem do provedor que pode ecoar o pedido', ...extra } }, cab);

describe('provedor Anthropic (INT-07) — só contra fetch falso', () => {
  it('a requisição: PDF inline em base64, inference_geo us, effort low, json_schema; sem thinking, ferramentas, fallbacks nem betas', async () => {
    const { f, chamadas } = fetchFalso([() => mensagem('{"ok":true}')]);
    const r = await provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' }).lerDocumento(pedido);
    expect(r).toMatchObject({ tipo: 'ok', texto: '{"ok":true}', requestId: 'req_teste', uso: { entrada: 12_000, saida: 900, geo: 'us' } });
    const { url, corpo, cabecalhos } = chamadas[0];
    expect(url).toBe('http://ia.invalid/v1/messages');
    expect(corpo).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16_000,
      system: 'SISTEMA',
      inference_geo: 'us',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: pedido.schema } },
      messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjcK' } }, { type: 'text', text: 'INSTRUCAO' }] }],
    });
    for (const proibido of ['thinking', 'tools', 'tool_choice', 'fallbacks', 'speed', 'stream', 'metadata']) expect(corpo, proibido).not.toHaveProperty(proibido);
    expect(cabecalhos.get('x-api-key')).toBe(CHAVE);
    expect(cabecalhos.get('anthropic-beta')).toBeNull();
  });

  it('a foto vai como image/jpeg base64', async () => {
    const { f, chamadas } = fetchFalso([() => mensagem('{}')]);
    await provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' }).lerDocumento({ ...pedido, arquivo: { tipo: 'imagem', base64: '/9j/4AAQ' } });
    expect((chamadas[0].corpo.messages as { content: unknown[] }[])[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } });
  });

  it('baseURL fixo: ANTHROPIC_BASE_URL, ANTHROPIC_LOG e ANTHROPIC_AUTH_TOKEN do ambiente não mudam o destino, o log nem a credencial', async () => {
    const antes = { url: process.env.ANTHROPIC_BASE_URL, log: process.env.ANTHROPIC_LOG, token: process.env.ANTHROPIC_AUTH_TOKEN };
    process.env.ANTHROPIC_BASE_URL = 'http://outro.invalid';
    process.env.ANTHROPIC_LOG = 'debug';
    process.env.ANTHROPIC_AUTH_TOKEN = 'token-do-ambiente';
    try {
      const { f, chamadas } = fetchFalso([() => mensagem('{}')]);
      await provedorAnthropic({ apiKey: CHAVE, fetch: f }).lerDocumento(pedido); // fetch falso: nada sai da máquina
      expect(chamadas[0].url).toBe('https://api.anthropic.com/v1/messages');
      expect(chamadas[0].cabecalhos.get('authorization')).toBeNull();
    } finally {
      if (antes.url === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = antes.url;
      if (antes.log === undefined) delete process.env.ANTHROPIC_LOG;
      else process.env.ANTHROPIC_LOG = antes.log;
      if (antes.token === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = antes.token;
    }
  });

  it('recusa e saída cortada são lidas pelo stop_reason (antes do JSON)', async () => {
    const { f } = fetchFalso([() => mensagem('', 'refusal', { type: 'refusal', category: 'bio', explanation: 'x' }), () => mensagem('{"marcad', 'max_tokens')]);
    const p = provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' });
    expect(await p.lerDocumento(pedido)).toMatchObject({ tipo: 'recusa', categoria: 'bio' });
    expect(await p.lerDocumento(pedido)).toMatchObject({ tipo: 'cortada' });
  });

  it.each([
    ['429 com retry-after', () => erroApi(429, 'rate_limit_error', {}, { 'retry-after': '20' }), 'repetir', 429],
    ['500', () => erroApi(500, 'api_error'), 'repetir', 500],
    ['529', () => erroApi(529, 'overloaded_error'), 'repetir', 529],
    ['504', () => erroApi(504, 'timeout_error'), 'incerto', 504],
    ['429 teto de gasto do tier', () => erroApi(429, 'rate_limit_error', { details: { error_code: 'enforced_spend_limit_reached' } }), 'limite_de_gasto', 429],
    ['400 limite do workspace', () => json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified workspace API usage limits' } }), 'limite_de_gasto', 400],
    ['401', () => erroApi(401, 'authentication_error'), 'credencial', 401],
    ['402', () => erroApi(402, 'billing_error'), 'credencial', 402],
    ['403', () => erroApi(403, 'permission_error'), 'credencial', 403],
    ['413', () => erroApi(413, 'request_too_large'), 'grande_demais', 413],
    ['400 comum', () => erroApi(400, 'invalid_request_error'), 'pedido_invalido', 400],
  ])('RN-105: %s → %s, numa chamada só (maxRetries 0), sem o texto do provedor', async (_n, resposta, tipo, status) => {
    const { f, chamadas } = fetchFalso([resposta, resposta, resposta]);
    const erro = await provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' }).lerDocumento(pedido).catch((e: unknown) => e);
    expect(erro).toMatchObject({ name: 'ErroProvedor', tipo, status });
    expect(String((erro as Error).message)).not.toContain('ecoar');
    expect(chamadas).toHaveLength(1);
  });

  it('tempo esgotado depois do envio → incerto, numa chamada só', async () => {
    // R3: o timeout do SDK só aborta o sinal; o fetch falso precisa respeitá-lo (como o fetch real)
    let chamadas = 0;
    const f: typeof fetch = (_u, init) => {
      chamadas++;
      return new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    };
    const erro = await provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid', timeoutMs: 50 }).lerDocumento(pedido).catch((e: unknown) => e);
    expect(erro).toMatchObject({ name: 'ErroProvedor', tipo: 'incerto' });
    expect(chamadas).toBe(1);
  });

  it('conexão recusada antes do envio → nao_enviado; outra falha de conexão → incerto', async () => {
    const recusada = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
    const cortada = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) });
    const p1 = provedorAnthropic({ apiKey: CHAVE, fetch: async () => Promise.reject(recusada), baseURL: 'http://ia.invalid' });
    const p2 = provedorAnthropic({ apiKey: CHAVE, fetch: async () => Promise.reject(cortada), baseURL: 'http://ia.invalid' });
    expect(await p1.lerDocumento(pedido).catch((e: unknown) => e)).toMatchObject({ tipo: 'nao_enviado' });
    expect(await p2.lerDocumento(pedido).catch((e: unknown) => e)).toMatchObject({ tipo: 'incerto' });
  });

  it('Plano 14A (D5): geo eu (do Bedrock) nunca vai à API direta — pedido inválido, sem chamada', async () => {
    const { f, chamadas } = fetchFalso([]);
    const p = provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' });
    expect(p).toMatchObject({ nome: 'anthropic', destino: 'anthropic-us', limitePedidoBytes: 32 * 1024 * 1024 });
    await expect(p.lerDocumento({ ...pedido, geo: 'eu' })).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'pedido_invalido' });
    expect(chamadas).toHaveLength(0);
    // a mesma regra exposta ao job, que a confere antes do portão do envio (revisão da T3)
    expect(p.aceita('claude-opus-5-5', 'eu')).toBe(false);
    expect(p.aceita('claude-opus-5-5', 'us')).toBe(true);
    expect(p.aceita('claude-opus-5-5', 'global')).toBe(true);
  });
});

const pedidoGeracao: PedidoGeracao = {
  finalidade: 'rascunho', modelo: 'claude-sonnet-5-5', geo: 'us', sistema: 'SISTEMA',
  turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'METAS' }] }],
  ferramentas: [{ nome: 'buscar_alimentos', descricao: 'Busca', schema: { type: 'object', additionalProperties: false, required: ['termo'], properties: { termo: { type: 'string' } } } }],
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] }, maxTokens: 16_000, esforco: 'medium',
};
const comFerramenta = () =>
  json(200, {
    id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'assinatura-opaca' }, { type: 'tool_use', id: 'toolu_1', name: 'buscar_alimentos', input: { termo: 'arroz' } }],
    stop_reason: 'tool_use', stop_details: null, stop_sequence: null,
    usage: { input_tokens: 2_000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, inference_geo: 'us' },
  });

describe('gerar (Plano 14B, D1): ferramentas strict com auto, saída estruturada, histórico reenviado sem mudança', () => {
  it('manda tools com strict: true, tool_choice auto, output_config com esforço e schema; sem thinking, stream nem fallbacks', async () => {
    const { f, chamadas } = fetchFalso([comFerramenta]);
    const r = await provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' }).gerar(pedidoGeracao);
    const c = chamadas[0].corpo;
    expect(c.tools).toEqual([{ name: 'buscar_alimentos', description: 'Busca', input_schema: pedidoGeracao.ferramentas[0].schema, strict: true }]);
    expect(c.tool_choice).toEqual({ type: 'auto' });
    expect(c.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: pedidoGeracao.schema } });
    expect(c.inference_geo).toBe('us');
    for (const proibido of ['thinking', 'stream', 'fallbacks', 'betas', 'speed']) expect(c).not.toHaveProperty(proibido);
    expect(r).toMatchObject({ tipo: 'ferramentas', chamadas: [{ id: 'toolu_1', nome: 'buscar_alimentos', entrada: { termo: 'arroz' } }], requestId: 'req_teste' });
  });

  it('reenvia o bruto do assistente sem mudança (raciocínio e assinatura) e os resultados como tool_result', async () => {
    const { f, chamadas } = fetchFalso([comFerramenta, () => mensagem('{"ok":true}')]);
    const p = provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' });
    const r1 = await p.gerar(pedidoGeracao);
    const r2 = await p.gerar({
      ...pedidoGeracao,
      turnos: [...pedidoGeracao.turnos, { papel: 'assistente', bruto: r1.bruto }, { papel: 'usuario', blocos: [{ tipo: 'resultado', chamadaId: 'toolu_1', conteudo: '[]', erro: true }] }],
    });
    const msgs = chamadas[1].corpo.messages as { role: string; content: unknown[] }[];
    expect(msgs[1]).toEqual({ role: 'assistant', content: r1.bruto });
    expect(msgs[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[]', is_error: true }] });
    expect(r2).toMatchObject({ tipo: 'final', texto: '{"ok":true}' });
  });

  it('recusa, saída cortada e erro do provedor como na leitura (RN-105, sem o texto do provedor)', async () => {
    const { f } = fetchFalso([() => mensagem('', 'refusal', { type: 'refusal', category: 'bio' }), () => mensagem('{', 'max_tokens'), () => erroApi(529, 'overloaded_error')]);
    const p = provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' });
    expect(await p.gerar(pedidoGeracao)).toMatchObject({ tipo: 'recusa', categoria: 'bio' });
    expect(await p.gerar(pedidoGeracao)).toMatchObject({ tipo: 'cortada' });
    await expect(p.gerar(pedidoGeracao)).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'repetir', status: 529 });
  });

  it('sem ferramentas (resumo): não manda tools nem tool_choice', async () => {
    const { f, chamadas } = fetchFalso([() => mensagem('{}')]);
    await provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' }).gerar({ ...pedidoGeracao, finalidade: 'resumo', ferramentas: [] });
    expect(chamadas[0].corpo).not.toHaveProperty('tools');
    expect(chamadas[0].corpo).not.toHaveProperty('tool_choice');
  });

  it('geo eu (do Bedrock) nunca vai à API direta — pedido inválido, sem chamada', async () => {
    const { f, chamadas } = fetchFalso([]);
    await expect(provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' }).gerar({ ...pedidoGeracao, geo: 'eu' })).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'pedido_invalido' });
    expect(chamadas).toHaveLength(0);
  });
});

describe('Plano 15 (RN-180): o prazo por pedido (prazoMs) — a IA Nutri espera 45 s; sem ele, o prazo do cliente', () => {
  it('prazoMs: 45_000 aborta a chamada aos 45 s; sem prazoMs, só no TIMEOUT_MS (120 s); numa chamada só, sem nova tentativa', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const sinais: AbortSignal[] = [];
      const pendurado: typeof fetch = (_u, init) => {
        sinais.push(init!.signal!);
        return new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      };
      // o SDK arma o prazo só ao chamar o fetch: espera a chamada sair (setImmediate não é falsificado)
      const saiu = async (n: number) => {
        while (sinais.length < n) await new Promise((r) => setImmediate(r));
      };
      const p = provedorAnthropic({ apiKey: CHAVE, fetch: pendurado, baseURL: 'http://ia.invalid' });

      const comPrazo = p.gerar({ ...pedidoGeracao, finalidade: 'conversa_paciente', ferramentas: [], prazoMs: 45_000 }).catch((e: unknown) => e);
      await saiu(1);
      await vi.advanceTimersByTimeAsync(44_999);
      expect(sinais[0].aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(sinais[0].aborted).toBe(true);
      expect(await comPrazo).toMatchObject({ name: 'ErroProvedor', tipo: 'incerto' });

      const semPrazo = p.gerar(pedidoGeracao).catch((e: unknown) => e);
      await saiu(2);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
      expect(sinais[1].aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await semPrazo).toMatchObject({ name: 'ErroProvedor', tipo: 'incerto' });
      expect(sinais).toHaveLength(2); // maxRetries 0 continua: o prazo por pedido não abre nova tentativa
    } finally {
      vi.useRealTimers();
    }
  });

  it('o prazo vai como opção do cliente, nunca no corpo do pedido', async () => {
    const { f, chamadas } = fetchFalso([() => mensagem('{}')]);
    await provedorAnthropic({ apiKey: CHAVE, fetch: f, baseURL: 'http://ia.invalid' }).gerar({ ...pedidoGeracao, ferramentas: [], prazoMs: 45_000 });
    for (const proibido of ['timeout', 'prazoMs', 'prazo_ms']) expect(chamadas[0].corpo).not.toHaveProperty(proibido);
  });
});
