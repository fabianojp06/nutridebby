import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CABECALHO_CONSULTA } from '@/lib/consulta-automatica';
import { CONTADOR_INTERVALO_MS } from '@/modules/mensagens/constantes';
import { acompanharContador, URL_DO_CONTADOR } from './contador-de-mensagens';

// Plano 25 (RN-459, CH-D43): o contador do menu "Mensagens" consulta `GET /api/painel/mensagens/contador` a cada 60 s com a
// aba visível e com rede; nenhuma consulta com a aba escondida ou sem rede; volta ao ficar visível ou ao reconectar. Um
// temporizador só, limpo ao parar. (Os testes do projeto são `.ts`: sem jsdom, o documento e a janela são EventTarget.)
type Buscar = (url: string, init?: RequestInit) => Promise<Response>;
const respostaCom = (n: number) => vi.fn<Buscar>(async () => new Response(JSON.stringify({ n }), { status: 200 }));

function ambiente() {
  const estado = { oculta: false, semRede: false };
  const documento = new EventTarget();
  const janela = new EventTarget();
  return {
    estado,
    opcoes: { oculta: () => estado.oculta, semRede: () => estado.semRede, documento, janela },
    esconder() {
      estado.oculta = true;
      documento.dispatchEvent(new Event('visibilitychange'));
    },
    mostrar() {
      estado.oculta = false;
      documento.dispatchEvent(new Event('visibilitychange'));
    },
    cair() {
      estado.semRede = true;
      janela.dispatchEvent(new Event('offline'));
    },
    voltar() {
      estado.semRede = false;
      janela.dispatchEvent(new Event('online'));
    },
  };
}

describe('contador do menu "Mensagens" (RN-459)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('consulta a cada 60 s com a aba visível, pela rota leve (consulta automática, sem cache), e troca o número', async () => {
    expect(CONTADOR_INTERVALO_MS).toBe(60_000);
    const A = ambiente();
    const buscar = respostaCom(4);
    const aoContar = vi.fn();
    const parar = acompanharContador(aoContar, { ...A.opcoes, buscar });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(buscar).not.toHaveBeenCalled(); // o número inicial veio do layout
    await vi.advanceTimersByTimeAsync(1);
    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe(URL_DO_CONTADOR);
    expect(URL_DO_CONTADOR).toBe('/api/painel/mensagens/contador');
    expect(new Headers(init?.headers).get(CABECALHO_CONSULTA)).toBe('1');
    expect(init?.cache).toBe('no-store');
    expect(aoContar).toHaveBeenLastCalledWith(4);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1); // um temporizador só
    parar();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it('nenhuma consulta com a aba escondida; ao ficar visível, consulta na hora e volta ao ritmo de 60 s', async () => {
    const A = ambiente();
    const buscar = respostaCom(2);
    const aoContar = vi.fn();
    acompanharContador(aoContar, { ...A.opcoes, buscar });
    A.esconder();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(buscar).not.toHaveBeenCalled();
    A.mostrar();
    await vi.advanceTimersByTimeAsync(0);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(aoContar).toHaveBeenLastCalledWith(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('aba escondida já na montagem: não agenda nada até ficar visível', async () => {
    const A = ambiente();
    A.estado.oculta = true;
    const buscar = respostaCom(1);
    acompanharContador(vi.fn(), { ...A.opcoes, buscar });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(buscar).not.toHaveBeenCalled();
    A.mostrar();
    await vi.advanceTimersByTimeAsync(0);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('nenhuma consulta sem rede; ao reconectar, consulta na hora', async () => {
    const A = ambiente();
    const buscar = respostaCom(5);
    acompanharContador(vi.fn(), { ...A.opcoes, buscar });
    A.cair();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(buscar).not.toHaveBeenCalled();
    A.voltar();
    await vi.advanceTimersByTimeAsync(0);
    expect(buscar).toHaveBeenCalledTimes(1);
    // sem rede no momento do disparo (o evento "offline" não chegou): não consulta e espera o "online"
    A.estado.semRede = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('visível de novo sem ter escondido (evento repetido): não dobra a consulta nem o temporizador', async () => {
    const A = ambiente();
    const buscar = respostaCom(0);
    acompanharContador(vi.fn(), { ...A.opcoes, buscar });
    A.mostrar();
    A.mostrar();
    await vi.advanceTimersByTimeAsync(0);
    expect(buscar).not.toHaveBeenCalled(); // não estava parado: segue o ritmo
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(buscar).toHaveBeenCalledTimes(1);
    // escondida e visível duas vezes seguidas: uma consulta só
    A.esconder();
    A.mostrar();
    A.mostrar();
    await vi.advanceTimersByTimeAsync(0);
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('resposta recusada, corpo estranho ou erro de rede: não troca o número e tenta no próximo ciclo', async () => {
    const A = ambiente();
    let i = 0;
    const buscar = vi.fn<Buscar>(async () => {
      i++;
      if (i === 1) throw new TypeError('Failed to fetch');
      if (i === 2) return new Response('{"erro":"x"}', { status: 401 });
      if (i === 3) return new Response('{"n":"3"}', { status: 200 });
      return new Response('{"n":7}', { status: 200 });
    });
    const aoContar = vi.fn();
    acompanharContador(aoContar, { ...A.opcoes, buscar });
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(aoContar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(aoContar).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('parar remove os ouvintes: evento depois do desmonte não consulta', async () => {
    const A = ambiente();
    const buscar = respostaCom(1);
    const parar = acompanharContador(vi.fn(), { ...A.opcoes, buscar });
    parar();
    A.esconder();
    A.mostrar();
    A.voltar();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(buscar).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('o componente é cliente, usa o acompanhamento num efeito com limpeza e não tem região viva (só troca o texto do item)', () => {
    const s = readFileSync('src/app/painel/contador-de-mensagens.tsx', 'utf8');
    expect(s).toMatch(/^'use client';/);
    expect(s).toMatch(/useEffect\(\(\) => \(ativo \? acompanharContador\([\s\S]*?: undefined\)/);
    expect(s).not.toMatch(/aria-live|role="status"/);
    expect(readFileSync('src/app/painel/menu-painel.tsx', 'utf8')).toMatch(/useContadorDeMensagens\(/);
  });
});
