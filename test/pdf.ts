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

/** Texto desenhado num ponto da página, em pt, com a origem no canto de baixo à esquerda (como o PDF). */
export type TextoNaPagina = { texto: string; x: number; y: number };

type Matriz = [number, number, number, number, number, number];
const vezes = (m: Matriz, n: Matriz): Matriz => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/**
 * Onde cada texto do PDF do @react-pdf foi desenhado, página a página: segue `q`/`Q`/`cm`/`Tm` do content stream de cada
 * página (um stream com `TJ` por página, na ordem) até cada `TJ`. Só o necessário para conferir que um bloco ficou dentro
 * da página (SUS-99: o rodapé com o número da página saía em y de milhares de pt).
 */
export function textosPorPagina(pdf: Buffer): TextoNaPagina[][] {
  const paginas: TextoNaPagina[][] = [];
  for (const m of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let conteudo: string;
    try {
      conteudo = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    if (!/\bTJ\b/.test(conteudo)) continue;
    const textos: TextoNaPagina[] = [];
    let ctm: Matriz = [1, 0, 0, 1, 0, 0];
    let tm: Matriz = [1, 0, 0, 1, 0, 0];
    const pilha: Matriz[] = [];
    let operandos: string[] = [];
    for (const [tok] of conteudo.matchAll(/\[[^\]]*\]|<[0-9a-fA-F]*>|\/[^\s/[\]<>()]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[A-Za-z*'"]+/g)) {
      if (!/^[A-Za-z*'"]/.test(tok)) {
        operandos.push(tok);
        continue;
      }
      const nums = operandos.slice(-6).map(Number) as Matriz;
      if (tok === 'q') pilha.push(ctm);
      else if (tok === 'Q') ctm = pilha.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (tok === 'cm') ctm = vezes(ctm, nums);
      else if (tok === 'Tm') tm = nums;
      else if (tok === 'TJ' || tok === 'Tj') {
        const p = vezes(ctm, tm);
        const texto = [...(operandos.at(-1) ?? '').matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('');
        textos.push({ texto, x: p[4], y: p[5] });
      }
      operandos = [];
    }
    paginas.push(textos);
  }
  return paginas;
}

/**
 * O rodapé de cada página: a linha que começa com `rotulo` e o número "k/n" (n = total de páginas), com a posição de cada um.
 * A4: a linha deve ficar dentro da margem de baixo (0 < y < 36) e o número na mesma linha do rótulo.
 */
export function rodapesDoPdf(pdf: Buffer, rotulo: string) {
  const paginas = textosPorPagina(pdf);
  return paginas.map((textos, i) => ({
    rotulo: textos.find((t) => t.texto.startsWith(rotulo)),
    numero: textos.find((t) => t.texto === `${i + 1}/${paginas.length}`),
  }));
}
