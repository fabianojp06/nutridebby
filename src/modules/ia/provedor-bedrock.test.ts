import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PedidoGeracao, PedidoLeitura } from './provedor';
import { classificarErroBedrock, LIMITE_PEDIDO_BEDROCK_BYTES, PERFIL_BEDROCK_EU, provedorBedrock, TIMEOUT_MS } from './provedor-bedrock';

// Nenhuma chamada sai da máquina: todo teste passa um fetch falso. As chaves são de mentira (só o formato).
const CHAVES = { accessKeyId: 'AKIA' + 'T'.repeat(16), secretAccessKey: 's'.repeat(40) };
const pedido: PedidoLeitura = {
  modelo: 'claude-sonnet-5-5', geo: 'eu', sistema: 'SISTEMA', instrucao: 'INSTRUCAO',
  arquivo: { tipo: 'pdf', base64: 'JVBERi0xLjcK', paginas: 1 },
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] }, maxTokens: 16_000, esforco: 'low',
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
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', 'x-amzn-requestid': 'aws-req-1', ...extra } });
const mensagem = (texto: string, stop = 'end_turn') =>
  json(200, {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: texto }],
    stop_reason: stop, stop_details: null, stop_sequence: null, usage: { input_tokens: 9_000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });
const novo = (f: typeof fetch, extra: { timeoutMs?: number } = {}) => provedorBedrock({ regiao: 'eu-central-1', ...CHAVES, fetch: f, ...extra });

const AMBIENTE = ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION', 'ANTHROPIC_BEDROCK_BASE_URL', 'AWS_PROFILE', 'AWS_SESSION_TOKEN'] as const;
afterEach(() => {
  for (const v of AMBIENTE) delete process.env[v];
});

