import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerVideo } from '@/components/player-video';
import { describe, expect, it } from 'vitest';
import { lerLinkDeVideo, urlDoPlayer, urlDoVideo, videoDoConteudo } from './video';

describe('link de vídeo (RN-10, INT-05, US-050)', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://youtu.be/dQw4w9WgXcQ?t=30', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['youtu.be/dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['http://m.youtube.com/watch?v=dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://vimeo.com/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://vimeo.com/76979871/abcdef1234', { provider: 'vimeo', id: '76979871/abcdef1234' }],
    ['https://vimeo.com/channels/staffpicks/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://player.vimeo.com/video/76979871?h=abcdef1234', { provider: 'vimeo', id: '76979871/abcdef1234' }],
  ])('aceita %s', (url, esperado) => {
    expect(lerLinkDeVideo(url)).toEqual(esperado);
  });

  it.each([
    'https://tiktok.com/@x/video/1', // US-050 "Domínio não suportado"
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://evil.com/youtu.be/dQw4w9WgXcQ',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://youtu.be/dQw4w9WgXc', // 10 caracteres
    'https://youtu.be/dQw4w9WgXcQQ', // 12
    'https://www.youtube.com/watch?v=dQw4w9W"><x',
    'https://user:senha@youtu.be/dQw4w9WgXcQ',
    'https://youtu.be:8443/dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=PL1',
    'https://vimeo.com/abc',
    'https://vimeo.com/76979871/ABC"x',
    'ftp://vimeo.com/76979871',
    '',
    'x'.repeat(600),
    42,
    null,
  ])('recusa %s', (url) => {
    expect(lerLinkDeVideo(url)).toBeNull();
  });

  it('player sem cookies (US-050) / sem rastreamento (D10), montado só do id', () => {
    expect(urlDoPlayer({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(urlDoPlayer({ provider: 'vimeo', id: '76979871' })).toBe('https://player.vimeo.com/video/76979871?dnt=1');
    expect(urlDoPlayer({ provider: 'vimeo', id: '76979871/abcdef1234' })).toBe('https://player.vimeo.com/video/76979871?h=abcdef1234&dnt=1');
    expect(urlDoVideo({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(urlDoVideo({ provider: 'vimeo', id: '76979871/abcdef1234' })).toBe('https://vimeo.com/76979871/abcdef1234');
  });

  it('videoDoConteudo relê o que o banco guardou (e recusa o que não bate com o provedor)', () => {
    expect(videoDoConteudo({ videoProvider: 'vimeo', videoId: '76979871/abcdef1234' })).toEqual({ provider: 'vimeo', id: '76979871/abcdef1234' });
    expect(videoDoConteudo({ videoProvider: 'youtube', videoId: '76979871' })).toBeNull();
    expect(videoDoConteudo({ videoProvider: null, videoId: null })).toBeNull();
  });
});

describe('PlayerVideo (D10)', () => {
  it('iframe do youtube-nocookie com título, lazy e referrer só da origem; nada de youtube.com/embed', () => {
    const html = renderToStaticMarkup(createElement(PlayerVideo, { video: { provider: 'youtube', id: 'dQw4w9WgXcQ' }, titulo: 'Como montar o prato' }));
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('title="Vídeo: Como montar o prato"');
    expect(html).toContain('loading="lazy"');
    expect(html).toMatch(/referrerpolicy="strict-origin-when-cross-origin"/i); // o React pode escrever o atributo em minúsculas
    expect(html).not.toContain('youtube.com/embed');
  });
});
