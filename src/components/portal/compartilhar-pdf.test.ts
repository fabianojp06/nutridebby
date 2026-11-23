import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompartilharPdf, DIGITAR_CODIGO, MSG_COMPARTILHAR } from './compartilhar-pdf';
import { erroDoCompartilhar, faseDaResposta, jeitoDeEntregar, nomeDoPdf, paginaDoLink } from './compartilhar-pdf-estado';

const URL_PORTAL = '/api/p/documentos/00000000-0000-4000-8000-0000000000d1/pdf';
const URL_LINK = '/api/documento/abc/pdf';
const render = (tipo: 'receita' | 'parecer' | 'solicitacao_exames', url = URL_PORTAL) =>
  renderToStaticMarkup(createElement(CompartilharPdf, { url, tipo, data: '12/11/2026', nomeDoArquivo: nomeDoPdf(tipo, '12/11/2026') }));

describe('"Compartilhar" o PDF assinado (Plano 22, US-380, RN-396)', () => {
  it('textos exatos da spec §6.2', () => {
    expect(MSG_COMPARTILHAR).toEqual({
      preparar: 'Preparar para compartilhar',
      preparando: 'Preparando o PDF…',
      pronto: 'PDF pronto. Toque em Compartilhar.',
      compartilhar: 'Compartilhar',
      porTipo: { receita: 'Envie à farmácia que você escolher.', parecer: 'Envie a quem você escolher.', solicitacao_exames: 'Envie ao laboratório que você escolher.' },
      objeto: { receita: 'a receita', parecer: 'o parecer nutricional', solicitacao_exames: 'a solicitação de exames laboratoriais' },
      saude: 'O PDF tem dados da sua saúde. Envie só a quem você quiser que veja.',
      semSuporte: 'Este aparelho não consegue compartilhar o arquivo. O PDF foi baixado; envie pelo aplicativo que preferir.',
      venceu: 'O acesso venceu. Digite o código de novo.',
      falha: 'Não foi possível preparar o PDF. Tente de novo.',
    });
  });

  it('antes do toque: a região de status já está montada (vazia), só "Preparar para compartilhar" e nenhum "Compartilhar"', () => {
    const html = render('receita');
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(html).toContain('>Preparar para compartilhar<span class="sr-only"> a receita de 12/11/2026</span></button>');
    expect(html).not.toMatch(/>Compartilhar</);
    expect(html).not.toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*class="[^"]*\bmin-h-11\b/); // alvo ≥ 44 px
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it('nome acessível e texto por tipo, nos três com o aviso de dado de saúde (o botão descrito pelos textos)', () => {
    const casos = [
      ['receita', 'a receita de 12/11/2026', 'Envie à farmácia que você escolher.'],
      ['parecer', 'o parecer nutricional de 12/11/2026', 'Envie a quem você escolher.'],
      ['solicitacao_exames', 'a solicitação de exames laboratoriais de 12/11/2026', 'Envie ao laboratório que você escolher.'],
    ] as const;
    for (const [tipo, nome, texto] of casos) {
      const html = render(tipo);
      expect(html, tipo).toContain(`Preparar para compartilhar<span class="sr-only"> ${nome}</span>`);
      expect(html, tipo).toContain(texto);
      expect(html, tipo).toContain(MSG_COMPARTILHAR.saude);
      const id = /<p id="([^"]+)"[^>]*>[^<]*Envie/.exec(html)?.[1];
      expect(id, tipo).toBeTruthy();
      expect(html, tipo).toMatch(new RegExp(`<button[^>]*aria-describedby="${id}"`));
    }
  });

  it('a resposta da rota decide: PDF → pronto; 303 do link (a página do código, em HTML) → venceu; recusa do portal; o resto → falha', () => {
    expect(faseDaResposta({ ok: true, status: 200, contentType: 'application/pdf' }, URL_PORTAL)).toBe('pronto');
    expect(faseDaResposta({ ok: true, status: 200, contentType: 'application/pdf' }, URL_LINK)).toBe('pronto');
    // a do link responde 303 para /documento/{token} quando a sessão de 15 min venceu: o fetch segue e chega o HTML
    expect(faseDaResposta({ ok: true, status: 200, contentType: 'text/html; charset=utf-8' }, URL_LINK)).toBe('venceu');
    expect(faseDaResposta({ ok: false, status: 303, contentType: null }, URL_LINK)).toBe('venceu');
    expect(faseDaResposta({ ok: false, status: 0, contentType: null }, URL_LINK)).toBe('venceu'); // redirect: 'manual' (opaqueredirect)
    // no portal, "Digite o código de novo" não faz sentido: o HTML é falha e a sessão vencida, a recusa de sempre
    expect(faseDaResposta({ ok: true, status: 200, contentType: 'text/html' }, URL_PORTAL)).toBe('falha');
    expect(faseDaResposta({ ok: false, status: 401, contentType: 'application/json' }, URL_PORTAL)).toBe('recusa');
    expect(faseDaResposta({ ok: false, status: 403, contentType: 'application/json' }, URL_PORTAL)).toBe('recusa');
    expect(faseDaResposta({ ok: false, status: 404, contentType: null }, URL_PORTAL)).toBe('falha');
    expect(faseDaResposta({ ok: false, status: 410, contentType: null }, URL_LINK)).toBe('falha'); // URL assinada vencida
    expect(faseDaResposta({ ok: false, status: 500, contentType: 'application/pdf' }, URL_PORTAL)).toBe('falha');
  });

  it('"Compartilhar": pelo compartilhar do aparelho só com canShare({ files }); sem ele (ou recusando o arquivo), o download', () => {
    const files = [new File([new Uint8Array([37, 80, 68, 70])], 'receita.pdf', { type: 'application/pdf' })];
    expect(jeitoDeEntregar({ share: async () => {}, canShare: () => true }, files)).toBe('compartilhar');
    expect(jeitoDeEntregar({ share: async () => {}, canShare: () => false }, files)).toBe('baixar');
    expect(jeitoDeEntregar({ share: async () => {} }, files)).toBe('baixar'); // sem canShare (Firefox no computador)
    expect(jeitoDeEntregar({ canShare: () => true }, files)).toBe('baixar'); // sem share
    expect(jeitoDeEntregar({}, files)).toBe('baixar');
    expect(
      jeitoDeEntregar({ share: async () => {}, canShare: () => { throw new TypeError('x'); } }, files),
    ).toBe('baixar');
  });

  it('fechar a folha sem escolher (AbortError) não mostra erro; outro erro → falha', () => {
    expect(erroDoCompartilhar(new DOMException('cancelado', 'AbortError'))).toBeNull();
    expect(erroDoCompartilhar(Object.assign(new Error('x'), { name: 'AbortError' }))).toBeNull();
    expect(erroDoCompartilhar(new DOMException('sem ativação', 'NotAllowedError'))).toBe('falha');
    expect(erroDoCompartilhar(new Error('x'))).toBe('falha');
    expect(erroDoCompartilhar('x')).toBe('falha');
  });

  it('nome do arquivo baixado: o tipo e a data, sem nada do paciente', () => {
    expect(nomeDoPdf('receita', '12/11/2026')).toBe('receita-12-11-2026.pdf');
    expect(nomeDoPdf('parecer', '12/11/2026')).toBe('parecer-nutricional-12-11-2026.pdf');
    expect(nomeDoPdf('solicitacao_exames', '12/11/2026')).toBe('solicitacao-de-exames-12-11-2026.pdf');
  });

  it('a fonte: um fetch só por toque (botão desabilitado), foco no "Compartilhar" pelo ref, navigator.share com o arquivo e o download por URL.createObjectURL; nada sai pela plataforma', () => {
    const fonte = readFileSync(new URL('./compartilhar-pdf.tsx', import.meta.url), 'utf8');
    expect(fonte.startsWith("'use client';")).toBe(true);
    expect(fonte.match(/fetch\(/g)).toHaveLength(1);
    expect(fonte).toContain('disabled={fase === \'preparando\'}');
    expect(fonte).toContain('botaoCompartilhar.current?.focus()');
    expect(fonte).toContain('navigator.share({ files })');
    expect(fonte).toContain('URL.createObjectURL(');
    expect(fonte).toContain('URL.revokeObjectURL(');
    expect(fonte).not.toMatch(/method:\s*'POST'|sendBeacon|dangerouslySetInnerHTML/);
  });

  it('"O acesso venceu" vem com uma ação: "Digitar o código" leva à página do link, que decide o que mostrar (revisão da P22-11)', () => {
    expect(DIGITAR_CODIGO).toBe('Digitar o código');
    expect(paginaDoLink(URL_LINK)).toBe('/documento/abc');
    expect(paginaDoLink('/api/documento/Ab-_9x/pdf')).toBe('/documento/Ab-_9x');
    // no portal não há código a digitar (a sessão vencida é a recusa de sempre, com o "Entrar")
    expect(paginaDoLink(URL_PORTAL)).toBeNull();
    expect(paginaDoLink('/api/documento/abc/recebido')).toBeNull();
    expect(paginaDoLink('https://outro.example/api/documento/abc/pdf')).toBeNull();
    // a fonte: na fase "venceu", o link ao lado da mensagem (alvo ≥ 44 px), como o da recusa
    const fonte = readFileSync(new URL('./compartilhar-pdf.tsx', import.meta.url), 'utf8');
    expect(fonte).toContain("fase === 'venceu' ? paginaDoLink(url) : null");
    expect(fonte).toContain('{ href: paginaVencida, texto: DIGITAR_CODIGO }');
    expect(fonte).toMatch(/<a href=\{link\.href\} className="[^"]*\bmin-h-11\b/);
  });
});
