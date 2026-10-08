import { execFile } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDeflate } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { ORCAMENTO_RNF162_BYTES, pdfComConteudoAtivo, pdfComImagemDeclarada, pdfDeFotos } from '../../../test/exames-enviados';
import { pdfDeTeste } from '../../../test/ia';
import { RasterizacaoError, rasterizarPdf, TETO_RSS_RASTER_BYTES, type PaginaRaster } from './rasterizar-pdf';

const execFileP = promisify(execFile);
const MB = 1024 * 1024;
const OPCOES = { limitePaginas: 10, ladoMax: 2000, maxPixelsImagem: 20_000_000 };

async function rasterizar(pdf: Buffer, o: { tempoMaxMs?: number; tetoRssBytes?: number } = {}) {
  const paginas: PaginaRaster[] = [];
  const r = await rasterizarPdf(pdf, { ...OPCOES, ...o }, async (p) => void paginas.push(p));
  return { ...r, paginas };
}
const motivo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof RasterizacaoError ? e.motivo : `outro: ${e instanceof Error ? e.message : String(e)}`;
  }
  return 'sem erro';
};
/** R-D2: o `os.tmpdir()` do lado do worker aponta para um diretório só deste teste (para ver o que fica nele). */
async function comTmpProprio(fn: (base: string) => Promise<void>): Promise<void> {
  const base = await mkdtemp(path.join(tmpdir(), 'raster-base-'));
  vi.stubEnv('TMPDIR', base);
  try {
    await fn(base);
  } finally {
    vi.unstubAllEnvs();
    await rm(base, { recursive: true, force: true });
  }
}
/** Algum pixel escuro (o texto desenhado), não só a página em branco. */
const temTinta = (p: PaginaRaster) => p.rgba.some((v, i) => i % 4 !== 3 && v < 100);

