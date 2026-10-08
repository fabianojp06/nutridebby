import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFiumModule } from '@hyzyla/pdfium';

/**
 * Plano 12 (D23 = a, DEP-10, R-170; D1 do plano): processo filho que desenha cada página do PDF enviado pelo PACIENTE
 * (conteúdo não confiável) com o PDFium em WebAssembly. A compilação do @hyzyla/pdfium não tem o V8: nenhum JavaScript do PDF
 * roda; o processo nasce sem variáveis de ambiente (rasterizar-pdf.ts; a única exceção é o limiar do mmap do glibc, R-D2). Só os
 * pixels de cada página saem, uma por vez, num arquivo do diretório temporário do job (criado pelo pai, 0700; nome gerado aqui,
 * nunca com texto do PDF) — pela IPC vão só os metadados (R-D2: a serialização de ~11 MB por página estourava o RNF-162). O PDF
 * também chega por arquivo nesse diretório (R-D4: `entrada.pdf`, gravado pelo pai), lido direto para a memória do WASM — sem
 * cópia no JavaScript — e apagado logo depois. O
 * filho espera o "proxima" do pai antes de desenhar a seguinte (RNF-162). Antes de desenhar uma página, confere o tamanho DECLARADO
 * de cada imagem dela (também dentro de Form XObjects e as inline) sem decodificar: acima de `maxPixelsImagem`, recusa — a
 * decodificação, na memória do WASM, ficaria fora do heap. O pai mede a memória residente deste processo e o mata acima do
 * teto. Carregado direto pelo Node (sem tsx: tipos apagados, sem import local e sem alias). Nunca sai sozinho: o pai encerra
 * depois do "fim" ou da "recusa". Só o worker chega aqui (guarda em exames-enviados-guardas.test.ts).
 */
type Entrada = { tipo: 'entrada'; tamanhoPdf: number; dir: string; limitePaginas: number; ladoMax: number; maxPixelsImagem: number };
export type MensagemDoProcesso =
  | { tipo: 'recusa'; motivo: 'paginas' | 'conversao'; erro?: string }
  | { tipo: 'pagina'; indice: number; total: number; largura: number; altura: number; caminho: string }
  | { tipo: 'fim'; picoBytes: number | null };

/** As funções da API C do PDFium usadas aqui (exportadas pelo módulo do @hyzyla/pdfium 2.1.13, versão fixada). */
type Pdfium = {
  _FPDF_InitLibraryWithConfig(config: object): void;
  _FPDF_LoadMemDocument(ptr: number, tamanho: number, senha: number): number;
  _FPDF_GetPageCount(doc: number): number;
  _FPDF_LoadPage(doc: number, indice: number): number;
  _FPDF_GetPageWidth(pagina: number): number;
  _FPDF_GetPageHeight(pagina: number): number;
  _FPDFPage_CountObjects(pagina: number): number;
  _FPDFPage_GetObject(pagina: number, i: number): number;
  _FPDFPageObj_GetType(obj: number): number;
  _FPDFFormObj_CountObjects(obj: number): number;
  _FPDFFormObj_GetObject(obj: number, i: number): number;
  _FPDFImageObj_GetImagePixelSize(obj: number, largura: number, altura: number): number;
  _FPDFBitmap_CreateEx(largura: number, altura: number, formato: number, ptr: number, passo: number): number;
  _FPDFBitmap_FillRect(bitmap: number, x: number, y: number, largura: number, altura: number, cor: number): void;
  _FPDF_RenderPageBitmap(bitmap: number, pagina: number, x: number, y: number, largura: number, altura: number, rotacao: number, flags: number): void;
  _FPDFBitmap_Destroy(bitmap: number): void;
  _FPDF_ClosePage(pagina: number): void;
  _FPDF_CloseDocument(doc: number): void;
  wasmExports: { malloc(n: number): number; free(ptr: number): void };
  HEAPU8: Uint8Array;
};

const TIPO_IMAGEM = 3; // FPDF_PAGEOBJ_IMAGE
const TIPO_FORM = 5; // FPDF_PAGEOBJ_FORM
const FORMATO_BGRA = 4; // FPDFBitmap_BGRA
// FPDF_ANNOT (aparência das anotações, como um visualizador) | FPDF_REVERSE_BYTE_ORDER (sai RGBA) | FPDF_RENDER_LIMITEDIMAGECACHE
const FLAGS = 0x01 | 0x10 | 0x200;
const MAX_OBJETOS = 50_000; // por página, contando os de dentro dos formulários
const MAX_PROFUNDIDADE = 8;

