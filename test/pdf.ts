import { inflateSync } from 'node:zlib';

/**
 * Texto do PDF do @react-pdf (streams Flate, strings hex em WinAnsi): o suficiente para conferir o conteúdo.
 * O fim do stream é só o `\nendstream` (o pdfkit escreve `stream\n<dados>\nendstream`): com `\r?` antes do `\n`, o
 * stream comprimido cujo último byte é 0x0D (o byte baixo do Adler-32, ~1 em 256, e o conteúdo muda com o código e a
 * data) perdia esse byte, o inflate falhava e o texto da página sumia (SUS-98). Um `\r` de um PDF com fim de linha
 * CRLF fica no fim dos dados, e o inflate ignora o que vem depois do fim do stream zlib.
 */
export function textoDoPdf(pdf: Buffer): string {
  let texto = '';
  for (const m of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\nendstream/g)) {
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

/** Páginas do PDF: os objetos `/Type /Page` (o `/Type /Pages` da árvore não conta). */
export const paginasDoPdf = (pdf: Buffer): number => pdf.toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
