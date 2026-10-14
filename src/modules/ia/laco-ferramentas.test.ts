import { describe, expect, it } from 'vitest';
import { ErroProvedor, finalOk, pedeFerramenta, provedorFake } from './provedor-fake';
import { rodarLaco, type LimitesDoLaco } from './laco-ferramentas';
import type { PedidoGeracao } from './provedor';

const pedido: Omit<PedidoGeracao, 'turnos'> = { finalidade: 'rascunho', modelo: 'claude-sonnet-5-5', geo: 'us', sistema: 'S', ferramentas: [{ nome: 'buscar_alimentos', descricao: '', schema: {} }], schema: {}, maxTokens: 16_000, esforco: 'medium' };
const limites: LimitesDoLaco = { voltas: 12, tetoMicroUsd: 5_000_000, prazoMs: 12 * 60_000 };
const uso = { entrada: 1000, cacheLeitura: 0, cacheGravacao: 0, saida: 100, geo: 'us' };
const executar = async () => ({ conteudo: '[]' });

describe('rodarLaco (RN-121, D2, D4, D5): só de inclusão, para antes de passar dos limites', () => {
  it('busca → final; o histórico só cresce e o bruto volta sem mudança; custo somado das voltas', async () => {
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }, 'c1', uso), finalOk({ ok: true }, uso)] });
    const r = await rodarLaco({ provedor: f, pedido, inicio: 'METAS', executar, limites });
    expect(r).toMatchObject({ tipo: 'final', texto: '{"ok":true}', voltas: 2 });
    const [t1, t2] = f.chamadas.gerar.map((p) => p.turnos);
    expect(t1).toHaveLength(1);
    expect(t2.slice(0, 1)).toEqual(t1); // o começo não muda
    expect(t2[1]).toEqual({ papel: 'assistente', bruto: [{ type: 'tool_use', id: 'c1', name: 'buscar_alimentos', input: { termo: 'arroz' } }] });
    expect(t2[2]).toEqual({ papel: 'usuario', blocos: [{ tipo: 'resultado', chamadaId: 'c1', conteudo: '[]' }] });
    expect(r.custoMicroUsd).toBe(2 * Math.ceil((1000 * 2 + 100 * 10) * 1.1));
  });

  it('limite de voltas: a 13ª não sai', async () => {
    const f = provedorFake({ gerar: Array.from({ length: 20 }, (_, i) => pedeFerramenta('buscar_alimentos', { termo: 'x' }, `c${i}`, uso)) });
    const r = await rodarLaco({ provedor: f, pedido, inicio: 'M', executar, limites });
    expect(r).toMatchObject({ tipo: 'parou', motivo: 'limite_voltas', voltas: 12 });
    expect(f.chamadas.gerar).toHaveLength(12);
  });

  it('limite de custo: a volta cujo custo máximo passaria do teto não sai', async () => {
    const f = provedorFake({ gerar: Array.from({ length: 5 }, (_, i) => pedeFerramenta('buscar_alimentos', { termo: 'x' }, `c${i}`, uso)) });
    // 1ª volta: máximo ≈ (≈60 tokens × 2 + 16.000 × 10) × 1,1 ≈ 176.200 µUS$ — cabe em 180.000; 2ª: real 3.301 + máximo
    // (1.101 × 2 + 160.000) × 1,1 ≈ 178.423 = 181.724 — não cabe
    const r = await rodarLaco({ provedor: f, pedido, inicio: 'M', executar, limites: { ...limites, tetoMicroUsd: 180_000 } });
    expect(r).toMatchObject({ tipo: 'parou', motivo: 'limite_custo', voltas: 1 });
    expect(f.chamadas.gerar).toHaveLength(1);
  });

  it('prazo esgotado: para com limite_voltas sem nova chamada', async () => {
    let agora = 0;
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'x' }, 'c1', uso), finalOk({}, uso)] });
    const r = await rodarLaco({ provedor: f, pedido, inicio: 'M', executar: async () => { agora += 13 * 60_000; return { conteudo: '[]' }; }, limites, relogio: () => agora });
    expect(r).toMatchObject({ tipo: 'parou', motivo: 'limite_voltas', voltas: 1 });
  });

  it('antesDaVolta (autorização retirada no meio, US-122): para com o motivo e nada mais sai', async () => {
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'x' }, 'c1', uso), finalOk({}, uso)] });
    const r = await rodarLaco({ provedor: f, pedido, inicio: 'M', executar, limites, antesDaVolta: async (v) => (v === 2 ? 'sem_autorizacao' : null) });
    expect(r).toMatchObject({ tipo: 'parou', motivo: 'sem_autorizacao', voltas: 1 });
    expect(f.chamadas.gerar).toHaveLength(1);
  });

  it('recusa e saída cortada param com o motivo; erro do provedor sai como ErroNoLaco com o que já foi gasto', async () => {
    const recusa = { tipo: 'recusa' as const, categoria: 'bio', bruto: [], uso, requestId: 'r' };
    expect(await rodarLaco({ provedor: provedorFake({ gerar: [recusa] }), pedido, inicio: 'M', executar, limites })).toMatchObject({ tipo: 'parou', motivo: 'recusa', recusaCategoria: 'bio' });
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', {}, 'c1', uso), new ErroProvedor('repetir', 529, null)] });
    await expect(rodarLaco({ provedor: f, pedido, inicio: 'M', executar, limites })).rejects.toMatchObject({ name: 'ErroNoLaco', voltas: 1, erro: { tipo: 'repetir' } });
  });
});