describe('provedor Bedrock na UE (INT-08, D1, D2) — só contra fetch falso', () => {
  it('InvokeModel do perfil eu. na região dada: PDF inline em base64, output_config, anthropic_version; sem model no corpo, sem inference_geo, sem thinking/ferramentas', async () => {
    const { f, chamadas } = fetchFalso([() => mensagem('{"ok":true}')]);
    const p = novo(f);
    expect(p).toMatchObject({ nome: 'bedrock-eu', destino: 'bedrock-eu', limitePedidoBytes: LIMITE_PEDIDO_BEDROCK_BYTES });
    const r = await p.lerDocumento(pedido);
    expect(r).toMatchObject({ tipo: 'ok', texto: '{"ok":true}', requestId: 'aws-req-1', uso: { entrada: 9_000, saida: 800, geo: 'eu' } });
    const { url, corpo, cabecalhos } = chamadas[0];
    expect(url).toBe(`https://bedrock-runtime.eu-central-1.amazonaws.com/model/${PERFIL_BEDROCK_EU['claude-sonnet-5-5']}/invoke`);
    expect(corpo).toMatchObject({
      anthropic_version: 'bedrock-2023-05-31', max_tokens: 16_000, system: 'SISTEMA',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: pedido.schema } },
      messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjcK' } }, { type: 'text', text: 'INSTRUCAO' }] }],
    });
    for (const proibido of ['model', 'inference_geo', 'thinking', 'tools', 'tool_choice', 'fallbacks', 'speed', 'stream', 'anthropic_beta']) expect(corpo, proibido).not.toHaveProperty(proibido);
    expect(cabecalhos.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATTTTTTTTTTTTTTTT\/\d{8}\/eu-central-1\/bedrock\/aws4_request/);
    expect(cabecalhos.get('anthropic-beta')).toBeNull();
  });

  it('D2: AWS_BEARER_TOKEN_BEDROCK, AWS_REGION e ANTHROPIC_BEDROCK_BASE_URL do ambiente não mudam a credencial, a região nem o destino', async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'token-do-ambiente';
    process.env.AWS_REGION = 'us-east-1';
    process.env.ANTHROPIC_BEDROCK_BASE_URL = 'http://outro.invalid';
    process.env.AWS_PROFILE = 'perfil-do-ambiente';
    const { f, chamadas } = fetchFalso([() => mensagem('{}')]);
    await novo(f).lerDocumento(pedido);
    expect(new URL(chamadas[0].url).host).toBe('bedrock-runtime.eu-central-1.amazonaws.com');
    const auth = chamadas[0].cabecalhos.get('authorization') ?? '';
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(auth).toContain('/eu-central-1/bedrock/aws4_request');
    expect(auth).not.toContain('token-do-ambiente');
  });

  it('D3: modelo fora do perfil eu. ou região que não é eu → ErroProvedor, sem chamada', async () => {
    const { f, chamadas } = fetchFalso([]);
    await expect(novo(f).lerDocumento({ ...pedido, modelo: 'claude-opus-5-5' })).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'pedido_invalido' });
    await expect(novo(f).lerDocumento({ ...pedido, geo: 'us' })).rejects.toMatchObject({ tipo: 'pedido_invalido' });
    expect(chamadas).toHaveLength(0);
    // a mesma regra exposta ao job, que a confere antes do portão do envio (revisão da T3)
    const p = novo(f);
    expect(p.aceita('claude-sonnet-5-5', 'eu')).toBe(true);
    expect(p.aceita('claude-opus-5-5', 'eu')).toBe(false);
    expect(p.aceita('claude-sonnet-5-5', 'us')).toBe(false);
    expect(p.aceita('claude-sonnet-5-5', 'global')).toBe(false);
  });

  it('recusa e saída cortada viram resultado (sem lançar); foto vai como image/jpeg', async () => {
    const { f, chamadas } = fetchFalso([() => mensagem('', 'refusal'), () => mensagem('{"x":', 'max_tokens'), () => mensagem('{}')]);
    const p = novo(f);
    expect(await p.lerDocumento(pedido)).toMatchObject({ tipo: 'recusa' });
    expect(await p.lerDocumento(pedido)).toMatchObject({ tipo: 'cortada' });
    await p.lerDocumento({ ...pedido, arquivo: { tipo: 'imagem', base64: '/9j/4AAQ' } });
    expect((chamadas[2].corpo.messages as { content: unknown[] }[])[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } });
  });

  it.each([
    [403, 'credencial'], [401, 'credencial'], [413, 'grande_demais'], [429, 'repetir'], [500, 'repetir'], [503, 'repetir'],
    [408, 'incerto'], [424, 'incerto'], [504, 'incerto'], [400, 'pedido_invalido'], [404, 'pedido_invalido'],
  ])('HTTP %i → %s, uma chamada só (maxRetries 0) e sem o texto do provedor', async (status, tipo) => {
    const { f, chamadas } = fetchFalso([() => json(status, { message: 'mensagem da AWS que pode ecoar o pedido' }, { 'x-amzn-errortype': 'QualquerException' })]);
    const erro = await novo(f).lerDocumento(pedido).catch((e: unknown) => e);
    expect(erro).toMatchObject({ name: 'ErroProvedor', tipo, status, requestId: 'aws-req-1' });
    expect(String((erro as Error).message)).not.toContain('ecoar');
    expect(chamadas).toHaveLength(1);
  });

  it('tempo esgotado depois do envio → incerto, uma chamada só', async () => {
    let n = 0;
    const lento: typeof fetch = (_e, init) => {
      n++;
      return new Promise((_r, rejeitar) => init?.signal?.addEventListener('abort', () => rejeitar(Object.assign(new Error('abortado'), { name: 'AbortError' }))));
    };
    await expect(novo(lento, { timeoutMs: 50 }).lerDocumento(pedido)).rejects.toMatchObject({ tipo: 'incerto' });
    expect(n).toBe(1);
  });

  it('classificarErroBedrock: erro desconhecido → incerto (nunca repete o que pode ter sido processado)', () => {
    expect(classificarErroBedrock(new Error('qualquer'))).toMatchObject({ tipo: 'incerto', status: null });
  });
});

const pedidoGeracao: PedidoGeracao = {
  finalidade: 'rascunho', modelo: 'claude-sonnet-5-5', geo: 'eu', sistema: 'SISTEMA',
  turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'METAS' }] }],
  ferramentas: [{ nome: 'buscar_alimentos', descricao: 'Busca', schema: { type: 'object', additionalProperties: false, required: ['termo'], properties: { termo: { type: 'string' } } } }],
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] }, maxTokens: 16_000, esforco: 'medium',
};
const comFerramenta = () =>
  json(200, {
    id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'assinatura-opaca' }, { type: 'tool_use', id: 'toolu_1', name: 'buscar_alimentos', input: { termo: 'arroz' } }],
    stop_reason: 'tool_use', stop_details: null, stop_sequence: null,
    usage: { input_tokens: 2_000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });

describe('gerar no Bedrock (Plano 14B, D1): ferramentas strict com auto, sem inference_geo, histórico reenviado sem mudança', () => {
  it('InvokeModel do perfil eu.: tools com strict: true, tool_choice auto, output_config; sem model no corpo, inference_geo, thinking nem stream', async () => {
    const { f, chamadas } = fetchFalso([comFerramenta]);
    const r = await novo(f).gerar(pedidoGeracao);
    const { url, corpo } = chamadas[0];
    expect(url).toBe('https://bedrock-runtime.eu-central-1.amazonaws.com/model/eu.anthropic.claude-sonnet-5-5/invoke');
    expect(corpo.tools).toEqual([{ name: 'buscar_alimentos', description: 'Busca', input_schema: pedidoGeracao.ferramentas[0].schema, strict: true }]);
    expect(corpo.tool_choice).toEqual({ type: 'auto' });
    expect(corpo.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: pedidoGeracao.schema } });
    for (const proibido of ['model', 'inference_geo', 'thinking', 'stream', 'fallbacks', 'speed', 'anthropic_beta']) expect(corpo, proibido).not.toHaveProperty(proibido);
    expect(r).toMatchObject({ tipo: 'ferramentas', chamadas: [{ id: 'toolu_1', nome: 'buscar_alimentos', entrada: { termo: 'arroz' } }], requestId: 'aws-req-1', uso: { geo: 'eu' } });
  });

  it('reenvia o bruto do assistente sem mudança e os resultados como tool_result; sem ferramentas, nem tools nem tool_choice', async () => {
    const { f, chamadas } = fetchFalso([comFerramenta, () => mensagem('{"ok":true}'), () => mensagem('{}')]);
    const p = novo(f);
    const r1 = await p.gerar(pedidoGeracao);
    const r2 = await p.gerar({
      ...pedidoGeracao,
      turnos: [...pedidoGeracao.turnos, { papel: 'assistente', bruto: r1.bruto }, { papel: 'usuario', blocos: [{ tipo: 'resultado', chamadaId: 'toolu_1', conteudo: '[]' }] }],
    });
    const msgs = chamadas[1].corpo.messages as { role: string; content: unknown[] }[];
    expect(msgs[1]).toEqual({ role: 'assistant', content: r1.bruto });
    expect(msgs[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[]' }] });
    expect(r2).toMatchObject({ tipo: 'final', texto: '{"ok":true}' });
    await p.gerar({ ...pedidoGeracao, finalidade: 'resumo', ferramentas: [] });
    expect(chamadas[2].corpo).not.toHaveProperty('tools');
    expect(chamadas[2].corpo).not.toHaveProperty('tool_choice');
  });

  it('recusa, saída cortada e erro do provedor (RN-105, sem o texto do provedor)', async () => {
    const { f } = fetchFalso([() => mensagem('', 'refusal'), () => mensagem('{', 'max_tokens'), () => json(503, { message: 'mensagem da AWS que pode ecoar o pedido' })]);
    const p = novo(f);
    expect(await p.gerar(pedidoGeracao)).toMatchObject({ tipo: 'recusa' });
    expect(await p.gerar(pedidoGeracao)).toMatchObject({ tipo: 'cortada' });
    const erro = await p.gerar(pedidoGeracao).catch((e: unknown) => e);
    expect(erro).toMatchObject({ name: 'ErroProvedor', tipo: 'repetir', status: 503 });
    expect(String((erro as Error).message)).not.toContain('ecoar');
  });

  it('D3: modelo fora do perfil eu. ou região que não é eu → ErroProvedor(pedido_invalido), sem chamada', async () => {
    const { f, chamadas } = fetchFalso([]);
    await expect(novo(f).gerar({ ...pedidoGeracao, modelo: 'claude-opus-5-5' })).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'pedido_invalido' });
    await expect(novo(f).gerar({ ...pedidoGeracao, geo: 'us' })).rejects.toMatchObject({ tipo: 'pedido_invalido' });
    expect(chamadas).toHaveLength(0);
  });
});

describe('Plano 15 (RN-180): o prazo por pedido (prazoMs) também no Bedrock', () => {
  it('prazoMs: 45_000 aborta a chamada aos 45 s; sem prazoMs, só no TIMEOUT_MS (120 s); numa chamada só', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const sinais: AbortSignal[] = [];
      const pendurado: typeof fetch = (_u, init) => {
        sinais.push(init!.signal!);
        return new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('abortado'), { name: 'AbortError' }))));
      };
      const saiu = async (n: number) => {
        while (sinais.length < n) await new Promise((r) => setImmediate(r));
      };
      const p = novo(pendurado);

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
      expect(sinais).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
