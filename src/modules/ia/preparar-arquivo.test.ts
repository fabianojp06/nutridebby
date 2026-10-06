import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { fotoDeTeste, pdfDeTeste } from '../../../test/ia';
import { LADO_MAX_IMAGEM, prepararLaudo, PreparoError } from './preparar-arquivo';

const execFileP = promisify(execFile);

/** Roda o preparo num Node novo (com tsx) e devolve o pico de RSS acima do de antes do preparo. */
const MEDIR_PREPARO = `
import { readFileSync } from 'node:fs';
const { prepararLaudo } = await import('./src/modules/ia/preparar-arquivo.ts');
const pdf = readFileSync(process.argv[1]);
globalThis.gc();
const antes = process.memoryUsage().rss;
const r = await prepararLaudo(pdf);
console.log(JSON.stringify({ pico: process.resourceUsage().maxRSS * 1024 - antes, base64: r.base64.length }));
`;

const motivo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PreparoError) return e.motivo;
    throw e;
  }
  return 'sem erro';
};

describe('preparo do laudo (A-D7, RN-110): o que sai do sistema', () => {
  it('PDF: regravado sem Info nem XMP, com as mesmas páginas; o nome do paciente nos metadados não sai', async () => {
    const original = await pdfDeTeste({ paginas: 3, titulo: 'Ana Souza', xmp: '<x:xmpmeta><dc:creator>Ana Souza</dc:creator></x:xmpmeta>' });
    expect(original.includes(Buffer.from('Ana Souza'))).toBe(true);
    const a = await prepararLaudo(original);
    expect(a).toMatchObject({ tipo: 'pdf', paginas: 3 });
    if (a.tipo !== 'pdf') return;
    const bytes = Buffer.from(a.base64, 'base64');
    expect(bytes.includes(Buffer.from('Ana Souza'))).toBe(false);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getProducer()).toBeUndefined();
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
  });

  it('XMP pendurado na página e numa imagem (objetos indiretos) também não sai: o pdf-lib grava todo objeto copiado', async () => {
    const doc = await PDFDocument.create();
    const pagina = doc.addPage();
    const xmp = (quem: string) => doc.context.register(doc.context.stream(`<x:xmpmeta><dc:creator>${quem}</dc:creator></x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' }));
    pagina.node.set(PDFName.of('Metadata'), xmp('Ana Souza na pagina'));
    pagina.node.set(PDFName.of('PieceInfo'), doc.context.register(doc.context.obj({ App: { Private: 'Ana Souza no PieceInfo' } })));
    const imagem = doc.context.stream(Buffer.from([0xff, 0xff, 0xff]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
    imagem.dict.set(PDFName.of('Metadata'), xmp('Ana Souza na imagem'));
    pagina.node.setXObject(PDFName.of('Im1'), doc.context.register(imagem)); // nos recursos da página, como num laudo escaneado
    const original = Buffer.from(await doc.save({ useObjectStreams: false }));
    expect(original.includes(Buffer.from('Ana Souza na pagina'))).toBe(true);
    expect(original.includes(Buffer.from('Ana Souza na imagem'))).toBe(true);
    const a = await prepararLaudo(original);
    const bytes = Buffer.from(a.base64, 'base64');
    expect(bytes.includes(Buffer.from('Ana Souza'))).toBe(false);
    const novo = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(novo.getPage(0).node.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(novo.getPage(0).node.Resources()?.toString()).toContain('/Im1');
  });

  it('A-D14: 15 páginas passam; 16 viram laudo_longo (nada é montado para envio)', async () => {
    expect((await prepararLaudo(await pdfDeTeste({ paginas: 15 }))).tipo).toBe('pdf');
    expect(await motivo(prepararLaudo(await pdfDeTeste({ paginas: 16 })))).toBe('laudo_longo');
  });

  it('PDF com senha (dicionário /Encrypt) → pdf_com_senha', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 2, R: 3 });
    expect(await motivo(prepararLaudo(Buffer.from(await doc.save())))).toBe('pdf_com_senha');
  });

  it('PDF com senha cujos objetos estão cifrados dentro do fluxo de objetos (não abre no pdf-lib) → pdf_com_senha', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard', V: 4, R: 4 });
    const bytes = Buffer.from(await doc.save({ useObjectStreams: true }));
    // "cifra" o corpo do /ObjStm (bytes que não descomprimem), como num PDF protegido de verdade; o trailer fica em claro
    const inicio = bytes.indexOf('stream\n', bytes.indexOf('/Type /ObjStm')) + 'stream\n'.length;
    const fim = bytes.indexOf('\nendstream', inicio);
    for (let i = inicio; i < fim; i++) bytes[i] = (i * 37 + 11) & 0xff;
    await expect(PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: true })).rejects.toThrow();
    expect(await motivo(prepararLaudo(bytes))).toBe('pdf_com_senha');
  });

  it('PDF corrompido, arquivo de outro tipo e vazio → arquivo_invalido', async () => {
    expect(await motivo(prepararLaudo(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500, 0x41)])))).toBe('arquivo_invalido');
    expect(await motivo(prepararLaudo(Buffer.from('GIF89a…')))).toBe('arquivo_invalido');
    expect(await motivo(prepararLaudo(Buffer.alloc(0)))).toBe('arquivo_invalido');
  });

  it('foto: girada pela orientação EXIF, JPEG sem metadados, maior lado ≤ 2576 px', async () => {
    const a = await prepararLaudo(await fotoDeTeste({ largura: 4000, altura: 3000, orientacao: 6, copyright: 'Ana Souza' }));
    expect(a.tipo).toBe('imagem');
    const bytes = Buffer.from(a.base64, 'base64');
    const m = await sharp(bytes).metadata();
    expect(m.format).toBe('jpeg');
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
    expect(m.width).toBeLessThan(m.height!); // estava deitada (orientação 6): agora em pé
    expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(LADO_MAX_IMAGEM);
    expect(bytes.includes(Buffer.from('Ana Souza'))).toBe(false);
  });

  it('PNG que declara 30.000 × 30.000 px (bomba de pixels) → arquivo_invalido, sem derrubar o processo', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    const bomba = Buffer.from(png);
    bomba.writeUInt32BE(30_000, 16); // IHDR: largura
    bomba.writeUInt32BE(30_000, 20); // IHDR: altura
    expect(await motivo(prepararLaudo(bomba))).toBe('arquivo_invalido');
  });

  it('RNF-101 / D17: PDF de 20 MB — o pico de memória do preparo (com o base64) fica abaixo de 160 MB', async () => {
    // um stream de ~19 MB pendurado na página (como a imagem de um laudo escaneado): o preparo copia a página com ele
    const doc = await PDFDocument.create();
    const pagina = doc.addPage();
    pagina.node.set(PDFName.of('Enchimento'), doc.context.register(doc.context.stream(Buffer.alloc(19 * 1024 * 1024, 0x41))));
    const grande = Buffer.from(await doc.save());
    expect(grande.length).toBeGreaterThan(19 * 1024 * 1024);
    // Medido num processo à parte: o preparo não cede o laço de eventos (pdf-lib e base64 são síncronos com poucos
    // objetos), então um setInterval aqui nunca dispararia durante ele e mediria 0. O maxRSS do processo é o pico real
    // (heap + Buffers + memória nativa); descontado o RSS de antes do preparo, só pode superestimar (picos anteriores contam).
    const dir = await mkdtemp(path.join(tmpdir(), 'preparo-'));
    try {
      const arquivo = path.join(dir, 'laudo.pdf');
      await writeFile(arquivo, grande);
      const { stdout } = await execFileP(
        process.execPath,
        ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', MEDIR_PREPARO, arquivo],
        { cwd: process.cwd(), timeout: 60_000 },
      );
      const { pico, base64 } = JSON.parse(stdout) as { pico: number; base64: number };
      console.info(`RNF-101: pico do preparo com PDF de 20 MB ≈ ${Math.round(pico / 1024 / 1024)} MB (RSS)`);
      expect(base64, 'o preparo rodou de verdade').toBeGreaterThan(25 * 1024 * 1024);
      expect(pico, 'a medida não é vazia: o base64 de ~25 MB fica na memória').toBeGreaterThan(20 * 1024 * 1024);
      expect(pico).toBeLessThan(160 * 1024 * 1024);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
