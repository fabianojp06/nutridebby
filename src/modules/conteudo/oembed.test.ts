import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { miniaturaDoVideo, urlDaMiniatura } from './oembed';

let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#2a7' } }).jpeg().toBuffer();
});

type Resposta = { status?: number; corpo: string | Buffer; tipo?: string };
/** fetch falso: devolve as respostas na ordem e anota os endereços pedidos. */
function falso(...respostas: Resposta[]) {
  const pedidos: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    pedidos.push(String(url));
    expect(init?.redirect).toBe('error'); // D9: nunca segue redirecionamento
    const r = respostas.shift();
    if (!r) throw new Error('pedido a mais');
    return new Response(typeof r.corpo === 'string' ? r.corpo : new Uint8Array(r.corpo), { status: r.status ?? 200, headers: { 'content-type': r.tipo ?? 'application/json' } });
  }) as typeof fetch;
  return { f, pedidos };
}
const YT = { provider: 'youtube', id: 'dQw4w9WgXcQ' } as const;
const oembed = (thumb: string) => ({ corpo: JSON.stringify({ title: 'x', thumbnail_url: thumb }) });

describe('capa do vídeo pelo oEmbed (INT-05, D9)', () => {
  it('YouTube: pede o oEmbed com a URL canônica e baixa a miniatura de i.ytimg.com', async () => {
    const { f, pedidos } = falso(oembed('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), { corpo: jpeg, tipo: 'image/jpeg' });
    const buf = await miniaturaDoVideo(YT, { fetchImpl: f });
    expect(buf?.equals(jpeg)).toBe(true);
    expect(pedidos).toEqual([
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    ]);
  });

  it('Vimeo: oembed.json e i.vimeocdn.com', async () => {
    const { f, pedidos } = falso(oembed('https://i.vimeocdn.com/video/1.jpg'), { corpo: jpeg });
    expect(await miniaturaDoVideo({ provider: 'vimeo', id: '76979871' }, { fetchImpl: f })).not.toBeNull();
    expect(pedidos[0]).toBe('https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871&format=json');
  });

  it('miniatura de outro host, http ou com credenciais: nem pede (sem SSRF)', async () => {
    for (const thumb of ['https://169.254.169.254/latest', 'http://i.ytimg.com/x.jpg', 'https://u:p@i.ytimg.com/x.jpg', 'https://i.ytimg.com.evil.com/x.jpg']) {
      const { f, pedidos } = falso(oembed(thumb));
      expect(await miniaturaDoVideo(YT, { fetchImpl: f }), thumb).toBeNull();
      expect(pedidos, thumb).toHaveLength(1);
    }
  });

  it('erro, corpo grande, JSON inválido, miniatura que não é imagem → null (capa padrão)', async () => {
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso({ status: 404, corpo: 'Not Found' }).f })).toBeNull();
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso({ corpo: 'x'.repeat(70 * 1024) }).f })).toBeNull();
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso({ corpo: '<html>' }).f })).toBeNull();
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso(oembed('https://i.ytimg.com/x.jpg'), { corpo: '<svg/>', tipo: 'image/svg+xml' }).f })).toBeNull();
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso(oembed('https://i.ytimg.com/x.jpg'), { corpo: Buffer.alloc(3 * 1024 * 1024, 0xff) }).f })).toBeNull();
  });

  it('demora mais que o prazo (US-050: > 5 s) → null, sem esperar', async () => {
    const lento = ((_u: unknown, init?: RequestInit) =>
      new Promise((_, rej) => init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason)))) as typeof fetch;
    const t0 = Date.now();
    expect(await miniaturaDoVideo(YT, { fetchImpl: lento, prazoMs: 50 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('urlDaMiniatura só aceita https de i.ytimg.com e i.vimeocdn.com', () => {
    expect(urlDaMiniatura('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg');
    expect(urlDaMiniatura('https://i.vimeocdn.com/video/1-d_640')).toBe('https://i.vimeocdn.com/video/1-d_640');
    for (const u of ['https://i.ytimg.com:444/x', 'https://ytimg.com/x', 42, null, 'nao é url']) expect(urlDaMiniatura(u)).toBeNull();
  });
});
