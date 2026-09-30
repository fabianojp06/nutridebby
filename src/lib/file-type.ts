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
// M10: mif1/msf1 são marcas genéricas do HEIF, usadas também pelo AVIF (AV1). HEIC só com uma
// marca HEVC declarada (principal ou compatível) e nenhuma marca AV1 na caixa ftyp.
const MARCAS_HEVC = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'];
const MARCAS_HEIF_GENERICAS = ['mif1', 'msf1'];
const MARCAS_AV1 = ['avif', 'avis'];
// T8-R1: o comentário usa `-(?!->)` (não `[\s\S]*?`) para que "onde termina o comentário" nunca
// seja ambíguo — sem isso, muitos "-->" seguidos (`'<!---->'.repeat(n)`) causam backtracking
// exponencial no motor de regex (o próprio detectarTipo roda em todo upload).
const SVG = /^\s*(<\?xml[^>]*\?>\s*)?(<!--(?:[^-]|-(?!->))*-->\s*)*(<!DOCTYPE\s+svg[^>[]*>\s*)?<svg[\s/>]/i;

/** Tipo real do arquivo pelos primeiros bytes (RNF-06): o nome e o Content-Type do cliente são ignorados. */
export function detectarTipo(buf: Uint8Array): TipoArquivo | null {
  if (bytesEm(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (bytesEm(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (textoEm(buf, '%PDF-')) return { mime: 'application/pdf', ext: 'pdf' };
  if (textoEm(buf, 'RIFF') && textoEm(buf, 'WEBP', 8)) return { mime: 'image/webp', ext: 'webp' };
  if (textoEm(buf, 'ftyp', 4) && ehHeic(buf)) return { mime: 'image/heic', ext: 'heic' };
  if (ehSvg(buf)) return { mime: 'image/svg+xml', ext: 'svg' };
  return null;
}

/** Caixa ftyp: tamanho(4) 'ftyp'(4) marca principal(4) versão(4) marcas compatíveis(4 cada). */
function ehHeic(buf: Uint8Array): boolean {
  const marca = (i: number) => String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
  if (buf.length < 12) return false;
  const principal = marca(8);
  const tamanho = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  const fim = Math.min(buf.length, tamanho >= 16 ? tamanho : buf.length, 16 + 4 * 64);
  const compativeis: string[] = [];
  for (let i = 16; i + 4 <= fim; i += 4) compativeis.push(marca(i));
  const todas = [principal, ...compativeis];
  if (todas.some((m) => MARCAS_AV1.includes(m))) return false;
  if (MARCAS_HEVC.includes(principal)) return true;
  return MARCAS_HEIF_GENERICAS.includes(principal) && compativeis.some((m) => MARCAS_HEVC.includes(m));
}

/** BOM UTF-8 e espaço em branco ASCII não contam para decidir se "parece" começar uma tag. */
function pareceComecarComTag(buf: Uint8Array): boolean {
  let i = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  const limite = Math.min(buf.length, 4096);
  while (i < limite && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0d || buf[i] === 0x0a)) i++;
  return i < buf.length && buf[i] === 0x3c; // '<'
}

function ehSvg(buf: Uint8Array): boolean {
  if (!buf.length) return false;
  // T8-R1: sai antes de decodificar um buffer possivelmente grande (MBs) que claramente não
  // começa com "<" (BOM/espaço à parte) — arquivo binário comum não chega nem perto do XML/SVG.
  if (!pareceComecarComTag(buf)) return false;
  const texto = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
  if (/<!ENTITY/i.test(texto)) return false; // XXE e "billion laughs": recusado sempre
  return SVG.test(texto.slice(0, 4096));
}
