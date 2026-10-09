import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// (Os testes do projeto são `.ts`, sem JSX: createElement.)
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const { ATUALIZAR_ENVIOS_MAX, ATUALIZAR_ENVIOS_MS, AtualizarEnquantoProcessa, atualizarEnquantoProcessa } = await import('./atualizar-enquanto-processa');

describe('a lista de exames enviados se atualiza enquanto algum envio está "Processando…"', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a cada 5 s, com teto de 36 atualizações (3 min)', () => {
    expect(ATUALIZAR_ENVIOS_MS).toBe(5000);
    expect(ATUALIZAR_ENVIOS_MAX * ATUALIZAR_ENVIOS_MS).toBe(3 * 60_000);
    const atualizar = vi.fn();
    atualizarEnquantoProcessa(atualizar, () => false);
    vi.advanceTimersByTime(4999);
    expect(atualizar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(atualizar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(atualizar).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10 * 60_000);
    expect(atualizar).toHaveBeenCalledTimes(36);
    expect(vi.getTimerCount()).toBe(0); // o teto para o temporizador (nada fica rodando)
  });

  it('para quando o componente sai da tela (nenhum envio processando depois da atualização)', () => {
    const atualizar = vi.fn();
    const parar = atualizarEnquantoProcessa(atualizar, () => false);
    vi.advanceTimersByTime(5000);
    parar();
    vi.advanceTimersByTime(60_000);
    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('com a aba oculta não atualiza nem gasta o teto; volta a atualizar quando a aba aparece', () => {
    const atualizar = vi.fn();
    let oculta = true;
    atualizarEnquantoProcessa(atualizar, () => oculta);
    vi.advanceTimersByTime(10 * 60_000);
    expect(atualizar).not.toHaveBeenCalled();
    oculta = false;
    vi.advanceTimersByTime(5000);
    expect(atualizar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(atualizar).toHaveBeenCalledTimes(36);
  });

  it('o componente não desenha nada (só agenda o router.refresh no navegador)', () => {
    expect(renderToStaticMarkup(createElement(AtualizarEnquantoProcessa))).toBe('');
    expect(refresh).not.toHaveBeenCalled();
  });
});
