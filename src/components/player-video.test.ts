import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerVideo } from './player-video';

describe('PlayerVideo (Plano 07 D10 + Plano 08 D12)', () => {
  it('D12: sem clique, nenhum iframe nem pedido ao provedor — só o botão e o aviso', () => {
    const html = renderToStaticMarkup(createElement(PlayerVideo, { video: { provider: 'youtube', id: 'dQw4w9WgXcQ' }, titulo: 'Como montar o prato' }));
    expect(html).not.toContain('<iframe');
    expect(html).toContain('Carregar o vídeo');
    expect(html).toContain('O vídeo é exibido pelo YouTube.');
    // a cor da marca sobre a moldura preta fica abaixo de 3:1 com marca escura: o foco ali é branco
    expect(html).toContain('[--nd-foco:#ffffff]');
  });

  it('D12: Vimeo também só com o clique, e o aviso cita o Vimeo', () => {
    const html = renderToStaticMarkup(createElement(PlayerVideo, { video: { provider: 'vimeo', id: '76979871' }, titulo: 'Lanches' }));
    expect(html).not.toContain('<iframe');
    expect(html).toContain('O vídeo é exibido pelo Vimeo.');
  });
});
