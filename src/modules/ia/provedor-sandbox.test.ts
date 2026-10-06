import { describe, expect, it } from 'vitest';
import { ErroProvedor, type PedidoLeitura } from './provedor';
import { provedorFake, respostaOk } from './provedor-fake';
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

});

describe('provedor falso (testes)', () => {
  it('segue o roteiro na ordem e registra as chamadas; erro do roteiro é lançado', async () => {
    const f = provedorFake({ ler: [respostaOk({ documento_reconhecido: true, data_coleta: null, marcadores: [] }), new ErroProvedor('repetir', 529, 'req-1')] });
    expect((await f.lerDocumento(pedido())).tipo).toBe('ok');
    await expect(f.lerDocumento(pedido())).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'repetir', status: 529 });
    expect(f.chamadas.ler).toHaveLength(2);
  });

  it('sem roteiro, devolve a resposta do sandbox (para IA_PROVEDOR=fake em dev)', async () => {
    const r = await provedorFake().lerDocumento(pedido());
    expect(r.tipo === 'ok' && JSON.parse(r.texto)).toEqual(RESPOSTA_SANDBOX);
  });
});
