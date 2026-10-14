import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';
import { ACOMPANHAR_IA_MAX_MS } from '@/modules/ia/constantes';
import { acompanharLeitura } from './acompanhar-leitura';

// Revisão final (RNF-100): a leitura pode passar de 3 min (fila de um job por vez, 429/529 repetidos); o painel não pode
// parar de acompanhar e deixar "Lendo o laudo…" na tela.
const resposta = (status: string) => ({ ok: true, json: async () => ({ status }) }) as Response;

describe('acompanhar a leitura da IA no painel (RNF-100)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uma resposta "pronta" depois de 4 min ainda recarrega a página (uma vez) e para de consultar', async () => {
    const inicio = Date.now();
    const buscar = vi.fn(async () => resposta(Date.now() - inicio >= 4 * 60_000 ? 'pronta' : 'processando'));
    const aoMudar = vi.fn();
    acompanharLeitura('/api/painel/ia/tarefas/t1', aoMudar, buscar as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(buscar).toHaveBeenCalledTimes(60);
    expect(aoMudar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(61_000 + 15_000);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    const consultas = buscar.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(buscar).toHaveBeenCalledTimes(consultas);
    expect(buscar).toHaveBeenCalledWith('/api/painel/ia/tarefas/t1', CONSULTA_AUTOMATICA); // polling não é uso (P12-14)
  });

  it('sem rede ou com erro, segue tentando; para no prazo em que a tarefa não pode mais estar em andamento', async () => {
    const buscar = vi.fn(async () => {
      if (buscar.mock.calls.length % 2) throw new TypeError('sem rede');
      return { ok: false } as Response;
    });
    const aoMudar = vi.fn();
    acompanharLeitura('/api/painel/ia/tarefas/t2', aoMudar, buscar as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(ACOMPANHAR_IA_MAX_MS + 60_000);
    const total = buscar.mock.calls.length;
    expect(total).toBe(60 + Math.floor((ACOMPANHAR_IA_MAX_MS - 60 * 3000) / 15_000));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(buscar).toHaveBeenCalledTimes(total);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('qualquer URL de situação (pacote de modelos, US-123): "processando" segue consultando, "pronta" recarrega uma vez', async () => {
    let status = 'processando';
    const buscar = vi.fn(async () => resposta(status));
    const aoMudar = vi.fn();
    acompanharLeitura('/api/painel/ia/geracoes/g1', aoMudar, buscar as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(9000);
    expect(aoMudar).not.toHaveBeenCalled();
    status = 'pronta';
    await vi.advanceTimersByTimeAsync(3000);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith('/api/painel/ia/geracoes/g1', CONSULTA_AUTOMATICA);
  });

  it('desmontar o componente para de consultar', async () => {
    const buscar = vi.fn(async () => resposta('na_fila'));
    const parar = acompanharLeitura('/api/painel/ia/tarefas/t3', vi.fn(), buscar as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(9000);
    parar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(buscar).toHaveBeenCalledTimes(3);
  });
});
