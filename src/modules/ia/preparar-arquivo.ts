import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { detectarTipo } from '@/lib/file-type';
import { paraJpegSemMetadados } from '@/lib/jpeg';
import { LIMITE_PAGINAS } from './constantes';
import type { SaidaDoPdf } from './preparar-pdf-thread';
import type { ArquivoPreparado } from './provedor';

/**
 * Plano 11 (A-D7 = (a), RN-110): o laudo inteiro, sem metadados, pronto para ir inline em base64. Só o worker importa
 * (pdf-lib e sharp fora do grafo do Next; guarda em guardas.test.ts). Nada aqui é gravado em disco (regra 9: o arquivo
 * só é LIDO, pelo caminho do exame); o resultado vive em memória até a chamada. RNF-101/A-03: o PDF é lido numa thread
 * com o heap e os fluxos descomprimidos limitados (preparar-pdf-thread.ts), e a imagem passa pelo tamanho antes de ser
 * decodificada — um arquivo pequeno não pode levar o worker compartilhado de 512 MB ao OOM.
 */
export const LADO_MAX_IMAGEM = 2576; // maior lado da alta resolução dos modelos 4.7+ (spec §5.4)
export const LIMITE_PEDIDO_BYTES = 32 * 1024 * 1024; // limite da API para o pedido inteiro
const MARGEM_DO_PEDIDO = 512 * 1024; // instruções, schema e o JSON em volta do base64
/**
 * RNF-101/A-03 (worker de 512 MB, compartilhado com as outras filas): teto do heap da thread que lê o PDF. Um PDF de
 * 20 MB bem-comportado usa poucos MB de heap (os fluxos ficam fora dele, em ArrayBuffers); a bomba (objeto enorme
 * comprimido) estoura aqui e vira arquivo_invalido, sem derrubar o processo.
 */
const HEAP_MAX_PDF_MB = 64;
const TEMPO_MAX_PDF_MS = 60_000;
/** Mesmo teto de pixels do resto do repositório (capa, logo, foto do diário, digitalizada). */
export const MAX_PIXELS_IMAGEM = 40_000_000;
/**
 * JPEG progressivo e PNG entrelaçado não são lidos em faixas: a imagem inteira (no JPEG, os coeficientes, 2 bytes por
 * amostra) fica na memória nativa do libvips, fora do alcance do heap. Teto do que essa leitura ocupa (largura ×
 * altura × canais × bytes por amostra): 48 MB = 8 M px num JPEG RGB progressivo, 16 M px num PNG RGB entrelaçado.
 * Medido no teste do RNF-101 (o pior caso, JPEG 4:4:4 e CMYK, fica abaixo dos 160 MB).
 */
export const MAX_BYTES_IMAGEM_ENTRELACADA = 48 * 1024 * 1024;
const BYTES_POR_AMOSTRA: Partial<Record<string, number>> = { uchar: 1, char: 1, ushort: 2, short: 2, uint: 4, int: 4, float: 4, double: 8 };

export class PreparoError extends Error {
  override name = 'PreparoError';
  constructor(readonly motivo: 'arquivo_invalido' | 'laudo_longo' | 'pdf_com_senha') {
    super(`preparo do laudo: ${motivo}`);
  }
}

const cabeNoPedido = (bytes: number) => Math.ceil(bytes / 3) * 4 + MARGEM_DO_PEDIDO <= LIMITE_PEDIDO_BYTES;

export async function prepararLaudo(conteudo: Buffer): Promise<ArquivoPreparado> {
  const tipo = conteudo.length ? detectarTipo(conteudo) : null;
  if (tipo?.ext === 'pdf') return prepararPdf(conteudo);
  if (tipo?.ext === 'jpg' || tipo?.ext === 'png') return prepararImagem(conteudo);
  throw new PreparoError('arquivo_invalido');
}

async function prepararPdf(conteudo: Buffer): Promise<ArquivoPreparado> {
  const saida = await lerPdfNaThread(conteudo);
  if ('motivo' in saida) throw new PreparoError(saida.motivo);
  if (!cabeNoPedido(saida.bytes.length)) throw new PreparoError('arquivo_invalido');
  return { tipo: 'pdf', base64: Buffer.from(saida.bytes.buffer, saida.bytes.byteOffset, saida.bytes.byteLength).toString('base64'), paginas: saida.paginas };
}

/**
 * Lê e regrava o PDF em preparar-pdf-thread.ts, com o heap limitado e um prazo. Estouro do heap
 * (ERR_WORKER_OUT_OF_MEMORY), erro, saída sem resposta ou prazo vencido → arquivo_invalido. `execArgv: []`: a thread
 * não herda o `--import tsx` do worker; o Node 24 carrega o .ts apagando os tipos.
 */
function lerPdfNaThread(conteudo: Buffer): Promise<SaidaDoPdf> {
  return new Promise((resolve, reject) => {
    const invalido = () => reject(new PreparoError('arquivo_invalido'));
    let thread: Worker;
    try {
      thread = new Worker(new URL('./preparar-pdf-thread.ts', import.meta.url), {
        workerData: { pdf: conteudo, limitePaginas: LIMITE_PAGINAS }, // copiado para a thread (o Buffer pode ser do pool)
        execArgv: [],
        env: {}, // a thread não precisa do ambiente (credenciais) do worker
        resourceLimits: { maxOldGenerationSizeMb: HEAP_MAX_PDF_MB, maxYoungGenerationSizeMb: 16 },
        stdout: true,
        stderr: true, // nada da thread vai para o log: pode citar o conteúdo do laudo
      });
    } catch {
      return invalido();
    }
    thread.stdout.resume(); // descartados, sem acumular
    thread.stderr.resume();
    const prazo = setTimeout(() => void thread.terminate(), TEMPO_MAX_PDF_MS);
    thread.once('message', (saida: SaidaDoPdf) => {
      clearTimeout(prazo);
      resolve(saida);
      void thread.terminate();
    });
    thread.once('error', () => {
      clearTimeout(prazo);
      invalido();
    });
    thread.once('exit', () => {
      clearTimeout(prazo);
      invalido(); // sem efeito se a resposta (ou o erro) já veio
    });
  });
}

async function prepararImagem(conteudo: Buffer): Promise<ArquivoPreparado> {
  let jpeg: Buffer;
  try {
    const m = await sharp(conteudo, { failOn: 'error', limitInputPixels: MAX_PIXELS_IMAGEM }).metadata();
    if (!m.width || !m.height || m.width * m.height > MAX_PIXELS_IMAGEM) throw new PreparoError('arquivo_invalido');
    const bytesPorAmostra = m.format === 'jpeg' ? 2 : (BYTES_POR_AMOSTRA[m.depth ?? ''] ?? 8);
    const bytesDaLeituraInteira = m.width * m.height * (m.channels ?? 4) * bytesPorAmostra;
    if (m.isProgressive && bytesDaLeituraInteira > MAX_BYTES_IMAGEM_ENTRELACADA) throw new PreparoError('arquivo_invalido');
    // rotate() sem argumento = gira pela orientação EXIF; o JPEG novo sai sem nenhum metadado (src/lib/jpeg.ts)
    jpeg = await paraJpegSemMetadados(sharp(conteudo, { failOn: 'error', limitInputPixels: MAX_PIXELS_IMAGEM }).rotate(), LADO_MAX_IMAGEM);
  } catch {
    throw new PreparoError('arquivo_invalido');
  }
  if (!cabeNoPedido(jpeg.length)) throw new PreparoError('arquivo_invalido');
  return { tipo: 'imagem', base64: jpeg.toString('base64') };
}
