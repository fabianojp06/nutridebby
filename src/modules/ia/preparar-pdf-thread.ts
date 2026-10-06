import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';

/**
 * Plano 11 (RNF-101/A-03): a leitura e a regravação do PDF do laudo, numa thread com o heap limitado
 * (`prepararPdf` em preparar-arquivo.ts). Um PDF pequeno pode trazer um objeto enorme comprimido (no /ObjStm ou num
 * array de milhões de números) que o `PDFDocument.load` descomprime e analisa inteiro — gigabytes de heap a partir de
 * dezenas de KB. Aqui o estouro mata só a thread (ERR_WORKER_OUT_OF_MEMORY), não o worker das outras filas.
 * Carregado direto pelo Node (sem tsx: tipos apagados, sem import local e sem alias), por isso só sintaxe apagável.
 */
type Entrada = { pdf: Uint8Array; limitePaginas: number };
export type SaidaDoPdf = { motivo: 'arquivo_invalido' | 'laudo_longo' | 'pdf_com_senha' } | { bytes: Uint8Array; paginas: number };

/**
 * Teto de cada fluxo que o pdf-lib DESCOMPRIME ao abrir (fluxos de objetos e de xref; o conteúdo das páginas e as
 * imagens são copiados comprimidos). Os buffers dos decodificadores ficam fora do heap (ArrayBuffer), então o limite
 * do heap não os pega: um fluxo Flate (ou Flate sobre Flate) de poucos KB pode pedir gigabytes. 16 MB é muito acima de
 * um fluxo de objetos real (dicionários pequenos, dezenas de KB). Todos os decodificadores do pdf-lib 1.17.1 crescem o
 * buffer por `DecodeStream.prototype.ensureBuffer` (versão fixada no package.json); se ele sumir, a thread falha ao
 * subir e todo PDF vira arquivo_invalido (o teste quebra), em vez de ficar sem o teto.
 */
const MAX_FLUXO_DESCOMPRIMIDO = 16 * 1024 * 1024;
type Decodificador = { prototype: { ensureBuffer(requested: number): Uint8Array } };
const { default: DecodeStream } = createRequire(import.meta.url)('pdf-lib/cjs/core/streams/DecodeStream.js') as { default: Decodificador };
const ensureBuffer = DecodeStream.prototype.ensureBuffer;
if (typeof ensureBuffer !== 'function') throw new Error('pdf-lib sem DecodeStream.ensureBuffer');
DecodeStream.prototype.ensureBuffer = function (requested) {
  if (requested > MAX_FLUXO_DESCOMPRIMIDO) throw new Error('fluxo descomprimido acima do teto');
  return ensureBuffer.call(this, requested);
};

/** Chaves que carregam metadados ou ações (o conteúdo visível fica): XMP e dados de aplicativo em qualquer objeto, ações e miniatura da página. */
const CHAVES_DE_METADADOS = ['Metadata', 'PieceInfo', 'AA', 'Thumb'].map((c) => PDFName.of(c));

async function regravar({ pdf, limitePaginas }: Entrada): Promise<SaidaDoPdf> {
  let original: PDFDocument;
  let paginas: number;
  try {
    // ignoreEncryption + isEncrypted (e não `instanceof EncryptedPDFError`): o pdf-lib 1.17.1 é ES5 e a subclasse de
    // Error perde o protótipo, então o instanceof nunca casa e o PDF com senha viraria arquivo_invalido
    original = await PDFDocument.load(pdf, { updateMetadata: false, throwOnInvalidObject: true, ignoreEncryption: true });
    paginas = original.getPageCount(); // dentro do try: PDF sem catálogo lança TypeError, que vira arquivo_invalido (não relança o job)
  } catch {
    // PDF cifrado com fluxos de objetos (o comum hoje) nem chega a abrir: os objetos dentro deles estão cifrados.
    // A chave /Encrypt fica em claro no trailer; só aqui, com a leitura já recusada, ela decide a mensagem.
    return { motivo: Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength).includes('/Encrypt') ? 'pdf_com_senha' : 'arquivo_invalido' };
  }
  if (original.isEncrypted) return { motivo: 'pdf_com_senha' };
  if (paginas === 0) return { motivo: 'arquivo_invalido' };
  if (paginas > limitePaginas) return { motivo: 'laudo_longo' };
  try {
    // As chaves saem do ORIGINAL, antes da cópia: o copyPages só leva o que está ligado às páginas, mas o que ele já
    // copiou vai no arquivo salvo mesmo se desligado depois (o pdf-lib grava todo objeto do contexto). Vale para o XMP
    // da página e o das imagens e fontes (objetos indiretos); dicionário direto aninhado (raro) não é varrido.
    for (const [, obj] of original.context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
      if (dict) for (const chave of CHAVES_DE_METADADOS) dict.delete(chave);
    }
    // documento NOVO só com as páginas: o dicionário Info e o XMP (/Metadata do catálogo) do original não vêm junto
    const novo = await PDFDocument.create({ updateMetadata: false });
    for (const p of await novo.copyPages(original, original.getPageIndices())) novo.addPage(p);
    return { bytes: await novo.save({ useObjectStreams: true }), paginas };
  } catch {
    return { motivo: 'arquivo_invalido' };
  }
}

if (parentPort) {
  const saida = await regravar(workerData as Entrada);
  // o PDF regravado volta transferido (sem cópia): pode ter dezenas de MB
  parentPort.postMessage(saida, 'bytes' in saida ? [saida.bytes.buffer as ArrayBuffer] : []);
}
