import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { CAPA_LADO_MAX, processarCapa } from './capa';

const imagem = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#fa0' } });

describe('capa do conteúdo (D8, US-051)', () => {
  it('PNG grande com EXIF → JPEG de no máximo 1280 px, sem metadados', async () => {
    const png = await imagem(3000, 2000).withExif({ IFD0: { Copyright: 'Fulana', ImageDescription: 'GPS aqui' } }).png().toBuffer();
    const out = await processarCapa(png);
    const m = await sharp(out).metadata();
    expect(m.format).toBe('jpeg');
    expect(Math.max(m.width!, m.height!)).toBe(CAPA_LADO_MAX);
    expect(m.exif).toBeUndefined();
  });

  it('não aumenta imagem pequena', async () => {
    const out = await processarCapa(await imagem(400, 300).jpeg().toBuffer());
    expect((await sharp(out).metadata()).width).toBe(400);
  });

  it('PNG com transparência → fundo branco (sem o flatten o JPEG sai preto), como a foto do diário', async () => {
    const transparente = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data } = await sharp(await processarCapa(transparente)).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(data[0], data[1], data[2])).toBeGreaterThan(245);
  });

  it('recusa o que não é JPEG/PNG (upload da nutricionista) e o arquivo corrompido', async () => {
    const webp = await imagem(10, 10).webp().toBuffer();
    await expect(processarCapa(webp, ['jpg', 'png'])).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    expect(await processarCapa(webp)).toBeInstanceOf(Buffer); // a miniatura do oEmbed pode vir em WebP
    await expect(processarCapa(Buffer.from('%PDF-1.7 x'))).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    const quebrado = Buffer.concat([(await imagem(50, 50).jpeg().toBuffer()).subarray(0, 40)]);
    await expect(processarCapa(quebrado)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
  });
});
