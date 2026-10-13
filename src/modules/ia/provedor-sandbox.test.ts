import { describe, expect, it } from 'vitest';
import { ErroProvedor, type FerramentaIA, type PedidoGeracao, type PedidoLeitura } from './provedor';
import { finalOk, pedeFerramenta, provedorFake, respostaOk } from './provedor-fake';
import { provedorSandbox, RESPOSTA_SANDBOX } from './provedor-sandbox';

const pedido = (base64 = 'JVBERi0x'): PedidoLeitura => ({
  modelo: 'claude-opus-5-5',
  geo: 'us',
  sistema: 'S',
  instrucao: 'I',
  arquivo: { tipo: 'pdf', base64, paginas: 2 },
  schema: {},
  maxTokens: 16_000,
  esforco: 'low',
});

const FERRAMENTAS_SANDBOX: FerramentaIA[] = [{ nome: 'buscar_alimentos', descricao: '', schema: {} }, { nome: 'calcular_plano', descricao: '', schema: {} }];

describe('provedor sandbox (RNF-107: dev, CI e E2E sem a API real)', () => {
  it('responde sempre o mesmo JSON, com os casos da US-111 (série existente, ambíguo, não numérico, milhar e decimal)', async () => {
    const p = provedorSandbox();
    const r = await p.lerDocumento(pedido());
    expect(r.tipo).toBe('ok');
    if (r.tipo !== 'ok') return;
    expect(JSON.parse(r.texto)).toEqual(RESPOSTA_SANDBOX);
    const valores = RESPOSTA_SANDBOX.marcadores.map((m) => m.valor_texto);
    expect(valores).toEqual(expect.arrayContaining(['250.000', 'Não reagente', '1.234,5', '92']));
    expect(r.uso).toMatchObject({ entrada: expect.any(Number), saida: expect.any(Number), geo: 'us' });
    expect(r.requestId).toMatch(/^sandbox-/);
  });

  it('gerar (Plano 14B): resumo cita #1; rascunho busca e depois devolve o plano com o primeiro alimento encontrado; sem rede', async () => {
    const s = provedorSandbox();
    const base = { modelo: 'claude-sonnet-5-5' as const, geo: 'us' as const, sistema: 'S', schema: {}, maxTokens: 16_000, esforco: 'low' as const };
    const resumo = await s.gerar({ ...base, finalidade: 'resumo', ferramentas: [], turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: '{"medidas":[{"indice":"#1"}]}' }] }] });
    expect(resumo.tipo).toBe('final');
    expect(JSON.parse((resumo as { texto: string }).texto).secoes[0].frases[0].fontes).toEqual(['#1']);
    const r1 = await s.gerar({ ...base, finalidade: 'rascunho', ferramentas: FERRAMENTAS_SANDBOX, turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'metas' }] }] });
    expect(r1).toMatchObject({ tipo: 'ferramentas', chamadas: [{ nome: 'buscar_alimentos' }] });
    const achados = JSON.stringify([{ id: 'A1', nome: 'Arroz, tipo 1, cozido', medidas: [] }]);
    const r2 = await s.gerar({
      ...base, finalidade: 'rascunho', ferramentas: FERRAMENTAS_SANDBOX,
      turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'metas' }] }, { papel: 'assistente', bruto: r1.bruto }, { papel: 'usuario', blocos: [{ tipo: 'resultado', chamadaId: (r1 as { chamadas: { id: string }[] }).chamadas[0].id, conteudo: achados }] }],
    });
    expect(JSON.parse((r2 as { texto: string }).texto).refeicoes[0].itens[0].alimento).toBe('A1');
  });

  it('gerar (Plano 14B): o pacote de modelos devolve dois planos e uma anamnese com o alimento encontrado', async () => {
    const s = provedorSandbox();
    const base = { modelo: 'claude-sonnet-5-5' as const, geo: 'us' as const, sistema: 'S', schema: {}, maxTokens: 16_000, esforco: 'medium' as const, ferramentas: FERRAMENTAS_SANDBOX };
    const r1 = await s.gerar({ ...base, finalidade: 'modelos', turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'area' }] }] });
    expect(r1.tipo).toBe('ferramentas');
    const r2 = await s.gerar({
      ...base, finalidade: 'modelos',
      turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'area' }] }, { papel: 'assistente', bruto: r1.bruto }, { papel: 'usuario', blocos: [{ tipo: 'resultado', chamadaId: (r1 as { chamadas: { id: string }[] }).chamadas[0].id, conteudo: '[{"id":"A2"}]' }] }],
    });
    const pacote = JSON.parse((r2 as { texto: string }).texto);
    expect(pacote.planos).toHaveLength(2);
    expect(pacote.planos[1].refeicoes[0].itens[0].alimento).toBe('A2');
    expect(pacote.anamnese.perguntas.length).toBeGreaterThan(0);
  });
});

describe('provedor falso (testes)', () => {
  it('segue o roteiro na ordem e registra as chamadas; erro do roteiro é lançado', async () => {
    const f = provedorFake({ ler: [respostaOk({ documento_reconhecido: true, data_coleta: null, marcadores: [] }), new ErroProvedor('repetir', 529, 'req-1')] });
    expect((await f.lerDocumento(pedido())).tipo).toBe('ok');
    await expect(f.lerDocumento(pedido())).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'repetir', status: 529 });
    expect(f.chamadas.ler).toHaveLength(2);
  });

  it('gerar (Plano 14B): segue o roteiro, registra os pedidos e, sem roteiro, delega ao sandbox', async () => {
    const pedidoG: PedidoGeracao = {
      finalidade: 'rascunho', modelo: 'claude-sonnet-5-5', geo: 'us', sistema: 'S', schema: {}, maxTokens: 16_000, esforco: 'medium', ferramentas: FERRAMENTAS_SANDBOX,
      turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: 'metas' }] }],
    };
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk({ ok: true }), new ErroProvedor('incerto', null, null)] });
    expect(await f.gerar(pedidoG)).toMatchObject({ tipo: 'ferramentas', chamadas: [{ id: 'fake-buscar_alimentos', nome: 'buscar_alimentos', entrada: { termo: 'arroz' } }] });
    expect(await f.gerar(pedidoG)).toMatchObject({ tipo: 'final', texto: '{"ok":true}', bruto: [{ type: 'text', text: '{"ok":true}' }] });
    await expect(f.gerar(pedidoG)).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'incerto' });
    expect(await f.gerar(pedidoG)).toMatchObject({ tipo: 'ferramentas', requestId: 'sandbox-gerar' });
    expect(f.chamadas.gerar).toHaveLength(4);
  });

  it('sem roteiro, devolve a resposta do sandbox (para IA_PROVEDOR=fake em dev)', async () => {
    const r = await provedorFake().lerDocumento(pedido());
    expect(r.tipo === 'ok' && JSON.parse(r.texto)).toEqual(RESPOSTA_SANDBOX);
  });
});
