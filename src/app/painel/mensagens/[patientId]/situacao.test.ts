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
const { acompanharSituacao, avisoDeNovas, lidaMaisAdiante, novasNaTela, primeiraNovaDepois, ProvedorDaLeitura, EstadoDaMinha, SituacaoDaConversa, textoDaRegiao, urlDaSituacao } = await import('./situacao');
const { seguraFalhaDeRede } = await import('./rede');

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
      createElement(ProvedorDaLeitura, { minhas: [], ultimaLida: null }, createElement(SituacaoDaConversa, { patientId: 'p', depois: null, primeiroNome: 'Ana', aviso: '', focarAviso: false, consultar: true, abrirNoFim: true })),
    );
    expect(h).toMatch(/<p(?=[^>]*role="status")(?=[^>]*tabindex="-1")[^>]*><\/p>/i);
    expect(h).not.toContain(MSG_MENSAGENS.conversa.mostrarNovas);
    const comOk = renderToStaticMarkup(
      createElement(ProvedorDaLeitura, { minhas: [], ultimaLida: null }, createElement(SituacaoDaConversa, { patientId: 'p', depois: null, primeiroNome: 'Ana', aviso: 'Conversa liberada.', focarAviso: true, consultar: true, abrirNoFim: true })),
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

describe('rodada da T6b (revisão de interface)', () => {
  it('C1: o "Lida" só avança — entre o do servidor e o da consulta, fica o mais adiante nas próprias mensagens da tela', () => {
    const minhas = ['a', 'b', 'c'];
    expect(lidaMaisAdiante(minhas, 'a', 'b')).toBe('b');
    expect(lidaMaisAdiante(minhas, 'c', 'b')).toBe('c'); // a consulta velha não volta o "Lida"
    expect(lidaMaisAdiante(minhas, 'b', null)).toBe('b');
    expect(lidaMaisAdiante(minhas, null, 'a')).toBe('a');
    expect(lidaMaisAdiante(minhas, 'b', 'zzz')).toBe('b'); // a consultada nem está na tela
    expect(lidaMaisAdiante(minhas, null, null)).toBeNull();
  });

  it('C1: as novas valem só para a última mensagem que estava na tela quando a consulta respondeu (o refresh zera sem remontar)', () => {
    expect(novasNaTela({ de: 'x', n: 2 }, 'x')).toBe(2);
    expect(novasNaTela({ de: 'x', n: 2 }, 'y')).toBe(0);
    expect(novasNaTela(null, 'x')).toBe(0);
  });

  it('I1: o retorno ?ok= de cada ato é anunciado (liberar → pausar → retomar); depois de "Mostrar novas", o ?ok= já visto (o mesmo marcador) não volta; o mesmo texto com outro marcador volta', () => {
    const pausada = MSG_MENSAGENS.pausa.sucesso;
    expect(textoDaRegiao({ novas: 0, primeiroNome: 'Ana', aviso: pausada, marcador: 'a1', visto: null })).toBe(pausada);
    expect(textoDaRegiao({ novas: 1, primeiroNome: 'Ana', aviso: pausada, marcador: 'a1', visto: null })).toBe('Nova mensagem de Ana.');
    expect(textoDaRegiao({ novas: 0, primeiroNome: 'Ana', aviso: pausada, marcador: 'a1', visto: { aviso: pausada, marcador: 'a1' } })).toBe('');
    expect(textoDaRegiao({ novas: 0, primeiroNome: 'Ana', aviso: MSG_MENSAGENS.pausa.retomada, marcador: 'b2', visto: { aviso: pausada, marcador: 'a1' } })).toBe(MSG_MENSAGENS.pausa.retomada);
    // rodada da T6c (minor 1 da T6b): pausar de novo (o mesmo texto, outro ato) volta a ser anunciado
    expect(textoDaRegiao({ novas: 0, primeiroNome: 'Ana', aviso: pausada, marcador: 'c3', visto: { aviso: pausada, marcador: 'a1' } })).toBe(pausada);
    const fonte = readFileSync('src/app/painel/mensagens/[patientId]/situacao.tsx', 'utf8');
    expect(fonte).toMatch(/focus\(\{ preventScroll: true \}\)/);
    expect(fonte).toMatch(/\[focarAviso, aviso, marcador, abrirNoFim\]/);
    expect(fonte).not.toMatch(/setJaMostrou|jaMostrou/);
  });

  it('I3: ao abrir no fim e depois de enviar, rola até o fim do documento (as últimas mensagens não ficam sob o rodapé sticky, pela margem de rolagem de cada mensagem); a visão ?antes= não rola', () => {
    const fonte = readFileSync('src/app/painel/mensagens/[patientId]/situacao.tsx', 'utf8') + readFileSync('src/app/painel/mensagens/[patientId]/campo.tsx', 'utf8');
    // rodada da T7 (I3): o scrollIntoView no próprio rodapé sticky não rola; rola-se até o fim do documento
    expect(fonte).not.toMatch(/scrollIntoView/);
    expect(fonte.match(/rolarAteOFim\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    // re-revisão da T7 (2): só ao abrir no fim (`?antes=` mostra as anteriores e fica no lugar)
    expect(fonte).toMatch(/else if \(abrirNoFim\) rolarAteOFim\(\)/);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/page.tsx', 'utf8')).toMatch(/abrirNoFim=\{antes === undefined\}/);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/page.tsx', 'utf8')).toMatch(/id="rodape-da-conversa"/);
    expect(readFileSync('src/app/painel/mensagens/[patientId]/lista-de-mensagens.tsx', 'utf8')).toMatch(/data-mensagem=\{m\.id\}[\s\S]*?scroll-mb-/);
  });

  it('I4 e reforço da orquestradora: rede caída na Server Action → o erro genérico com o rascunho de volta, sem cair no error boundary', async () => {
    const acao = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const segura = seguraFalhaDeRede(acao, (dados: FormData) => ({ erro: MSG_MENSAGENS.erros.falha, texto: String(dados.get('texto') ?? '') }));
    const dados = new FormData();
    dados.set('texto', 'meu rascunho comprido');
    expect(await segura(null, dados)).toEqual({ erro: MSG_MENSAGENS.erros.falha, texto: 'meu rascunho comprido' });
    // o redirect do Next (erro com digest NEXT_REDIRECT) segue adiante
    const redireciona = seguraFalhaDeRede(
      vi.fn(async () => {
        throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/x;307;' });
      }),
      () => ({ erro: 'x', texto: '' }),
    );
    await expect(redireciona(null, dados)).rejects.toThrow('NEXT_REDIRECT');
    // e o caminho de sucesso passa o estado da action como veio
    const ok = seguraFalhaDeRede(vi.fn(async (): Promise<{ erro: string | null; texto: string }> => ({ erro: null, texto: '' })), () => ({ erro: 'x', texto: '' }));
    expect(await ok(null, dados)).toEqual({ erro: null, texto: '' });
    const campo = readFileSync('src/app/painel/mensagens/[patientId]/campo.tsx', 'utf8');
    expect(campo).toMatch(/seguraFalhaDeRede\(/);
    // sem JS, o formulário continua sendo a própria Server Action (RNF-443)
    expect(campo).toMatch(/action=\{comJs \? /);
    expect(campo).toMatch(/<p key=\{estado\.marca\}[^>]*role="alert"/);
  });
});
