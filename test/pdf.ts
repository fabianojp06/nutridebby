import { inflateSync } from 'node:zlib';

/** Texto do PDF do @react-pdf (streams Flate, strings hex em WinAnsi): o suficiente para conferir o conteúdo. */
export function textoDoPdf(pdf: Buffer): string {
  let texto = '';
  for (const m of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let conteudo: string;
    try {
      conteudo = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const h of conteudo.matchAll(/<([0-9a-fA-F]+)>/g))
      texto += Buffer.from(h[1], 'hex').toString('latin1');
    texto += '\n';
  }
  return texto;
}
