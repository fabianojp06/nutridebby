import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CABECALHO_CONSULTA } from '@/lib/consulta-automatica';

// (Os testes do projeto são `.ts`, sem JSX: createElement.)
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const { AtualizarEnquantoProcessa, acompanharEnvios, chaveDosEnvios, SITUACOES_LENTO_MS, SITUACOES_MAX_MS, SITUACOES_RAPIDO_ATE_MS, SITUACOES_RAPIDO_MS } =
  await import('./atualizar-enquanto-processa');

type Linha = { id: string; status: string };
type Buscar = (url: string, init?: RequestInit) => Promise<Response>;
/** `buscar` falso: devolve o que `estado()` disser no momento da consulta. */
const buscarDe = (estado: () => Linha[]) => vi.fn<Buscar>(async () => new Response(JSON.stringify(estado()), { status: 200 }));

describe('a lista de exames enviados acompanha a situação enquanto algum envio está "Processando…"', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('consulta só a situação (rota leve, consulta automática) e não recarrega a página enquanto nada muda', async () => {
    const buscar = buscarDe(() => [{ id: 'a', status: 'processando' }]);
    const aoMudar = vi.fn();
    acompanharEnvios(['a'], aoMudar, { buscar, oculta: () => false });
    await vi.advanceTimersByTimeAsync(SITUACOES_RAPIDO_MS);
    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe('/api/p/exames/situacoes');
    expect(new Headers(init?.headers).get(CABECALHO_CONSULTA)).toBe('1');
    expect(init?.cache).toBe('no-store');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('5 s nos 3 primeiros minutos, depois 30 s, e para aos 30 min desde a montagem', async () => {
    expect([SITUACOES_RAPIDO_MS, SITUACOES_RAPIDO_ATE_MS, SITUACOES_LENTO_MS, SITUACOES_MAX_MS]).toEqual([5000, 180_000, 30_000, 1_800_000]);
    const buscar = buscarDe(() => [{ id: 'a', status: 'processando' }]);
    acompanharEnvios(['a'], vi.fn(), { buscar, oculta: () => false });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(buscar).toHaveBeenCalledTimes(36); // 5 s, 10 s, …, 180 s
    await vi.advanceTimersByTimeAsync(29_999);
    expect(buscar).toHaveBeenCalledTimes(36);
    await vi.advanceTimersByTimeAsync(1);
    expect(buscar).toHaveBeenCalledTimes(37); // 210 s: ritmo lento
    await vi.advanceTimersByTimeAsync(1_800_000 - 210_000);
    expect(buscar).toHaveBeenCalledTimes(36 + 54); // 210 s, 240 s, …, 1800 s
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(buscar).toHaveBeenCalledTimes(90);
    expect(vi.getTimerCount()).toBe(0); // fim aos 30 min: nada fica agendado
  });

  it('quando a situação muda (o worker terminou, ou o envio sumiu da lista), recarrega a página uma única vez e para', async () => {
    let status = 'processando';
    const buscar = buscarDe(() => [{ id: 'a', status }]);
    const aoMudar = vi.fn();
    acompanharEnvios(['a'], aoMudar, { buscar, oculta: () => false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(aoMudar).not.toHaveBeenCalled();
    status = 'falhou';
    await vi.advanceTimersByTimeAsync(5000);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);

    const sumiu = vi.fn();
    acompanharEnvios(['b'], sumiu, { buscar: buscarDe(() => []), oculta: () => false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sumiu).toHaveBeenCalledTimes(1);
  });

  it('resposta recusada ou sem rede: não recarrega, tenta no próximo ciclo', async () => {
    let n = 0;
    const buscar = vi.fn<Buscar>(async () => {
      if (++n === 1) throw new TypeError('Failed to fetch');
      return new Response('{"erro":"x"}', { status: 401 });
    });
    const aoMudar = vi.fn();
    acompanharEnvios(['a'], aoMudar, { buscar, oculta: () => false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('com a aba oculta não consulta; volta a consultar quando a aba aparece', async () => {
    let oculta = true;
    const buscar = buscarDe(() => [{ id: 'a', status: 'processando' }]);
    acompanharEnvios(['a'], vi.fn(), { buscar, oculta: () => oculta });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(buscar).not.toHaveBeenCalled();
    oculta = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('parar (desmontagem) cancela o próximo ciclo', async () => {
    const buscar = buscarDe(() => [{ id: 'a', status: 'processando' }]);
    const parar = acompanharEnvios(['a'], vi.fn(), { buscar, oculta: () => false });
    await vi.advanceTimersByTimeAsync(5000);
    parar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('outro envio com o componente montado: o conjunto de ids muda, a chave muda e o acompanhamento recomeça no ritmo de 5 s', async () => {
    expect(chaveDosEnvios(['b', 'a'])).toBe(chaveDosEnvios(['a', 'b']));
    expect(chaveDosEnvios(['a', 'b'])).not.toBe(chaveDosEnvios(['a']));
    // o efeito do componente depende da chave: para o acompanhamento antigo e começa outro, com o relógio zerado
    const buscar = buscarDe(() => [{ id: 'a', status: 'processando' }, { id: 'b', status: 'processando' }]);
    const parar = acompanharEnvios(['a'], vi.fn(), { buscar, oculta: () => false });
    await vi.advanceTimersByTimeAsync(10 * 60_000); // já no ritmo lento
    parar();
    buscar.mockClear();
    acompanharEnvios(chaveDosEnvios(['a', 'b']).split(','), vi.fn(), { buscar, oculta: () => false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(buscar).toHaveBeenCalledTimes(6);
  });

  it('o componente não desenha nada (no servidor nada é consultado nem recarregado)', () => {
    expect(renderToStaticMarkup(createElement(AtualizarEnquantoProcessa, { processando: ['a'] }))).toBe('');
    expect(refresh).not.toHaveBeenCalled();
  });
});
