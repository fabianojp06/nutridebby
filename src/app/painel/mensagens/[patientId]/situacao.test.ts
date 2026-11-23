import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CABECALHO_CONSULTA } from '@/lib/consulta-automatica';
import { MSG_MENSAGENS, SITUACAO_INTERVALO_MS, SITUACAO_INTERVALO_OCIOSO_MS, SITUACAO_OCIOSO_APOS_MS } from '@/modules/mensagens/constantes';

// Plano 25, T6b (US-441 "Mensagem nova com a tela aberta", RN-452, RNF-441): a consulta "há novas?" da conversa e a região
// viva. Sem jsdom (os testes do projeto são `.ts`): o acompanhamento é uma função pura com relógio falso e `fetch` falso, e
// o documento e a janela são EventTarget.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const { acompanharSituacao, avisoDeNovas, primeiraNovaDepois, ProvedorDaLeitura, EstadoDaMinha, SituacaoDaConversa, urlDaSituacao } = await import('./situacao');

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;
const resposta = (corpo: unknown) => vi.fn<Buscar>(async () => new Response(JSON.stringify(corpo), { status: 200 }));

function ambiente() {
  const estado = { oculta: false, semRede: false, agora: 0 };
  const documento = new EventTarget();
  const janela = new EventTarget();
  return {
    estado,
    opcoes: { oculta: () => estado.oculta, semRede: () => estado.semRede, agora: () => Date.now(), documento, janela },
    documento,
    janela,
  };
}