/** "Bomba": o conteúdo da página descomprime para `mb` MB (espaços), gerado aos pedaços — o teste não aloca tudo. */
async function pdfBomba(mb: number): Promise<Buffer> {
  const comprimido = await new Promise<Buffer>((ok, falha) => {
    const partes: Buffer[] = [];
    const z = createDeflate({ level: 9 });
    z.on('data', (c: Buffer) => partes.push(c));
    z.on('end', () => ok(Buffer.concat(partes)));
    z.on('error', falha);
    const bloco = Buffer.alloc(MB, 0x20);
    let i = 0;
    const escrever = () => {
      while (i < mb) {
        i++;
        if (!z.write(bloco)) return void z.once('drain', escrever);
      }
      z.end();
    };
    escrever();
  });
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  pagina.node.set(PDFName.of('Contents'), doc.context.register(PDFRawStream.of(doc.context.obj({ Filter: 'FlateDecode', Length: comprimido.length }), comprimido)));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/**
 * Mede num Node novo (com tsx) o pico de memória do lado do worker (VmHWM, zerado logo antes) e devolve também o pico do
 * processo filho (que ele mesmo informa no "fim"), como o teste do RNF-101 do Plano 11.
 */
const MEDIR = `
import { readFileSync, writeFileSync } from 'node:fs';
const { rasterizarPdf } = await import('./src/modules/pacientes/rasterizar-pdf.ts');
const pdf = readFileSync(process.argv[1]);
const pico = () => Number(/VmHWM:\\s+(\\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) * 1024;
globalThis.gc();
writeFileSync('/proc/self/clear_refs', '5');
const antes = process.memoryUsage().rss;
const r = await rasterizarPdf(pdf, { limitePaginas: 10, ladoMax: 2000, maxPixelsImagem: 20_000_000 }, async () => {}).catch((e) => ({ motivo: e.motivo ?? 'erro inesperado' }));
console.log(JSON.stringify({ pai: pico() - antes, ...r }));
`;
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));
async function medir(pdf: Buffer): Promise<{ pai: number; paginas?: number; picoBytes?: number | null; motivo?: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'raster-'));
  try {
    const arquivo = path.join(dir, 'laudo.pdf');
    await writeFile(arquivo, pdf);
    const { stdout } = await execFileP(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', MEDIR, arquivo], { cwd: RAIZ, timeout: 180_000 });
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('rasterização do PDF enviado pelo paciente (D23 = a, R-170, RNF-162)', () => {
  it('3 páginas A4: uma por vez, na ordem, maior lado 2000 px, RGBA com o texto desenhado', async () => {
    const r = await rasterizar(await pdfDeTeste({ paginas: 3 }));
    expect(r.paginas.map((p) => p.indice)).toEqual([0, 1, 2]);
    for (const p of r.paginas) {
      expect([p.largura, p.altura]).toEqual([1413, 2000]); // 595 × 842 pt
      expect(p.rgba.length).toBe(p.largura * p.altura * 4);
      expect(temTinta(p)).toBe(true);
    }
    expect(r.paginas).toHaveLength(3);
    expect(r.picoBytes ?? 0).toBeLessThan(TETO_RSS_RASTER_BYTES);
  }, 60_000);

  it('página deitada (842 × 595): a largura é que vira 2000 px', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]);
    const r = await rasterizar(Buffer.from(await doc.save()));
    expect([r.paginas[0].largura, r.paginas[0].altura]).toEqual([2000, 1413]);
  }, 60_000);

  it('US-160 "PDF longo": 11 páginas → "paginas" antes de desenhar qualquer uma', async () => {
    let chamadas = 0;
    await expect(rasterizarPdf(await pdfDeTeste({ paginas: 11 }), OPCOES, async () => void chamadas++)).rejects.toMatchObject({ motivo: 'paginas' });
    expect(chamadas).toBe(0);
  }, 60_000);

  it('não é PDF, PDF truncado e PDF sem páginas → "conversao"', async () => {
    const bom = await pdfDeTeste({ paginas: 2 });
    const semPaginas = Buffer.from(await (await PDFDocument.create()).save({ addDefaultPage: false })); // o pdf-lib põe uma página em branco por padrão
    for (const pdf of [Buffer.from('%PDF-1.7\nlixo'), bom.subarray(0, Math.floor(bom.length / 3)), semPaginas]) {
      expect(await motivo(rasterizar(pdf))).toBe('conversao');
    }
  }, 60_000);

  it('R-170: PDF com JavaScript, link e anexo é desenhado normalmente e só pixels saem do processo filho', async () => {
    const r = await rasterizar(await pdfComConteudoAtivo());
    expect(r.paginas).toHaveLength(1);
    expect(Object.keys(r.paginas[0]).sort()).toEqual(['altura', 'indice', 'largura', 'rgba']);
    expect(temTinta(r.paginas[0])).toBe(true);
  }, 60_000);

  it('imagem que declara 6000 × 6000 px (36 MP) → "conversao" sem decodificar', async () => {
    expect(await motivo(rasterizar(await pdfComImagemDeclarada(6000, 6000)))).toBe('conversao');
  }, 60_000);

  it('bomba de descompressão (256 MB): o filho morre no teto de memória (ou o PDFium recusa); o worker segue', async () => {
    const r = await rasterizar(await pdfBomba(256)).then(
      (x) => ({ ok: true as const, pico: x.picoBytes }),
      (e: unknown) => ({ ok: false as const, motivo: e instanceof RasterizacaoError ? e.motivo : 'outro' }),
    );
    if (r.ok) expect(r.pico ?? 0).toBeLessThanOrEqual(TETO_RSS_RASTER_BYTES);
    else expect(r.motivo).toBe('conversao');
  }, 120_000);

  it('teto de memória menor que o próprio Node: o filho é morto e vira "conversao"; prazo vencido também', async () => {
    const pdf = await pdfDeTeste({ paginas: 1 });
    expect(await motivo(rasterizar(pdf, { tetoRssBytes: 8 * MB }))).toBe('conversao');
    expect(await motivo(rasterizar(pdf, { tempoMaxMs: 1 }))).toBe('conversao');
  }, 60_000);

  it('o erro de quem recebe a página volta como está e o filho é encerrado', async () => {
    const erro = new Error('falhou ao converter');
    await expect(rasterizarPdf(await pdfDeTeste({ paginas: 2 }), OPCOES, async () => { throw erro; })).rejects.toBe(erro);
  }, 60_000);

  it('R-D2: os pixels passam por arquivo num diretório 0700 do job; cada arquivo sai antes de aoReceber e o diretório no fim', async () => {
    await comTmpProprio(async (base) => {
      const vistos: { modo: number; arquivos: string[] }[] = [];
      const r = await rasterizarPdf(await pdfDeTeste({ paginas: 3 }), OPCOES, async () => {
        const dirs = await readdir(base);
        expect(dirs).toHaveLength(1);
        expect(dirs[0]).toMatch(/^nutri-raster-/);
        const dir = path.join(base, dirs[0]);
        vistos.push({ modo: (await stat(dir)).mode & 0o777, arquivos: await readdir(dir) });
      });
      expect(r.paginas).toBe(3);
      expect(vistos).toEqual([0, 1, 2].map(() => ({ modo: 0o700, arquivos: [] })));
      expect(await readdir(base)).toEqual([]);
    });
  }, 60_000);

  it('R-D2: o diretório temporário também sai em erro de aoReceber, prazo vencido, filho morto no teto e PDF recusado', async () => {
    await comTmpProprio(async (base) => {
      const pdf = await pdfDeTeste({ paginas: 2 });
      await expect(rasterizarPdf(pdf, OPCOES, async () => { throw new Error('x'); })).rejects.toThrow('x');
      expect(await readdir(base)).toEqual([]);
      for (const o of [{ tempoMaxMs: 1 }, { tetoRssBytes: 8 * MB }]) {
        expect(await motivo(rasterizar(pdf, o))).toBe('conversao');
        expect(await readdir(base)).toEqual([]);
      }
      expect(await motivo(rasterizar(Buffer.from('%PDF-1.7\nlixo')))).toBe('conversao');
      expect(await readdir(base)).toEqual([]);
    });
  }, 60_000);

  it('R-D4: o PDF chega ao filho por arquivo — lido uma vez pela função de quem chama, apagado pelo filho antes da 1ª página; erro dela volta como está', async () => {
    await comTmpProprio(async (base) => {
      const pdf = await pdfDeTeste({ paginas: 2 });
      let leituras = 0;
      let vigia: FSWatcher | undefined;
      const criados: string[] = [];
      const r = await rasterizarPdf(
        async () => {
          leituras++;
          const dirs = await readdir(base);
          expect(dirs).toHaveLength(1);
          expect(await readdir(path.join(base, dirs[0]))).toEqual([]); // o diretório do job já existe, vazio
          vigia = watch(path.join(base, dirs[0]), (_evento, nome) => void (nome && criados.push(String(nome))));
          return pdf;
        },
        OPCOES,
        async () => {
          const [dir] = await readdir(base);
          expect(await readdir(path.join(base, dir))).toEqual([]); // nem o PDF nem a página ficam no diretório
        },
      ).finally(() => vigia?.close());
      expect(r.paginas).toBe(2);
      expect(leituras).toBe(1);
      expect(criados).toContain('entrada.pdf');
      expect(await readdir(base)).toEqual([]);

      const erro = new Error('EIO');
      await expect(rasterizarPdf(async () => { throw erro; }, OPCOES, async () => {})).rejects.toBe(erro);
      expect(await readdir(base)).toEqual([]);
    });
  }, 60_000);

  it('RNF-162: laudo digitalizado de 10 páginas — pico do worker + pico do filho dentro do orçamento (D-R1 revista pela R-D4)', async () => {
    const pdf = await pdfDeFotos(10);
    const r = await medir(pdf);
    console.info(`RNF-162: PDF de ${Math.round(pdf.length / MB)} MB → worker +${Math.round(r.pai / MB)} MB, filho ${Math.round((r.picoBytes ?? 0) / MB)} MB`);
    expect(r.paginas).toBe(10);
    expect(r.pai + (r.picoBytes ?? 0)).toBeLessThan(ORCAMENTO_RNF162_BYTES); // o job inteiro é medido na T6
  }, 240_000);
});
