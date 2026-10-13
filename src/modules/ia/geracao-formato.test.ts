import { describe, expect, it } from 'vitest';
import { mensagensDaGeracao, respostaDaGeracao, type RespostaNaApi } from './geracao-formato';
import type { PedidoGeracao, ProvedorIA, TurnoIA, UsoTokens } from './provedor';
import { provedorAnthropic } from './provedor-anthropic';
import { provedorBedrock } from './provedor-bedrock';

const USO: UsoTokens = { entrada: 10, cacheLeitura: 0, cacheGravacao: 0, saida: 5, geo: 'us' };
const resp = (stop_reason: string | null, content: RespostaNaApi['content'], stop_details: RespostaNaApi['stop_details'] = null): RespostaNaApi => ({ stop_reason, stop_details, content });

describe('geracao-formato (Plano 14B, D1): o histórico e a classificação comuns aos dois provedores', () => {
  it('mensagensDaGeracao: o bruto do assistente volta igual; o usuário leva texto e resultados (is_error só no erro)', () => {
    const bruto = [{ type: 'thinking', thinking: 'x', signature: 'sig' }, { type: 'tool_use', id: 'tu_1', name: 'buscar_alimentos', input: { termo: 'arroz' } }];
    const turnos: TurnoIA[] = [
      { papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'oi' }] },
      { papel: 'assistente', bruto },
      { papel: 'usuario', blocos: [{ tipo: 'resultado', chamadaId: 'tu_1', conteudo: '[]' }, { tipo: 'resultado', chamadaId: 'tu_2', conteudo: 'falhou', erro: true }] },
    ];
    const m = mensagensDaGeracao(turnos);
    expect(m).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'oi' }] },
      { role: 'assistant', content: bruto },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '[]' }, { type: 'tool_result', tool_use_id: 'tu_2', content: 'falhou', is_error: true }] },
    ]);
    expect(m[1].content).toBe(bruto);
    expect(m[2].content[0]).not.toHaveProperty('is_error');
  });

  it('respostaDaGeracao: final, ferramentas, recusa e cortada; tool_use sem chamada válida é cortada', () => {
    expect(respostaDaGeracao(resp('end_turn', [{ type: 'text', text: '{"a":' }, { type: 'thinking' }, { type: 'text', text: '1}' }]), USO, 'r1')).toEqual({
      tipo: 'final', texto: '{"a":1}', bruto: [{ type: 'text', text: '{"a":' }, { type: 'thinking' }, { type: 'text', text: '1}' }], uso: USO, requestId: 'r1',
    });
    expect(respostaDaGeracao(resp('tool_use', [{ type: 'text', text: 'vou buscar' }, { type: 'tool_use', id: 'tu_1', name: 'buscar_alimentos', input: { termo: 'arroz' } }]), USO, null)).toMatchObject({
      tipo: 'ferramentas', chamadas: [{ id: 'tu_1', nome: 'buscar_alimentos', entrada: { termo: 'arroz' } }],
    });
    expect(respostaDaGeracao(resp('refusal', [], { category: 'bio' }), USO, null)).toMatchObject({ tipo: 'recusa', categoria: 'bio' });
    expect(respostaDaGeracao(resp('refusal', []), USO, null)).toMatchObject({ tipo: 'recusa', categoria: null });
    for (const stop of ['max_tokens', 'pause_turn', 'stop_sequence', 'model_context_window_exceeded', null]) {
      expect(respostaDaGeracao(resp(stop, [{ type: 'text', text: 'meio' }]), USO, null), String(stop)).toMatchObject({ tipo: 'cortada' });
    }
    expect(respostaDaGeracao(resp('tool_use', [{ type: 'text', text: 'nada' }]), USO, null)).toMatchObject({ tipo: 'cortada' });
    expect(respostaDaGeracao(resp('tool_use', [{ type: 'tool_use', name: 'sem_id', input: {} }]), USO, null)).toMatchObject({ tipo: 'cortada' });
  });
});

