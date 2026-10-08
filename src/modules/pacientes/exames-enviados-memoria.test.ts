import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { fotoDeRuido, ORCAMENTO_RNF162_BYTES, pdfDeFotos } from '../../../test/exames-enviados';
import { TETO_RSS_RASTER_BYTES } from './rasterizar-pdf';

const execFileP = promisify(execFile);
const MB = 1024 * 1024;
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));
/** Num Node novo: converterOriginais (o job sem banco) — pico do worker (VmHWM zerado antes) e o maior pico do filho. */
const MEDIR = `
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const { rasterizarPdf } = await import('./src/modules/pacientes/rasterizar-pdf.ts');
const { converterOriginais } = await import('./src/modules/pacientes/exames-enviados-job.tsx');
const dir = process.argv[1];
const pico = () => Number(/VmHWM:\\s+(\\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) * 1024;
let filho = 0;
const rasterizar = async (...a) => { const r = await rasterizarPdf(...a); filho = Math.max(filho, r.picoBytes ?? 0); return r; };
const originais = readdirSync(dir).sort().map((f) => ({ ext: path.extname(f).slice(1), ler: async () => readFileSync(path.join(dir, f)) }));
globalThis.gc();
writeFileSync('/proc/self/clear_refs', '5');
const antes = process.memoryUsage().rss;
const r = await converterOriginais(originais, { rasterizar });
console.log(JSON.stringify({ pai: pico() - antes, filho, paginas: r.jpegs.length, pdf: r.pdf?.length ?? 0 }));
`;
async function medir(arquivos: { nome: string; conteudo: Buffer }[]): Promise<{ pai: number; filho: number; paginas: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'envio-memoria-'));
  try {
    for (const a of arquivos) await writeFile(path.join(dir, a.nome), a.conteudo);
    const { stdout } = await execFileP(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', MEDIR, dir], { cwd: RAIZ, timeout: 300_000 });
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const mb = (n: number) => Math.round(n / MB);

describe('RNF-162 do job inteiro (revisão do plano; orçamento da D-R1 revista pela R-D4)', () => {
  it('PDF de 10 páginas com fotos de 12 MP (perto de 20 MiB): o filho abaixo do teto e o job inteiro no orçamento', async () => {
    const pdf = await pdfDeFotos(10, { largura: 4000, altura: 3000, qualidade: 29 });
    const r = await medir([{ nome: 'laudo.pdf', conteudo: pdf }]);
    console.info(`RNF-162 (job, PDF de ${mb(pdf.length)} MB): worker +${mb(r.pai)} MB, filho ${mb(r.filho)} MB`);
    expect(r.paginas).toBe(10);
    expect(r.filho).toBeLessThan(TETO_RSS_RASTER_BYTES);
    expect(r.pai + r.filho).toBeLessThan(ORCAMENTO_RNF162_BYTES);
  }, 300_000);

  it('5 fotos de 12 MP perto de 10 MiB cada (R-D4; mais do que os 30 MiB do envio): o caminho do HEIC depois do decodificador é o mesmo (Desvio 8)', async () => {
    const foto = await fotoDeRuido(4000, 3000, 94);
    const r = await medir([1, 2, 3, 4, 5].map((i) => ({ nome: `foto-${i}.jpg`, conteudo: foto })));
    console.info(`RNF-162 (job, 5 fotos de ${mb(foto.length)} MB): worker +${mb(r.pai)} MB`);
    expect(r.paginas).toBe(5);
    expect(r.pai).toBeLessThan(ORCAMENTO_RNF162_BYTES);
  }, 300_000);
});