describe('acompanharSituacao (RN-452)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const url = urlDaSituacao('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');

  it('a URL leva o paciente e o id da última mostrada (vazio sem mensagens)', () => {
    expect(url).toBe('/api/painel/mensagens/situacao?paciente=11111111-1111-4111-8111-111111111111&depois=22222222-2222-4222-8222-222222222222');
    expect(urlDaSituacao('11111111-1111-4111-8111-111111111111', null)).toBe('/api/painel/mensagens/situacao?paciente=11111111-1111-4111-8111-111111111111&depois=');
  });

  it('a cada 15 s com a aba visível (consulta automática, sem cache); só as duas chaves chegam a quem ouve', async () => {
    expect([SITUACAO_INTERVALO_MS, SITUACAO_INTERVALO_OCIOSO_MS, SITUACAO_OCIOSO_APOS_MS]).toEqual([15_000, 60_000, 300_000]);
    const A = ambiente();
    const buscar = resposta({ novas: 1, ultimaLida: null, texto: 'NUNCA' });
    const aoMudar = vi.fn();
    const parar = acompanharSituacao(url, aoMudar, { ...A.opcoes, buscar });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(buscar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(buscar).toHaveBeenCalledTimes(1);
    const [u, init] = buscar.mock.calls[0];
    expect(u).toBe(url);
    expect(new Headers(init?.headers).get(CABECALHO_CONSULTA)).toBe('1');
    expect(init?.cache).toBe('no-store');
    expect(aoMudar).toHaveBeenCalledExactlyOnceWith({ novas: 1, ultimaLida: null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    parar();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('60 s depois de 5 min sem interação; uma tecla ou um toque voltam ao ritmo de 15 s', async () => {
    const A = ambiente();
    const buscar = resposta({ novas: 0, ultimaLida: null });
    acompanharSituacao(url, vi.fn(), { ...A.opcoes, buscar });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(buscar).toHaveBeenCalledTimes(20); // 15 s … 300 s
    await vi.advanceTimersByTimeAsync(59_999);
    expect(buscar).toHaveBeenCalledTimes(20);
    await vi.advanceTimersByTimeAsync(1);
    expect(buscar).toHaveBeenCalledTimes(21); // ocioso: 60 s
    A.documento.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(buscar).toHaveBeenCalledTimes(22); // de volta aos 15 s
    expect(vi.getTimerCount()).toBe(1);
  });

  it('nenhuma consulta com a aba escondida ou sem rede; volta ao ficar visível ou ao reconectar', async () => {
    const A = ambiente();
    const buscar = resposta({ novas: 0, ultimaLida: null });
    acompanharSituacao(url, vi.fn(), { ...A.opcoes, buscar });
    A.estado.oculta = true;
    A.documento.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(buscar).not.toHaveBeenCalled();
    A.estado.oculta = false;
    A.documento.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(buscar).toHaveBeenCalledTimes(1);
    A.estado.semRede = true;
    A.janela.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(buscar).toHaveBeenCalledTimes(1);
    A.estado.semRede = false;
    A.janela.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('resposta recusada ou corpo estranho: nada muda e tenta no ciclo seguinte', async () => {
    const A = ambiente();
    let i = 0;
    const buscar = vi.fn<Buscar>(async () => {
      i++;
      if (i === 1) throw new TypeError('Failed to fetch');
      if (i === 2) return new Response('{}', { status: 401 });
      if (i === 3) return new Response('{"novas":"1"}', { status: 200 });
      return new Response('{"novas":2,"ultimaLida":"33333333-3333-4333-8333-333333333333"}', { status: 200 });
    });
    const aoMudar = vi.fn();
    acompanharSituacao(url, aoMudar, { ...A.opcoes, buscar });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(aoMudar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(aoMudar).toHaveBeenCalledExactlyOnceWith({ novas: 2, ultimaLida: '33333333-3333-4333-8333-333333333333' });
  });
});

describe('a região viva, "Mostrar novas mensagens" e o "Lida" (US-441)', () => {
  it('o aviso: "Nova mensagem de {primeiro nome}." com novas; vazio sem', () => {
    expect(avisoDeNovas(1, 'Ana')).toBe(MSG_MENSAGENS.conversa.novaMensagemDe('Ana'));
    expect(avisoDeNovas(3, 'Ana')).toBe('Nova mensagem de Ana.');
    expect(avisoDeNovas(0, 'Ana')).toBe('');
  });

  it('o foco depois do toque vai à primeira mensagem nova: a seguinte à última que estava na tela', () => {
    expect(primeiraNovaDepois(['a', 'b', 'c', 'd'], 'b')).toBe('c');
    expect(primeiraNovaDepois(['a', 'b'], 'b')).toBeNull();
    expect(primeiraNovaDepois(['a', 'b'], null)).toBe('a'); // a tela estava vazia
    expect(primeiraNovaDepois(['x', 'y'], 'b')).toBe('x'); // a última saiu da janela de 50: a primeira da lista nova
  });

  it('a região está sempre montada (vazia ou com o ?ok=), sem "Mostrar novas mensagens" antes de haver novas; nenhum texto de mensagem entra no componente', () => {
    const h = renderToStaticMarkup(
      createElement(ProvedorDaLeitura, { minhas: [], ultimaLida: null }, createElement(SituacaoDaConversa, { patientId: 'p', depois: null, primeiroNome: 'Ana', aviso: '', focarAviso: false, consultar: true })),
    );
    expect(h).toMatch(/<p(?=[^>]*role="status")(?=[^>]*tabindex="-1")[^>]*><\/p>/i);
    expect(h).not.toContain(MSG_MENSAGENS.conversa.mostrarNovas);
    const comOk = renderToStaticMarkup(
      createElement(ProvedorDaLeitura, { minhas: [], ultimaLida: null }, createElement(SituacaoDaConversa, { patientId: 'p', depois: null, primeiroNome: 'Ana', aviso: 'Conversa liberada.', focarAviso: true, consultar: true })),
    );
    expect(comOk).toMatch(/<p(?=[^>]*role="status")[^>]*>Conversa liberada\.<\/p>/);
    const fonte = readFileSync('src/app/painel/mensagens/[patientId]/situacao.tsx', 'utf8');
    // o conteúdo só chega pelo router.refresh() do toque (e nada do corpo além das duas chaves passa adiante)
    expect(fonte).toMatch(/router\.refresh\(\)/);
    expect(fonte.match(/router\.refresh\(\)/g)).toHaveLength(1);
    expect(fonte).toMatch(/onClick=\{mostrarNovas\}/);
    expect(fonte).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('"Lida" na última própria que o outro lado passou; "Enviada" nas seguintes; nada nas anteriores', () => {
    const estados = (ultimaLida: string | null) =>
      ['a', 'b', 'c'].map((id) =>
        renderToStaticMarkup(createElement(ProvedorDaLeitura, { minhas: ['a', 'b', 'c'], ultimaLida }, createElement(EstadoDaMinha, { id }))).replace(/<[^>]+>/g, ''),
      );
    expect(estados(null)).toEqual(['Enviada', 'Enviada', 'Enviada']);
    expect(estados('b')).toEqual(['', 'Lida', 'Enviada']);
    expect(estados('c')).toEqual(['', '', 'Lida']);
    expect(estados('zzz')).toEqual(['Enviada', 'Enviada', 'Enviada']); // a lida ficou antes da página carregada
  });
});