class RecusaError extends Error {
  motivo: 'paginas' | 'conversao';
  constructor(motivo: 'paginas' | 'conversao') {
    super(motivo);
    this.motivo = motivo;
  }
}
/** Só o nome da exceção (regra 3: a mensagem pode citar o conteúdo do PDF), para o log de quem chamou. */
const nomeDoErro = (e: unknown) => (e instanceof Error ? e.name : 'erro').slice(0, 60);

const fila: unknown[] = [];
let acordar: (() => void) | null = null;
process.on('message', (m: unknown) => {
  fila.push(m);
  const a = acordar;
  acordar = null;
  a?.();
});
async function receber(): Promise<unknown> {
  while (!fila.length) await new Promise<void>((r) => (acordar = r));
  return fila.shift();
}
const enviar = (m: MensagemDoProcesso) => new Promise<void>((ok, falha) => void process.send!(m, undefined, {}, (e) => (e ? falha(e) : ok())));

function picoDesteProcesso(): number | null {
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/** R-D4: o mesmo nome que rasterizar-pdf.ts grava (fixo no código; aqui não há import local). */
const NOME_PDF_DE_ENTRADA = 'entrada.pdf';
const BLOCO_LEITURA = 1024 * 1024;

/**
 * R-D4: lê o PDF gravado pelo pai direto para `destino` (a memória do WASM) e o apaga. Sem seguir link simbólico, só arquivo
 * comum, sem outro nome (hard link) e do tamanho que o pai informou — senão, recusa.
 */
function lerPdfDeEntrada(dir: string, destino: Uint8Array): void {
  const caminho = path.join(dir, NOME_PDF_DE_ENTRADA);
  const fd = openSync(caminho, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size !== destino.length) throw new RecusaError('conversao');
    let lidos = 0;
    while (lidos < destino.length) {
      const n = readSync(fd, destino, lidos, Math.min(BLOCO_LEITURA, destino.length - lidos), lidos);
      if (n <= 0) throw new RecusaError('conversao');
      lidos += n;
    }
  } finally {
    closeSync(fd);
  }
  unlinkSync(caminho);
}

const lerU32 = (mod: Pdfium, ptr: number) => new DataView(mod.HEAPU8.buffer).getUint32(ptr, true);

/** Tamanho declarado de cada imagem (sem decodificar), descendo nos formulários; objetos demais ou fundo demais = recusa. */
function conferirImagens(mod: Pdfium, contar: () => number, pegar: (i: number) => number, ptr: number, max: number, cont: { n: number }, nivel: number): void {
  if (nivel > MAX_PROFUNDIDADE) throw new RecusaError('conversao');
  const n = contar();
  for (let i = 0; i < n; i++) {
    if (++cont.n > MAX_OBJETOS) throw new RecusaError('conversao');
    const obj = pegar(i);
    if (!obj) continue;
    const tipo = mod._FPDFPageObj_GetType(obj);
    if (tipo === TIPO_IMAGEM) {
      if (!mod._FPDFImageObj_GetImagePixelSize(obj, ptr, ptr + 4)) throw new RecusaError('conversao');
      if (lerU32(mod, ptr) * lerU32(mod, ptr + 4) > max) throw new RecusaError('conversao');
    } else if (tipo === TIPO_FORM) {
      conferirImagens(mod, () => mod._FPDFFormObj_CountObjects(obj), (j) => mod._FPDFFormObj_GetObject(obj, j), ptr, max, cont, nivel + 1);
    }
  }
}

/**
 * A página inteira, maior lado = `ladoMax`, fundo branco, RGBA — entregue a `usar` direto do heap do WASM, sem cópia (revisão do
 * plano, D-R1): `usar` grava o arquivo da página dali mesmo e só depois o bitmap é liberado.
 */