// Paridade: os mesmos casos de resposta pelos dois provedores reais (só fetch falso; nenhuma chamada sai da máquina)
type Caso = { nome: string; corpo: { stop_reason: string; stop_details: unknown; content: unknown[] } };
const CASOS: Caso[] = [
  { nome: 'final', corpo: { stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: '{"ok":true}' }] } },
  { nome: 'ferramentas', corpo: { stop_reason: 'tool_use', stop_details: null, content: [{ type: 'thinking', thinking: 'x', signature: 'sig' }, { type: 'tool_use', id: 'tu_1', name: 'buscar_alimentos', input: { termo: 'arroz' } }] } },
  { nome: 'tool_use sem chamada', corpo: { stop_reason: 'tool_use', stop_details: null, content: [{ type: 'text', text: 'nada' }] } },
  { nome: 'recusa', corpo: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio', explanation: null }, content: [] } },
  { nome: 'cortada', corpo: { stop_reason: 'max_tokens', stop_details: null, content: [{ type: 'text', text: '{"ok":' }] } },
];
const corpoDaMensagem = (c: Caso['corpo']) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...c,
});
function comFetchFalso(corpos: unknown[]) {
  const enviados: unknown[] = [];
  const f: typeof fetch = async (entrada, init) => {
    const req = new Request(entrada as RequestInfo, init);
    enviados.push((JSON.parse(await req.text()) as { messages: unknown }).messages);
    const c = corpos.shift();
    if (!c) throw new Error('chamada a mais');
    return new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, enviados };
}
const pedido = (geo: 'us' | 'eu'): PedidoGeracao => ({
  finalidade: 'modelos', modelo: 'claude-sonnet-5-5', geo, sistema: 'SISTEMA', esforco: 'low', maxTokens: 1_000,
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  ferramentas: [{ nome: 'buscar_alimentos', descricao: 'busca', schema: { type: 'object', additionalProperties: false, properties: {}, required: [] } }],
  turnos: [
    { papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'monte' }] },
    { papel: 'assistente', bruto: [{ type: 'thinking', thinking: 'x', signature: 'sig' }, { type: 'tool_use', id: 'tu_0', name: 'buscar_alimentos', input: {} }] },
    { papel: 'usuario', blocos: [{ tipo: 'resultado', chamadaId: 'tu_0', conteudo: 'falhou', erro: true }] },
  ],
});
const PROVEDORES: { nome: string; novo: (f: typeof fetch) => ProvedorIA; geo: 'us' | 'eu' }[] = [
  { nome: 'anthropic', geo: 'us', novo: (f) => provedorAnthropic({ apiKey: 'sk-ant-api03-' + 'x'.repeat(40), fetch: f, baseURL: 'http://ia.invalid' }) },
  { nome: 'bedrock-eu', geo: 'eu', novo: (f) => provedorBedrock({ regiao: 'eu-central-1', accessKeyId: 'AKIA' + 'T'.repeat(16), secretAccessKey: 's'.repeat(40), fetch: f }) },
];

describe('paridade dos provedores reais no gerar (Plano 14B, D1)', () => {
  it('o mesmo histórico enviado e a mesma classificação de cada resposta, nos dois provedores', async () => {
    const porProvedor = await Promise.all(
      PROVEDORES.map(async (pv) => {
        const { f, enviados } = comFetchFalso(CASOS.map((c) => corpoDaMensagem(c.corpo)));
        const p = pv.novo(f);
        const respostas = [];
        for (let i = 0; i < CASOS.length; i++) {
          const r = await p.gerar(pedido(pv.geo));
          // o uso e o request-id vêm de cada provedor (geo da região, cabeçalho da AWS); o resto tem de ser igual
          respostas.push({ ...r, uso: null, requestId: null });
        }
        return { enviados, respostas };
      }),
    );
    const [anthropic, bedrock] = porProvedor;
    expect(bedrock.enviados).toEqual(anthropic.enviados);
    expect(anthropic.enviados[0]).toEqual(mensagensDaGeracao(pedido('us').turnos));
    expect(bedrock.respostas).toEqual(anthropic.respostas);
    expect(anthropic.respostas.map((r) => r.tipo)).toEqual(['final', 'ferramentas', 'cortada', 'recusa', 'cortada']);
  });
});
