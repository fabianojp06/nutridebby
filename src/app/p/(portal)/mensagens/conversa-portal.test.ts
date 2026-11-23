import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CABECALHO_CONSULTA } from '@/lib/consulta-automatica';
import { MSG_PORTAL_MENSAGENS, SOCORRO_DO_RISCO, SOCORRO_NA_RECUSA, SITUACAO_INTERVALO_MS } from '@/modules/mensagens/constantes';

// Plano 25, T7 (US-443, RN-452, RN-473, RNF-441): o rodapé da conversa no app — a região viva, a consulta "há novas?" e o
// campo. Sem jsdom (os testes do projeto são `.ts`): a consulta é a função pura compartilhada com o painel, com relógio e
// `fetch` falsos; o "sem rede" e o estado devolvido pela action entram pelos ganchos simulados.
const refresh = vi.fn();
const ambiente = vi.hoisted(() => ({ online: true, estado: null as unknown }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/components/portal/online', () => ({ useOnline: () => ambiente.online }));
vi.mock('./actions', () => ({ enviarMensagemAction: vi.fn() }));
vi.mock('react', async (original) => {
  const r = await original<typeof import('react')>();
  // o estado devolvido pela action (o rascunho de volta), sem precisar de um envio de verdade
  return { ...r, useActionState: (_acao: unknown, inicial: unknown) => [ambiente.estado ?? inicial, vi.fn(), false] };
});
const { CampoDoPortal, estadoDaFalhaDeRede, ID_AVISO_URGENCIA, SituacaoDoPortal, textoDaRegiaoDoPortal, urlDaSituacaoDoPortal } = await import('./conversa-portal');
const { acompanharSituacao } = await import('@/components/mensagens/situacao');
const { ProvedorDaLeitura } = await import('@/components/mensagens/leitura');

const P = MSG_PORTAL_MENSAGENS;
const regiao = (h: string) => /<p(?=[^>]*\brole="status")[^>]*>([\s\S]*?)<\/p>/.exec(h)?.[1];
const situacao = (props: Partial<{ depois: string | null; consultar: boolean; abrirNoFim: boolean; aviso: string }> = {}) =>
  renderToStaticMarkup(createElement(ProvedorDaLeitura, { minhas: [], ultimaLida: null }, createElement(SituacaoDoPortal, { depois: null, consultar: true, abrirNoFim: true, aviso: '', ...props })));
const campo = (props: Partial<{ erroInicial: string | null }> = {}) => renderToStaticMarkup(createElement(CampoDoPortal, { erroInicial: null, ...props }));

beforeEach(() => {
  ambiente.online = true;
  ambiente.estado = null;
});

describe('região viva e consulta "há novas?" do portal (RN-452, US-443)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a URL leva só o id da última mostrada (o paciente vem da sessão)', () => {
    expect(urlDaSituacaoDoPortal('22222222-2222-4222-8222-222222222222')).toBe('/api/p/mensagens/situacao?depois=22222222-2222-4222-8222-222222222222');
    expect(urlDaSituacaoDoPortal(null)).toBe('/api/p/mensagens/situacao?depois=');
  });

  it('relógio falso: 15 s com a aba visível, 60 s depois de 5 min parado, nada com a aba escondida ou sem rede; volta ao ficar visível ou reconectar', async () => {
    const estado = { oculta: false, semRede: false };
    const documento = new EventTarget();
    const janela = new EventTarget();
    const buscar = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ novas: 1, ultimaLida: null, texto: 'NUNCA' }), { status: 200 }));
    const aoMudar = vi.fn();
    const parar = acompanharSituacao(urlDaSituacaoDoPortal('x'), aoMudar, { buscar, oculta: () => estado.oculta, semRede: () => estado.semRede, documento, janela });
    await vi.advanceTimersByTimeAsync(SITUACAO_INTERVALO_MS);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar.mock.calls[0][0]).toBe('/api/p/mensagens/situacao?depois=x');
    expect(new Headers(buscar.mock.calls[0][1]?.headers).get(CABECALHO_CONSULTA)).toBe('1');
    expect(aoMudar).toHaveBeenCalledExactlyOnceWith({ novas: 1, ultimaLida: null }); // nunca o texto
    await vi.advanceTimersByTimeAsync(300_000 - SITUACAO_INTERVALO_MS);
    const n = buscar.mock.calls.length;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(buscar).toHaveBeenCalledTimes(n);
    await vi.advanceTimersByTimeAsync(1);
    expect(buscar).toHaveBeenCalledTimes(n + 1); // parado há 5 min: 60 s
    estado.oculta = true;
    documento.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(buscar).toHaveBeenCalledTimes(n + 1);
    estado.oculta = false;
    estado.semRede = true;
    documento.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(buscar).toHaveBeenCalledTimes(n + 1);
    estado.semRede = false;
    janela.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(buscar).toHaveBeenCalledTimes(n + 2); // na hora
    parar();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('o texto da região: sem rede vence; com novas, "Nova mensagem da sua nutricionista."; senão o aviso (o ?erro= sem campo), menos o já visto', () => {
    expect(textoDaRegiaoDoPortal({ online: false, novas: 2, aviso: 'x', avisoVisto: null })).toBe(P.erros.semInternet);
    expect(textoDaRegiaoDoPortal({ online: true, novas: 1, aviso: 'x', avisoVisto: null })).toBe(P.novaMensagem);
    expect(textoDaRegiaoDoPortal({ online: true, novas: 0, aviso: P.erros.pausadaNoEnvio, avisoVisto: null })).toBe(P.erros.pausadaNoEnvio);
    expect(textoDaRegiaoDoPortal({ online: true, novas: 0, aviso: P.erros.pausadaNoEnvio, avisoVisto: P.erros.pausadaNoEnvio })).toBe('');
    expect(textoDaRegiaoDoPortal({ online: true, novas: 0, aviso: '', avisoVisto: null })).toBe('');
  });

  it('a região sempre montada e vazia; sem rede, "Sem conexão. Escreva quando voltar." nela; nenhum texto de mensagem antes do toque (o conteúdo só vem do router.refresh)', () => {
    const h = situacao();
    expect(regiao(h)).toBe('');
    expect(h).toMatch(/<p(?=[^>]*role="status")(?=[^>]*tabindex="-1")(?=[^>]*id="regiao-da-conversa")[^>]*>/i);
    expect(h).not.toContain(P.mostrarNovas);
    ambiente.online = false;
    expect(regiao(situacao())).toBe(P.erros.semInternet);
    const fonte = readFileSync('src/app/p/(portal)/mensagens/conversa-portal.tsx', 'utf8');
    expect(fonte.match(/router\.refresh\(\)/g)).toHaveLength(1);
    expect(fonte).toMatch(/onClick=\{mostrarNovas\}/);
    expect(fonte).toMatch(/acompanharSituacao\(urlDaSituacaoDoPortal\(depois\)/);
    expect(fonte).toMatch(/primeiraNovaDepois\(/);
    expect(fonte).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('o campo do portal (US-443, RN-473)', () => {
  it('"Escreva sua mensagem" (textarea: Enter quebra linha) e "Enviar"; com rede, nada desabilitado', () => {
    const h = campo();
    expect(h).toMatch(new RegExp(`<label[^>]*for="texto-mensagem"[^>]*>${P.campo}</label>`));
    expect(h).toMatch(/<textarea(?=[^>]*id="texto-mensagem")(?=[^>]*name="texto")[^>]*>/);
    expect(h).not.toMatch(/<textarea[^>]*disabled=""/);
    expect(h).toMatch(/<button(?=[^>]*type="submit")[^>]*>Enviar<\/button>/);
    expect(h).not.toMatch(/<button[^>]*disabled=""/);
  });

  it('sem rede: o campo e o botão desabilitados e o texto que já estava escrito continua no campo', () => {
    ambiente.online = false;
    ambiente.estado = { marca: 'm1', erro: null, texto: 'meu rascunho', enviada: false, textoFixo: null };
    const h = campo();
    expect(h).toMatch(/<textarea[^>]*disabled=""[^>]*>meu rascunho<\/textarea>/);
    expect(h).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/);
    // a chave do texto não depende da rede (só da resposta da action): ficar sem rede não remonta o campo
    const fonte = readFileSync('src/app/p/(portal)/mensagens/conversa-portal.tsx', 'utf8');
    expect(fonte).toMatch(/<Texto key=\{estado\?\.marca \?\? 'inicio'\}/);
    for (const k of fonte.match(/key=\{[^}]*\}/g) ?? []) expect(k).not.toMatch(/online|depois|ultima/);
  });

  it('o erro junto ao campo (role="alert", aria-describedby) com o rascunho de volta; o ?erro= sem JS também', () => {
    ambiente.estado = { marca: 'm2', erro: P.erros.muitas, texto: 'mais uma', enviada: false, textoFixo: null };
    const h = campo();
    expect(h).toMatch(new RegExp(`<div[^>]*role="alert"[^>]*><p[^>]*id="erro-mensagem"[^>]*>${P.erros.muitas}</p></div>`));
    expect(h).toMatch(/<textarea[^>]*aria-describedby="aviso-urgencia erro-mensagem"[^>]*aria-invalid="true"[^>]*>mais uma<\/textarea>/);
    ambiente.estado = null;
    expect(campo({ erroInicial: P.erros.formato })).toMatch(new RegExp(`role="alert"[^>]*><p[^>]*id="erro-mensagem"[^>]*>${P.erros.formato}<`));
  });

  it('RN-449 (revisão da T3, M8): "muitas" com sinal de risco no texto recusado mostra também o socorro, com o 192 discável', () => {
    ambiente.estado = { marca: 'm3', erro: P.erros.muitas, texto: 'estou com dor no peito', enviada: false, textoFixo: 'sintoma_agudo' };
    const h = campo();
    expect(h.replace(/<[^>]+>/g, '')).toContain(SOCORRO_DO_RISCO.sintoma_agudo);
    expect(h).toMatch(/data-socorro=""/);
    expect(h).toMatch(/<a href="tel:192"/);
  });

  it('com JS, o envio passa por seguraFalhaDeRede (a rede caída devolve o rascunho); sem JS, o formulário é a própria Server Action', () => {
    const fonte = readFileSync('src/app/p/(portal)/mensagens/conversa-portal.tsx', 'utf8');
    expect(fonte).toMatch(/seguraFalhaDeRede\(/);
    expect(fonte).toMatch(/action=\{comJs \? /);
    expect(fonte).toMatch(/focus\(\{ preventScroll: true \}\)/);
    // rodada da T7 (I3): rola até o fim do documento, não até o próprio rodapé sticky
    expect(fonte).toMatch(/rolarAteOFim\(\)/);
    expect(fonte).not.toMatch(/scrollIntoView/);
  });

  it('rodada da T7 (I1 e I2 da interface; minor): o aviso de urgência descreve o campo; borda de campo (contraste 3:1); 2 linhas', () => {
    expect(ID_AVISO_URGENCIA).toBe('aviso-urgencia');
    const h = campo();
    expect(h).toMatch(/<textarea[^>]*aria-describedby="aviso-urgencia"/);
    expect(h).not.toMatch(/<textarea[^>]*aria-invalid/);
    expect(h).toMatch(/<textarea[^>]*rows="2"/);
    expect(h).toMatch(/<textarea[^>]*class="[^"]*\bborder-campo\b/);
    expect(h).not.toMatch(/<textarea[^>]*class="[^"]*\bborder-borda\b/);
  });
});

describe('rodada da T7 — socorro na recusa (CH-D77, CFN I1 e M2)', () => {
  it('transtorno recusado: só o trecho de perigo, nunca "enviada"; o cartão é uma nota (role="note")', () => {
    ambiente.estado = { marca: 'm4', erro: P.erros.muitas, texto: 'vomito de proposito', enviada: false, textoFixo: 'risco_transtorno' };
    const h = campo();
    const texto = h.replace(/<[^>]+>/g, '');
    expect(texto).toContain(SOCORRO_NA_RECUSA.transtorno_alimentar);
    expect(texto).not.toMatch(/enviada/i);
    expect(texto).not.toContain(SOCORRO_DO_RISCO.transtorno_alimentar);
    expect(h).toMatch(/<div(?=[^>]*data-socorro="")(?=[^>]*role="note")[^>]*>/);
  });

  it('rede caída: o estado de falha traz o rascunho e o risco do texto recusado, calculado no aparelho', () => {
    const dados = new FormData();
    dados.set('texto', 'não aguento mais, quero sumir');
    expect(estadoDaFalhaDeRede(dados)).toMatchObject({ erro: P.erros.falha, texto: 'não aguento mais, quero sumir', enviada: false, textoFixo: 'risco_emergencia' });
    dados.set('texto', 'posso trocar o arroz?');
    expect(estadoDaFalhaDeRede(dados).textoFixo).toBeNull();
    // a peça de risco é a do Plano 15, sem import de servidor (o cliente a importa)
    expect(readFileSync('src/modules/ia/nutri-paciente/sinais-risco.ts', 'utf8')).not.toMatch(/^import (?!type)/m);
  });

  it('re-revisão da T7 (1): na recusa com risco, o socorro (com o 188/192) fica DENTRO do role="alert" do erro — o leitor de tela ouve os dois', () => {
    ambiente.estado = { marca: 'm5', erro: P.erros.pausadaNoEnvio, texto: 'não aguento mais, quero sumir', enviada: false, textoFixo: 'risco_emergencia' };
    const h = campo();
    const alerta = /<div[^>]*role="alert"[^>]*>([\s\S]*?)<\/div><div class="flex justify-end">/.exec(h)?.[1] ?? '';
    expect(alerta).toContain(P.erros.pausadaNoEnvio);
    expect(alerta.replace(/<[^>]+>/g, '')).toContain(SOCORRO_NA_RECUSA.emergencia);
    expect(alerta).toMatch(/href="tel:188"/);
    expect(alerta).toMatch(/href="tel:192"/);
    // o campo continua descrito só pelo erro (não pelo socorro inteiro)
    expect(h).toMatch(/<p[^>]*id="erro-mensagem"[^>]*>[^<]*<\/p>/);
  });

  it('re-revisão da T7 (2): só rola até o fim ao abrir no fim (nunca na visão ?antes=)', () => {
    const fonte = readFileSync('src/app/p/(portal)/mensagens/conversa-portal.tsx', 'utf8');
    expect(fonte).toMatch(/else if \(abrirNoFim\) rolarAteOFim\(\)/);
    expect(readFileSync('src/app/p/(portal)/mensagens/page.tsx', 'utf8')).toMatch(/abrirNoFim=\{antes === undefined\}/);
  });
});
