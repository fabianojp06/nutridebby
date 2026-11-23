import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { textoDoPdf } from './pdf';

const hex = (s: string) => Buffer.from(s, 'latin1').toString('hex');
/** Um objeto de stream como o pdfkit escreve: `stream\n<dados>\nendstream`. */
const objeto = (dados: Buffer, eol = '\n') =>
  Buffer.concat([Buffer.from(`1 0 obj\n<< /Length ${dados.length} /Filter /FlateDecode >>\nstream${eol}`, 'latin1'), dados, Buffer.from(`${eol}endstream\nendobj\n`, 'latin1')]);

describe('textoDoPdf (SUS-98)', () => {
  it('lê o stream comprimido cujo último byte é 0x0D (antes, o byte saía junto do fim de linha e o texto da página sumia)', () => {
    // o último byte do zlib é o byte baixo do Adler-32: procura um conteúdo que caia em 0x0D (~1 em 256)
    let dados: Buffer | undefined;
    let i = 0;
    for (; i < 100_000 && !dados; i++) {
      const d = deflateSync(Buffer.from(`BT <${hex('Parecer nutricional')}> Tj <${hex(` ${i}`)}> Tj ET`, 'latin1'));
      if (d[d.length - 1] === 0x0d) dados = d;
    }
    expect(dados).toBeDefined();
    expect(textoDoPdf(objeto(dados!))).toContain(`Parecer nutricional ${i - 1}`);
  });

  it('continua lendo o PDF com fim de linha CRLF antes do endstream', () => {
    const dados = deflateSync(Buffer.from(`BT <${hex('Plano alimentar')}> Tj ET`, 'latin1'));
    expect(textoDoPdf(objeto(dados, '\r\n'))).toContain('Plano alimentar');
  });
});
