import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import sharp from 'sharp';
import { fotoDeTeste, pdfDeTeste } from '../../../test/ia';
import { LADO_MAX_IMAGEM, MAX_BYTES_IMAGEM_ENTRELACADA, MAX_PIXELS_IMAGEM, prepararLaudo, PreparoError } from './preparar-arquivo';

const execFileP = promisify(execFile);

/**
 * Roda o preparo num Node novo (com tsx) e devolve o pico de RSS acima do de antes do preparo. O pico é o VmHWM do
 * processo, zerado logo antes (clear_refs 5), e não o maxRSS: no Linux o maxRSS de um processo filho herda o do pai no
 * fork/exec (o processo do vitest, que já passou de 250 MB com os PDFs-bomba montados aqui).
 */
const MEDIR_PREPARO = `
import { readFileSync, writeFileSync } from 'node:fs';
const { prepararLaudo } = await import('./src/modules/ia/preparar-arquivo.ts');
const arquivo = readFileSync(process.argv[1]);
const pico = () => Number(/VmHWM:\\s+(\\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) * 1024;
globalThis.gc();
writeFileSync('/proc/self/clear_refs', '5');
const antes = process.memoryUsage().rss;
const r = await prepararLaudo(arquivo).catch((e) => ({ motivo: e.motivo ?? 'erro inesperado' }));
console.log(JSON.stringify({ pico: pico() - antes, ...r, base64: r.base64?.length }));
`;
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));
const MB = 1024 * 1024;
/** RNF-101 / A-03 / D17: o que o preparo pode somar ao worker de 512 MB (compartilhado com as outras filas). */
const TETO_DO_PREPARO = 160 * MB;

/**
 * Medido num processo à parte: o preparo não cede o laço de eventos (pdf-lib e base64 são síncronos com poucos objetos),
 * então um setInterval aqui nunca dispararia durante ele e mediria 0. O VmHWM do processo é o pico real (heap, Buffers,
 * memória nativa do libvips e a thread do PDF).
 */
async function medirPreparo(conteudo: Buffer): Promise<{ pico: number; tipo?: string; motivo?: string; base64?: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'preparo-'));
  try {
    const arquivo = path.join(dir, 'laudo');
    await writeFile(arquivo, conteudo);
    const { stdout } = await execFileP(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', MEDIR_PREPARO, arquivo], {
      cwd: RAIZ,
      timeout: 90_000,
    });
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Imagem lisa (o tamanho do arquivo é pequeno; a memória do decodificador depende só das dimensões). */
const imagem = (largura: number, altura: number, canais: 3 | 4 = 3) =>
  sharp({ create: { width: largura, height: altura, channels: canais, background: { r: 240, g: 240, b: 240, alpha: 0.5 } } });

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
    pagina.node.set(PDFName.of('Enchimento'), doc.context.register(doc.context.stream(Buffer.alloc(19 * MB, 0x41))));
    const grande = Buffer.from(await doc.save());
    expect(grande.length).toBeGreaterThan(19 * MB);
    const r = await medirPreparo(grande);
    console.info(`RNF-101: pico do preparo com PDF de 20 MB ≈ ${Math.round(r.pico / MB)} MB (RSS)`);
    expect(r.tipo, 'o preparo rodou de verdade').toBe('pdf');
    expect(r.base64).toBeGreaterThan(25 * MB);
    expect(r.pico, 'a medida não é vazia: o base64 de ~25 MB fica na memória').toBeGreaterThan(20 * MB);
    expect(r.pico).toBeLessThan(TETO_DO_PREPARO);
  }, 120_000);

  it('RNF-101 / A-03: PDF pequeno com objeto enorme comprimido (bomba no /ObjStm) → arquivo_invalido, abaixo de 160 MB', async () => {
    // Sem o teto: ~2,1 GB (fluxo de 60 MB descomprimido + a string analisada no heap) a partir de ~60 KB; o worker morria.
    const comString = await PDFDocument.create();
    comString.addPage();
    comString.context.register(PDFString.of('A'.repeat(60 * MB)));
    // Sem o teto do heap: ~520 MB (5 milhões de números analisados) a partir de ~10 KB.
    const comArray = await PDFDocument.create();
    comArray.addPage();
    const numeros = comArray.context.obj([]);
    for (let i = 0; i < 5_000_000; i++) numeros.push(comArray.context.obj(0));
    comArray.context.register(numeros);
    for (const [nome, doc] of [['string de 60 MB', comString], ['array de 5 milhões de números', comArray]] as const) {
      const bomba = Buffer.from(await doc.save({ useObjectStreams: true }));
      expect(bomba.length, nome).toBeLessThan(100 * 1024);
      const r = await medirPreparo(bomba);
      console.info(`RNF-101: PDF-bomba (${nome}, ${Math.round(bomba.length / 1024)} KB) → ${r.motivo}, pico ≈ ${Math.round(r.pico / MB)} MB`);
      expect(r.motivo, nome).toBe('arquivo_invalido');
      expect(r.pico, nome).toBeLessThan(TETO_DO_PREPARO);
    }
  }, 180_000);

  it('RNF-101: imagem acima de 40 M px, JPEG progressivo e PNG entrelaçado grandes → arquivo_invalido (sem decodificar)', async () => {
    expect(9990 * 9990).toBeGreaterThan(MAX_PIXELS_IMAGEM);
    expect(await motivo(prepararLaudo(await imagem(9990, 9990).jpeg({ progressive: true }).toBuffer()))).toBe('arquivo_invalido');
    expect(await motivo(prepararLaudo(await imagem(9990, 9990).jpeg().toBuffer()))).toBe('arquivo_invalido');
    // abaixo dos 40 M px, mas a leitura inteira passa do teto: progressivo 4000 × 4000 (~92 MB de coeficientes) e
    // entrelaçado 6300 × 6300 (~114 MB; antes, ~170 MB de pico)
    expect(4000 * 4000 * 3 * 2).toBeGreaterThan(MAX_BYTES_IMAGEM_ENTRELACADA);
    expect(await motivo(prepararLaudo(await imagem(4000, 4000).jpeg({ progressive: true }).toBuffer()))).toBe('arquivo_invalido');
    expect(await motivo(prepararLaudo(await imagem(6300, 6300).png({ progressive: true }).toBuffer()))).toBe('arquivo_invalido');
  }, 60_000);

  it('RNF-101: as maiores imagens aceitas (40 M px girada; progressiva e entrelaçada no teto) ficam abaixo de 160 MB', async () => {
    const casos: [string, Buffer][] = [
      ['JPEG 6300 × 6300 girado pelo EXIF', await imagem(6300, 6300).jpeg().withMetadata({ orientation: 6 }).toBuffer()],
      ['JPEG progressivo 4:4:4 2896 × 2896', await imagem(2896, 2896).jpeg({ progressive: true, chromaSubsampling: '4:4:4' }).toBuffer()],
      ['PNG entrelaçado com transparência 3546 × 3546', await imagem(3546, 3546, 4).png({ progressive: true }).toBuffer()],
    ];
    for (const [nome, conteudo] of casos) {
      const r = await medirPreparo(conteudo);
      console.info(`RNF-101: ${nome} → ${r.tipo ?? r.motivo}, pico ≈ ${Math.round(r.pico / MB)} MB`);
      expect(r.tipo, nome).toBe('imagem');
      expect(r.pico, nome).toBeLessThan(TETO_DO_PREPARO);
    }
  }, 180_000);
});
