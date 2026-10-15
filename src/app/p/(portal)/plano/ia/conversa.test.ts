import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { CONSULTA_LENTA_MS, CONSULTA_RAPIDA_MS, MAX_PERGUNTA, MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { TEXTOS_FIXOS } from '@/modules/ia/nutri-paciente/textos';
import type { MensagemDoPaciente } from '@/modules/ia/nutri-paciente/conversa';

// (Os testes do projeto são `.ts`, sem JSX: createElement. Sem DOM: a lógica pura da tela e o HTML do servidor.)
const s = vi.hoisted(() => ({ online: true }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/components/portal/online', () => ({ useOnline: () => s.online }));
vi.mock('./actions', () => ({
  perguntarAction: async () => ({}),
  enviarANutriAction: async () => ({}),
  avaliarAction: async () => ({}),
  encaminharAction: async () => ({}),
}));
const { Conversa, MENSAGENS_NA_TELA, alvoDoFoco, chamar, chegouResposta, encaminharNoItem, estadoDoRetorno, inicioVisivel, proximoIntervalo, textoDoStatus } = await import('./conversa');
const tela = (o: { mensagens?: MensagemDoPaciente[]; textoInicial?: string | null; podePerguntar?: boolean } = {}) =>
  renderToStaticMarkup(createElement(Conversa, { tenantId: 't1', mensagens: o.mensagens ?? [], podePerguntar: o.podePerguntar ?? true, sessaoNova: false, textoInicial: o.textoInicial ?? null }));

let n = 0;
const msg = (o: Partial<MensagemDoPaciente>): MensagemDoPaciente => ({
  id: `m${++n}`,
  criadaEm: new Date(),
  autor: 'paciente',
  texto: null,
  textoFixo: null,
  status: null,
  avaliacao: null,
  duvida: null,
  podeEncaminhar: false,
  rotuloCategoria: null,
  risco: false,
  ...o,
});

describe('a conversa no app (US-172, RNF-160, RNF-167)', () => {
  it('RNF-160: 5 s nas primeiras 12 consultas (1 min), depois 30 s', () => {
    expect(proximoIntervalo(0)).toBe(CONSULTA_RAPIDA_MS);
    expect(proximoIntervalo(11)).toBe(CONSULTA_RAPIDA_MS);
    expect(proximoIntervalo(12)).toBe(CONSULTA_LENTA_MS);
    expect(proximoIntervalo(40)).toBe(CONSULTA_LENTA_MS);
  });

  it('encaminharNoItem: no item da resposta (montada ou texto fixo) da pergunta que pode ser encaminhada; na própria pergunta que falhou sem resposta; nunca na de risco', () => {
    const p1 = msg({ texto: 'a', status: 'respondida', podeEncaminhar: true });
    const r1 = msg({ autor: 'ia', texto: 'No seu plano está assim:' });
    const p2 = msg({ texto: 'b', status: 'respondida', podeEncaminhar: true });
    const r2 = msg({ autor: 'ia', textoFixo: 'nao_encontrei' });
    const p3 = msg({ texto: 'c', status: 'falhou', podeEncaminhar: true });
    const p4 = msg({ texto: 'd', status: 'respondida', risco: true });
    const r4 = msg({ autor: 'ia', textoFixo: 'risco_transtorno' });
    const p5 = msg({ texto: 'e', status: 'respondida', podeEncaminhar: false, duvida: 'aberta' });
    const r5 = msg({ autor: 'ia', texto: 'x' });
    const ms = [p1, r1, p2, r2, p3, p4, r4, p5, r5];
    expect(ms.map((_, i) => encaminharNoItem(ms, i))).toEqual([null, p1.id, null, p2.id, p3.id, null, null, null, null]);
  });

  it('depois de perguntar (ok ou risco) o campo esvazia; no risco sem mensagem gravada, o texto fixo vem no retorno; "Pensando…" só no ok', () => {
    expect(estadoDoRetorno({ limpar: true })).toEqual({ limpar: true, aviso: MSG_IA_NUTRI.pensando, textoFixo: null, focarTextoFixo: false });
    expect(estadoDoRetorno({ limpar: true, textoFixo: 'risco_emergencia', aviso: MSG_IA_NUTRI.respostaChegou, risco: true })).toEqual({
      limpar: true,
      aviso: MSG_IA_NUTRI.respostaChegou,
      textoFixo: 'risco_emergencia',
      focarTextoFixo: true,
    });
    expect(estadoDoRetorno({ aviso: MSG_IA_NUTRI.limiteDia })).toEqual({ limpar: false, aviso: MSG_IA_NUTRI.limiteDia, textoFixo: null, focarTextoFixo: false });
  });

  it('revisão da T12 (I1): no risco, o foco vai para o texto fixo — o sem mensagem gravada, ou a mensagem NOVA com texto fixo no fim da conversa relida (espera enquanto ela não chega); o contêiner é focável', () => {
    const antes = msg({ autor: 'ia', textoFixo: 'nao_encontrei' });
    const pergunta = msg({ texto: 'x', status: 'respondida', risco: true });
    const aviso = msg({ autor: 'sistema', textoFixo: 'risco_emergencia' });
    const foco = { tipo: 'texto_fixo' as const, depoisDe: antes.id };
    expect(alvoDoFoco(foco, [antes], true)).toEqual({ tipo: 'fixo_sem_mensagem' });
    expect(alvoDoFoco(foco, [antes], false)).toBeNull(); // a conversa relida ainda não chegou: o texto fixo antigo não conta
    expect(alvoDoFoco(foco, [antes, pergunta, aviso], false)).toEqual({ tipo: 'mensagem', id: aviso.id });
    expect(alvoDoFoco({ tipo: 'avaliada', id: 'm1' }, [], false)).toEqual({ tipo: 'avaliada', id: 'm1' });
    const html = tela({ mensagens: [pergunta, aviso] });
    // o leitor de tela lê o bloco inteiro (autor e o texto com o 188 e o 192) quando o foco chega nele
    expect(html).toMatch(new RegExp(`<div id="[^"]*-mensagem-${aviso.id}" tabindex="-1"[^>]*><p[^>]*>Aviso do app</p><p[^>]*>Sinto muito`));
    expect(html).toContain('href="tel:192"');
  });

  it('revisão da T12 (I2): a action que rejeita (rede que cai, erro 500) vira aviso na região — "não disponível" com rede, "Sem conexão" sem; o redirect do Next segue', async () => {
    const falha = () => Promise.reject(new Error('fetch failed'));
    expect(await chamar(falha, () => true)).toEqual({ aviso: MSG_IA_NUTRI.naoDisponivel });
    expect(await chamar(falha, () => false)).toEqual({ aviso: MSG_IA_NUTRI.semConexao });
    expect(await chamar(async () => ({ limpar: true }), () => true)).toEqual({ limpar: true });
    let erroDoRedirect: unknown;
    try {
      redirect('/p/plano/ia');
    } catch (e) {
      erroDoRedirect = e;
    }
    await expect(chamar(() => Promise.reject(erroDoRedirect), () => true)).rejects.toBe(erroDoRedirect);
    // sem `limpar`, o campo não esvazia: o texto digitado continua
    expect(estadoDoRetorno(await chamar(falha, () => true)).limpar).toBe(false);
    // os três pontos que chamam actions passam por `chamar`
    const fonte = readFileSync(path.resolve('src/app/p/(portal)/plano/ia/conversa.tsx'), 'utf8');
    for (const a of ['acao(tenantId, fd)', 'avaliarAction(tenantId, mensagemId, valor)', 'encaminharAction(tenantId, perguntaId)']) expect(fonte, a).toContain(`chamar(() => ${a})`);
  });

  it('revisão da T12 (I3, US-172 "Pergunta longa"): sem maxLength; acima de 500 caracteres (contados por ponto de código) o texto da spec ao lado do contador, ligado ao campo, e os dois botões desabilitados', () => {
    let html = tela({ textoInicial: 'a'.repeat(MAX_PERGUNTA) });
    expect(html).not.toMatch(/maxlength/i);
    expect(html).not.toContain(MSG_IA_NUTRI.longa);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Perguntar<\/button>/);
    html = tela({ textoInicial: '🍎'.repeat(MAX_PERGUNTA + 1) });
    expect(html).toContain(`${MAX_PERGUNTA + 1} de 500 caracteres`);
    const ids = /<textarea[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1].split(' ') ?? [];
    expect(ids).toHaveLength(2);
    expect(html).toMatch(new RegExp(`<p id="${ids[1]}" class="[^"]*text-erro[^"]*">${MSG_IA_NUTRI.longa}</p>`));
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Perguntar<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Enviar direto para minha nutricionista<\/button>/);
  });

  it('revisão da T12 (I4): só as 20 últimas mensagens, sem começar por uma resposta solta, e "Mostrar mensagens anteriores" (44 px) antes da lista', () => {
    const conversa = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? msg({ texto: `Pergunta ${i}`, status: 'respondida' }) : msg({ autor: 'ia', texto: `Resposta ${i}` })));
    expect(inicioVisivel(conversa, MENSAGENS_NA_TELA)).toBe(10);
    expect(inicioVisivel(conversa, 19)).toBe(10); // 11 seria a resposta da pergunta 10: começa na pergunta
    expect(inicioVisivel(conversa.slice(0, 8), MENSAGENS_NA_TELA)).toBe(0);
    let html = tela({ mensagens: conversa });
    expect(html).not.toContain('>Pergunta 8<');
    expect(html).toContain('>Pergunta 10<');
    expect(html).toContain('>Resposta 29<');
    expect(html).toMatch(new RegExp(`<button type="button" class="[^"]*min-h-11[^"]*">${MSG_IA_NUTRI.mostrarAnteriores}</button><ol`));
    html = tela({ mensagens: conversa.slice(0, 8) });
    expect(html).not.toContain(MSG_IA_NUTRI.mostrarAnteriores);
  });

  it('revisão da T12 (I4): "Obrigado pela avaliação." e "Pronto!…" são focáveis — o foco fica no lugar do item, não no fim da página', () => {
    const p = msg({ texto: 'a', status: 'respondida', duvida: 'aberta' });
    const r = msg({ autor: 'ia', texto: 'b', avaliacao: 'ajudou' });
    const html = tela({ mensagens: [p, r] });
    expect(html).toMatch(new RegExp(`<p id="[^"]*-avaliada-${r.id}" tabindex="-1"[^>]*>${MSG_IA_NUTRI.avaliado}</p>`));
    expect(html).toMatch(new RegExp(`<p id="[^"]*-encaminhada-${p.id}" tabindex="-1"[^>]*>${MSG_IA_NUTRI.encaminhada}</p>`));
    expect(TEXTOS_FIXOS.risco_emergencia).toContain('192');
  });

  it('"A resposta chegou." quando a pergunta em andamento termina (e só então)', () => {
    expect(chegouResposta(true, false)).toBe(true);
    expect(chegouResposta(false, false)).toBe(false);
    expect(chegouResposta(false, true)).toBe(false);
    expect(chegouResposta(true, true)).toBe(false);
  });

  it('UMA região de status para tudo: sem conexão vence; em andamento ou enviando → "Pensando…"; senão o último aviso', () => {
    expect(textoDoStatus({ online: false, emAndamento: true, enviando: false, aviso: 'x' })).toBe(MSG_IA_NUTRI.semConexao);
    expect(textoDoStatus({ online: true, emAndamento: true, enviando: false, aviso: 'x' })).toBe(MSG_IA_NUTRI.pensando);
    expect(textoDoStatus({ online: true, emAndamento: false, enviando: true, aviso: 'x' })).toBe(MSG_IA_NUTRI.pensando);
    expect(textoDoStatus({ online: true, emAndamento: false, enviando: false, aviso: MSG_IA_NUTRI.respostaChegou })).toBe(MSG_IA_NUTRI.respostaChegou);
  });

  it('sem internet: "Sem conexão. Pergunte quando voltar." na MESMA região role="status" (não num <p> à parte) e os botões desabilitados', () => {
    s.online = false;
    try {
      const html = renderToStaticMarkup(createElement(Conversa, { tenantId: 't1', mensagens: [], podePerguntar: true, sessaoNova: true, textoInicial: 'Sobre Almoço: ' }));
      expect(html).toMatch(new RegExp(`<p tabindex="-1" role="status"[^>]*>${MSG_IA_NUTRI.semConexao}</p>`));
      expect(html.split(MSG_IA_NUTRI.semConexao)).toHaveLength(2);
      expect(html.split('role="status"')).toHaveLength(2);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Perguntar<\/button>/);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Enviar direto para minha nutricionista<\/button>/);
      // tocado antes da hidratação, a pergunta (dado de saúde) nunca vai para a URL (regra 3)
      expect(html).toMatch(/<form[^>]*method="post"/);
    } finally {
      s.online = true;
    }
  });

  it('a pergunta em andamento: "Pensando…" na região e "Perguntar" desabilitado; alvos de 44 px', () => {
    const html = renderToStaticMarkup(createElement(Conversa, { tenantId: 't1', mensagens: [msg({ texto: 'a', status: 'processando' })], podePerguntar: true, sessaoNova: false, textoInicial: null }));
    expect(html).toMatch(/role="status"[^>]*>Pensando…<\/p>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Perguntar<\/button>/);
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toMatch(/\bmin-h-11\b/);
  });

  it('/code-review do PR #37: conversa.tsx tem exatamente UM router.refresh() — o da consulta automática, quando a resposta chega — e a consulta manda o cabeçalho de consulta automática', () => {
    const fonte = readFileSync(path.resolve('src/app/p/(portal)/plano/ia/conversa.tsx'), 'utf8');
    expect(fonte.match(/router\.refresh\(\)/g)).toHaveLength(1);
    expect(fonte).toMatch(/fetch\('\/api\/p\/ia-nutri\/situacao', CONSULTA_AUTOMATICA\)/);
    expect(fonte).not.toMatch(/localStorage|sessionStorage/); // nada da pergunta guardado no aparelho
  });
});