async function desenhar(mod: Pdfium, pagina: number, ladoMax: number, usar: (d: { largura: number; altura: number; rgba: Uint8Array }) => Promise<void>): Promise<void> {
  const w = mod._FPDF_GetPageWidth(pagina);
  const h = mod._FPDF_GetPageHeight(pagina);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new RecusaError('conversao');
  const escala = ladoMax / Math.max(w, h);
  const largura = Math.max(1, Math.round(w * escala));
  const altura = Math.max(1, Math.round(h * escala));
  const bytes = largura * altura * 4;
  const ptr = mod.wasmExports.malloc(bytes);
  if (!ptr) throw new RecusaError('conversao');
  let bitmap = 0;
  try {
    bitmap = mod._FPDFBitmap_CreateEx(largura, altura, FORMATO_BGRA, ptr, largura * 4);
    if (!bitmap) throw new RecusaError('conversao');
    mod._FPDFBitmap_FillRect(bitmap, 0, 0, largura, altura, 0xffffffff);
    mod._FPDF_RenderPageBitmap(bitmap, pagina, 0, 0, largura, altura, 0, FLAGS);
    // nada aloca no WASM entre aqui e a gravação (síncrona, no início de `usar`): o HEAPU8 não muda de buffer
    await usar({ largura, altura, rgba: mod.HEAPU8.subarray(ptr, ptr + bytes) });
  } finally {
    if (bitmap) mod._FPDFBitmap_Destroy(bitmap);
    mod.wasmExports.free(ptr);
  }
}

async function rasterizar(e: Entrada): Promise<void> {
  const mod = await (PDFiumModule as unknown as () => Promise<Pdfium>)();
  // o mesmo que o PDFiumLibrary.init() do pacote faz (sem isolate do V8: a compilação não tem JavaScript)
  mod._FPDF_InitLibraryWithConfig({ version: 2, m_pIsolate: null, m_pUserFontPaths: null, m_v8EmbedderSlot: 0, m_pPlatform: null });
  const tamanhoPdf = e.tamanhoPdf;
  if (!Number.isSafeInteger(tamanhoPdf) || tamanhoPdf < 1) throw new RecusaError('conversao');
  const ptrPdf = mod.wasmExports.malloc(tamanhoPdf);
  const ptrTamanho = mod.wasmExports.malloc(8);
  if (!ptrPdf || !ptrTamanho) throw new RecusaError('conversao');
  // depois dos malloc: o HEAPU8 pode ter trocado de buffer se a memória do WASM cresceu
  lerPdfDeEntrada(e.dir, mod.HEAPU8.subarray(ptrPdf, ptrPdf + tamanhoPdf));
  // ilegível, truncado ou com senha: o paciente vê o mesmo texto (§6.2)
  const doc = mod._FPDF_LoadMemDocument(ptrPdf, tamanhoPdf, 0);
  if (!doc) throw new RecusaError('conversao');
  try {
    const total = mod._FPDF_GetPageCount(doc);
    if (total < 1) throw new RecusaError('conversao');
    if (total > e.limitePaginas) throw new RecusaError('paginas');
    for (let i = 0; i < total; i++) {
      if ((await receber()) !== 'proxima') throw new RecusaError('conversao');
      const pagina = mod._FPDF_LoadPage(doc, i);
      if (!pagina) throw new RecusaError('conversao');
      try {
        conferirImagens(mod, () => mod._FPDFPage_CountObjects(pagina), (j) => mod._FPDFPage_GetObject(pagina, j), ptrTamanho, e.maxPixelsImagem, { n: 0 }, 0);
        await desenhar(mod, pagina, e.ladoMax, (d) => {
          // R-D2: os pixels vão num arquivo (só o dono lê, nunca sobrescreve), o pai lê, apaga e converte; pela IPC, só metadados
          const caminho = path.join(e.dir, `pagina-${i}.rgba`);
          writeFileSync(caminho, d.rgba, { mode: 0o600, flag: 'wx' });
          return enviar({ tipo: 'pagina', indice: i, total, largura: d.largura, altura: d.altura, caminho });
        });
        (globalThis as { gc?: () => void }).gc?.();
      } finally {
        mod._FPDF_ClosePage(pagina);
      }
    }
  } finally {
    mod._FPDF_CloseDocument(doc);
    mod.wasmExports.free(ptrPdf);
    mod.wasmExports.free(ptrTamanho);
  }
  await enviar({ tipo: 'fim', picoBytes: picoDesteProcesso() });
}

async function principal(): Promise<void> {
  // revisão do plano (D-R1): o filho conta na mesma cgroup do worker (1 GiB, R-D4) e o vigia de 20 ms não segura um pico — num
  // estouro, o kernel mata ESTE processo, não o worker (subir o próprio oom_score_adj não pede privilégio)
  try {
    writeFileSync('/proc/self/oom_score_adj', '1000');
  } catch {
    // fora do Linux (dev local): sem ajuste
  }
  const e = (await receber()) as Entrada;
  try {
    await rasterizar(e);
  } catch (err) {
    await enviar(err instanceof RecusaError ? { tipo: 'recusa', motivo: err.motivo } : { tipo: 'recusa', motivo: 'conversao', erro: nomeDoErro(err) });
  }
}

if (process.send) await principal();
