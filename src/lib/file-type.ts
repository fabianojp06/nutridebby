export type TipoArquivo =
  | { mime: 'image/png'; ext: 'png' }
  | { mime: 'image/jpeg'; ext: 'jpg' }
  | { mime: 'image/webp'; ext: 'webp' }
  | { mime: 'image/heic'; ext: 'heic' }
  | { mime: 'application/pdf'; ext: 'pdf' }
  | { mime: 'image/svg+xml'; ext: 'svg' };

const bytesEm = (buf: Uint8Array, bytes: readonly number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((x, i) => buf[offset + i] === x);
const textoEm = (buf: Uint8Array, s: string, offset = 0) => bytesEm(buf, [...s].map((c) => c.charCodeAt(0)), offset);
const MARCAS_HEIC = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];
const SVG = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^>[]*>\s*)?<svg[\s/>]/i;

/** Tipo real do arquivo pelos primeiros bytes (RNF-06): o nome e o Content-Type do cliente são ignorados. */
export function detectarTipo(buf: Uint8Array): TipoArquivo | null {
  if (bytesEm(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (bytesEm(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (textoEm(buf, '%PDF-')) return { mime: 'application/pdf', ext: 'pdf' };
  if (textoEm(buf, 'RIFF') && textoEm(buf, 'WEBP', 8)) return { mime: 'image/webp', ext: 'webp' };
  if (textoEm(buf, 'ftyp', 4) && MARCAS_HEIC.some((m) => textoEm(buf, m, 8))) return { mime: 'image/heic', ext: 'heic' };
  if (ehSvg(buf)) return { mime: 'image/svg+xml', ext: 'svg' };
  return null;
}

function ehSvg(buf: Uint8Array): boolean {
  if (!buf.length) return false;
  const texto = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
  if (/<!ENTITY/i.test(texto)) return false; // XXE e "billion laughs": recusado sempre
  return SVG.test(texto.slice(0, 4096));
}
