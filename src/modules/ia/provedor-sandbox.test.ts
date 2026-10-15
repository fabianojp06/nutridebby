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

describe('gerar da conversa do paciente (Plano 15, DP-12, RNF-168): respostas fixas por marcador na pergunta', () => {
  const pedidoConversa = (pergunta: string, indices = ['#R1', '#I1', '#S1', '#O1']): PedidoGeracao => ({
    finalidade: 'conversa_paciente', modelo: 'claude-haiku-5-5', geo: 'us', sistema: 's', ferramentas: [], schema: {}, maxTokens: 2000, esforco: 'low',
    turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: `instr\n${JSON.stringify({ contexto: { indices }, historico: [], pergunta })}` }] }],
  });

  it.each([
    ['o que posso comer no lugar da banana?', { categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'] }],
    ['que horas é o jantar?', { categoria: 'plano', tipo_resposta: 'horario', fontes: ['#R1'] }],
    ['qual a capital da França?', { categoria: 'fora_do_escopo', tipo_resposta: 'nenhum', fontes: [] }],
    ['SANDBOX-FONTE-INEXISTENTE', { categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S99'] }],
    ['SANDBOX-RISCO', { categoria: 'risco', tipo_resposta: 'nenhum', fontes: [] }],
    ['SANDBOX-SUPLEMENTO', { categoria: 'plano', tipo_resposta: 'quantidade', fontes: ['#I1'] }],
  ])('%s', async (pergunta, esperado) => {
    const r = await provedorSandbox().gerar(pedidoConversa(pergunta));
    expect(r.tipo).toBe('final');
    expect(JSON.parse((r as { texto: string }).texto)).toEqual(esperado);
  });

  it('SANDBOX-TEXTO-LIVRE devolve um campo fora do schema; SANDBOX-RECUSA devolve recusa', async () => {
    expect(JSON.parse(((await provedorSandbox().gerar(pedidoConversa('SANDBOX-TEXTO-LIVRE'))) as { texto: string }).texto)).toHaveProperty('resposta');
    expect((await provedorSandbox().gerar(pedidoConversa('SANDBOX-RECUSA'))).tipo).toBe('recusa');
  });

  it('cita o primeiro índice enviado do tipo (nada além dos índices vem do contexto); uso e request-id fixos, bruto com o texto', async () => {
    const r = await provedorSandbox().gerar(pedidoConversa('posso trocar o arroz?', ['#R2', '#S3', '#S4']));
    expect(r).toMatchObject({ tipo: 'final', requestId: 'sandbox-gerar', uso: { geo: 'us' } });
    expect(JSON.parse((r as { texto: string }).texto)).toEqual({ categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S3'] });
    expect(r.bruto).toEqual([{ type: 'text', text: (r as { texto: string }).texto }]);
    // sem índice do tipo no contexto, o "1" do prefixo
    const semIndice = (await provedorSandbox().gerar(pedidoConversa('que horário?', []))) as { texto: string };
    expect(JSON.parse(semIndice.texto).fontes).toEqual(['#R1']);
  });

  it('texto do usuário fora do formato → fora do escopo (sem lançar)', async () => {
    const p = { ...pedidoConversa('x'), turnos: [{ papel: 'usuario' as const, blocos: [{ tipo: 'texto' as const, texto: 'sem json' }] }] };
    expect(JSON.parse(((await provedorSandbox().gerar(p)) as { texto: string }).texto)).toEqual({ categoria: 'fora_do_escopo', tipo_resposta: 'nenhum', fontes: [] });
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
