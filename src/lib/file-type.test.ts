import { describe, expect, it } from 'vitest';
import { detectarTipo } from './file-type';

const b = (...partes: (number[] | string)[]) =>
  Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// PF-B2: o fixture com BOM precisa estar em UTF-8 de verdade (não latin1), senão o BOM não é o BOM.
const BOM_SVG = Buffer.from('﻿<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 1 1"></svg>', 'utf8');

describe('detectarTipo (magic bytes, RNF-06)', () => {
  it('reconhece PNG, JPEG, PDF, WEBP e HEIC pelo conteúdo', () => {
    expect(detectarTipo(b(PNG, [0, 0, 0, 13]))).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectarTipo(b([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectarTipo(b('%PDF-1.7\n'))).toEqual({ mime: 'application/pdf', ext: 'pdf' });
    expect(detectarTipo(b('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(detectarTipo(b([0, 0, 0, 24], 'ftypheic', [0, 0, 0, 0]))).toEqual({ mime: 'image/heic', ext: 'heic' });
  });
  it('reconhece SVG, com ou sem prólogo XML', () => {
    expect(detectarTipo(b('<svg xmlns="http://www.w3.org/2000/svg" width="10"/>'))).toEqual({
      mime: 'image/svg+xml',
      ext: 'svg',
    });
    expect(detectarTipo(BOM_SVG)).toMatchObject({ ext: 'svg' });
  });
  it('recusa HTML com script "renomeado para .png", SVG com <!ENTITY>, texto e vazio (Review Focus 3)', () => {
    expect(detectarTipo(b('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectarTipo(b('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "x">]><svg>&a;</svg>'))).toBeNull();
    expect(detectarTipo(b('olá, não sou imagem'))).toBeNull();
    expect(detectarTipo(new Uint8Array())).toBeNull();
    expect(detectarTipo(b([0, 0, 0, 24], 'ftypavif'))).toBeNull(); // AVIF não é aceito
  });
  it('muitos comentários HTML seguidos não travam o regex (T8-R1: backtracking exponencial)', () => {
    const conteudo = b(`${'<!---->'.repeat(500)}x`);
    const inicio = performance.now();
    expect(detectarTipo(conteudo)).toBeNull();
    expect(performance.now() - inicio).toBeLessThan(50);
  });
});
