import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { secoesDoPortal } from '@/app/p/navegacao';
import { BarraDeAcoes } from './barra-de-acoes';
import { CabecalhoDetalhe } from './cabecalho-detalhe';
import { Faixa } from './faixa';

const MARCA = { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: '/api/arquivos?x=1' };

describe('moldura do portal (Plano 16, §4.2)', () => {
  it('faixa: marca, h1 da seção, nav "Seções" com a atual marcada (aria-current + pílula), foco branco (data-sobre-marca)', () => {
    const html = renderToStaticMarkup(createElement(Faixa, { marca: MARCA, titulo: 'Plano de hoje', secoes: secoesDoPortal({ exames: true }), atual: '/p/plano' }));
    // (o React 19 põe um <link rel="preload"> do logo antes: sem âncora no começo)
    expect(html).toMatch(/<header data-sobre-marca="" data-guia="faixa" class="[^"]*\bbg-faixa\b[^"]*\btext-white\b/);
    expect(html).toContain('Acompanhamento com Consultório Debby');
    expect(html).toContain('alt="Logo de Consultório Debby"');
    expect(html).toMatch(/<h1[^>]*>Plano de hoje<\/h1>/);
    expect(html).toContain('<nav aria-label="Seções"');
    expect(html).toMatch(/<ul class="[^"]*\bgrid-cols-5\b/);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/p\/plano"|<a [^>]*href="\/p\/plano"[^>]*aria-current="page"/);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-guia="secao-eu"');
    expect(html).toMatch(/<\/header><p role="status"/); // o SeloOffline logo depois da faixa (região viva sempre montada)
  });

  it('quatro seções sem "Exames" (RN-192): grade de 4 colunas', () => {
    const html = renderToStaticMarkup(createElement(Faixa, { marca: MARCA, titulo: 'Eu', secoes: secoesDoPortal({ exames: false }), atual: '/p/perfil' }));
    expect(html).toMatch(/<ul class="[^"]*\bgrid-cols-4\b/);
    expect(html).not.toContain('>Exames<');
  });

  it('tela de detalhe: "Voltar" de 44 px com nome acessível e o h1 focável, sem a lista de seções', () => {
    const html = renderToStaticMarkup(createElement(CabecalhoDetalhe, { titulo: 'Minhas consultas', voltar: { href: '/p/jornada', secao: 'Jornada' } }));
    expect(html).toMatch(/<a [^>]*aria-label="Voltar para Jornada"/);
    expect(html).toContain('href="/p/jornada"');
    expect(html).toMatch(/<a [^>]*class="[^"]*\bsize-11\b/);
    expect(html).toMatch(/<h1 id="titulo-da-tela" tabindex="-1"[^>]*>Minhas consultas<\/h1>/);
    expect(html).not.toContain('aria-label="Seções"');
  });

  it('barra de ações (só em Hoje): "Enviar exame" só com o recebimento ligado (RN-215); "Agendar" leva a Minhas consultas no teto', () => {
    const com = renderToStaticMarkup(createElement(BarraDeAcoes, { exames: true, podeAgendar: true }));
    expect(com).toContain('<nav aria-label="Ações" data-guia="acoes"');
    expect(com).toMatch(/href="\/p\/diario\?foto=1#registrar"[^>]*>.*Foto da refeição/);
    expect(com).toMatch(/href="\/p\/exames#enviar"[^>]*>.*Enviar exame/);
    expect(com).toMatch(/href="\/p\/agenda\/nova"[^>]*>.*Agendar/);
    const sem = renderToStaticMarkup(createElement(BarraDeAcoes, { exames: false, podeAgendar: false }));
    expect(sem).not.toContain('Enviar exame');
    expect(sem).toMatch(/href="\/p\/agenda"[^>]*>.*Agendar/);
  });
});
