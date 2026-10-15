import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CONSULTA_LENTA_MS, CONSULTA_RAPIDA_MS, MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import type { MensagemDoPaciente } from '@/modules/ia/nutri-paciente/conversa';

// (Os testes do projeto são `.ts`, sem JSX: createElement. Sem DOM: a lógica pura da tela e o HTML do servidor.)
const s = vi.hoisted(() => ({ online: true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/components/portal/online', () => ({ useOnline: () => s.online }));
vi.mock('./actions', () => ({
  perguntarAction: async () => ({}),
  enviarANutriAction: async () => ({}),
  avaliarAction: async () => ({}),
  encaminharAction: async () => ({}),
}));
const { Conversa, chegouResposta, encaminharNoItem, estadoDoRetorno, proximoIntervalo, textoDoStatus } = await import('./conversa');

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
    expect(estadoDoRetorno({ limpar: true })).toEqual({ limpar: true, aviso: MSG_IA_NUTRI.pensando, textoFixo: null });
    expect(estadoDoRetorno({ limpar: true, textoFixo: 'risco_emergencia', aviso: '' })).toEqual({ limpar: true, aviso: '', textoFixo: 'risco_emergencia' });
    expect(estadoDoRetorno({ aviso: MSG_IA_NUTRI.limiteDia })).toEqual({ limpar: false, aviso: MSG_IA_NUTRI.limiteDia, textoFixo: null });
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
