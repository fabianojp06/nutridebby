import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream } from 'pdf-lib';

/**
 * Plano 11 (RNF-101/A-03): a leitura e a regravação do PDF do laudo, numa thread com o heap limitado
 * (`prepararPdf` em preparar-arquivo.ts). Um PDF pequeno pode trazer um objeto enorme comprimido (no /ObjStm ou num
 * array de milhões de números) que o `PDFDocument.load` descomprime e analisa inteiro — gigabytes de heap a partir de
 * dezenas de KB. Aqui o estouro mata só a thread (ERR_WORKER_OUT_OF_MEMORY), não o worker das outras filas.
 * Carregado direto pelo Node (sem tsx: tipos apagados, sem import local e sem alias), por isso só sintaxe apagável.
 */
type Entrada = { pdf: Uint8Array; limitePaginas: number };
/** `erro`: só o nome da exceção (regra 3: a mensagem pode citar o conteúdo do laudo), para o log de quem chamou. */
export type SaidaDoPdf = { motivo: 'arquivo_invalido' | 'laudo_longo' | 'pdf_com_senha'; erro?: string } | { bytes: Uint8Array; paginas: number };
const nomeDoErro = (e: unknown) => (e instanceof Error ? e.name : 'erro').slice(0, 60);

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

/**
 * Revisão final (A-D7, aviso de IA: "os dados escondidos do arquivo, como autor e localização, são retirados"). Anotações:
 * só as que desenham algo na página vão, e só com o desenho (/AP /N) e o lugar (/Rect) — sem /Contents, /T, /RC, /V, /FS,
 * /Popup, /Parent nem ação. Nota, anexo (FileAttachment), link, som e mídia nunca vão; nem a marcada como escondida.
 */
const ANOTACOES_QUE_DESENHAM = new Set(
  ['Widget', 'FreeText', 'Stamp', 'Square', 'Circle', 'Line', 'Polygon', 'PolyLine', 'Ink', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Caret'].map((n) => PDFName.of(n)),
);
const ESCONDIDA = 1 | 2 | 32; // /F: Invisible, Hidden, NoView

function soODesenho(doc: PDFDocument, item: unknown): PDFDict | null {
  const a = doc.context.lookup(item as never);
  if (!(a instanceof PDFDict)) return null;
  const subtipo = a.get(PDFName.of('Subtype'));
  if (!(subtipo instanceof PDFName) || !ANOTACOES_QUE_DESENHAM.has(subtipo)) return null;
  const f = a.lookup(PDFName.of('F'));
  if (f instanceof PDFNumber && (f.asNumber() & ESCONDIDA) !== 0) return null;
  const rect = a.lookup(PDFName.of('Rect'));
  const ap = a.lookup(PDFName.of('AP'));
  if (!(rect instanceof PDFArray) || !(ap instanceof PDFDict)) return null;
  let n = ap.get(PDFName.of('N'));
  const estados = doc.context.lookup(n);
  if (estados instanceof PDFDict) {
    // caixa de seleção e botão: um desenho por estado; vai só o do estado atual (/AS)
    const as = a.get(PDFName.of('AS'));
    n = as instanceof PDFName ? estados.get(as) : undefined;
  }
  if (!n || !(doc.context.lookup(n) instanceof PDFStream)) return null;
  return doc.context.obj({ Type: 'Annot', Subtype: subtipo, Rect: rect, AP: { N: n } });
}

/** Troca as anotações de cada página só pelo desenho das que desenham (no ORIGINAL, antes da cópia). */
function anotacoesSoComODesenho(doc: PDFDocument): void {
  const chave = PDFName.of('Annots');
  for (const pagina of doc.getPages()) {
    const lista = pagina.node.lookup(chave);
    pagina.node.delete(chave);
    if (!(lista instanceof PDFArray)) continue;
    const desenhos = [];
    for (let i = 0; i < lista.size(); i++) {
      const d = soODesenho(doc, lista.get(i));
      if (d) desenhos.push(doc.context.register(d));
    }
    if (desenhos.length) pagina.node.set(chave, doc.context.obj(desenhos));
  }
}

/**
 * JPEG embutido como está (DCTDecode: a foto do laudo que um app de "scanner" põe no PDF): sem os segmentos APP1–APP13 e
 * APP15 (EXIF com GPS e aparelho, XMP, IPTC, perfil ICC — a cor da imagem vem do /ColorSpace do PDF) e sem comentário
 * (COM). Ficam o APP0 (JFIF) e o APP14 (Adobe, transformação de cor), as tabelas e o scan, byte a byte. Formato que não
 * se lê → null (o laudo não sai).
 */
function jpegSemMetadados(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const partes: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  for (;;) {
    if (i + 1 >= b.length || b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i++; // preenchimento
      continue;
    }
    if (m === 0xda) {
      partes.push(b.subarray(i)); // início do scan: daqui em diante, dados da imagem
      break;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      partes.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (m === 0xd9 || i + 4 > b.length) return null;
    const fim = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (fim < i + 4 || fim > b.length) return null;
    if (!((m >= 0xe1 && m <= 0xed) || m === 0xef || m === 0xfe)) partes.push(b.subarray(i, fim));
    i = fim;
  }
  const saida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

class ImagemIlegivelError extends Error {
  override name = 'ImagemIlegivelError';
}

/** Regrava, no ORIGINAL, as imagens JPEG (DCTDecode) sem os metadados; outra cadeia de filtros com DCT não sai. */
function imagensSemMetadados(doc: PDFDocument): void {
  const DCT = PDFName.of('DCTDecode');
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream) || obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const filtro = obj.dict.lookup(PDFName.of('Filter'));
    const filtros = filtro instanceof PDFArray ? filtro.asArray().map((x) => doc.context.lookup(x)) : [filtro];
    if (!filtros.includes(DCT)) continue;
    // DCT encadeado com outro filtro (raro): os bytes do JPEG não estão à vista para limpar — melhor não enviar
    if (filtros.length !== 1 || !(obj instanceof PDFRawStream)) throw new ImagemIlegivelError();
    const limpo = jpegSemMetadados(obj.contents);
    if (!limpo) throw new ImagemIlegivelError();
    doc.context.assign(ref, PDFRawStream.of(obj.dict, limpo));
  }
}

async function regravar({ pdf, limitePaginas }: Entrada): Promise<SaidaDoPdf> {
  let original: PDFDocument;
  let paginas: number;
  try {
    // ignoreEncryption + isEncrypted (e não `instanceof EncryptedPDFError`): o pdf-lib 1.17.1 é ES5 e a subclasse de
    // Error perde o protótipo, então o instanceof nunca casa e o PDF com senha viraria arquivo_invalido
    original = await PDFDocument.load(pdf, { updateMetadata: false, throwOnInvalidObject: true, ignoreEncryption: true });
    paginas = original.getPageCount(); // dentro do try: PDF sem catálogo lança TypeError, que vira arquivo_invalido (não relança o job)
  } catch (e) {
    // PDF cifrado com fluxos de objetos (o comum hoje) nem chega a abrir: os objetos dentro deles estão cifrados.
    // A chave /Encrypt fica em claro no trailer; só aqui, com a leitura já recusada, ela decide a mensagem.
    if (Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength).includes('/Encrypt')) return { motivo: 'pdf_com_senha' };
    return { motivo: 'arquivo_invalido', erro: nomeDoErro(e) };
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
    anotacoesSoComODesenho(original);
    imagensSemMetadados(original);
    // documento NOVO só com as páginas: o dicionário Info e o XMP (/Metadata do catálogo) do original não vêm junto
    const novo = await PDFDocument.create({ updateMetadata: false });
    for (const p of await novo.copyPages(original, original.getPageIndices())) novo.addPage(p);
    return { bytes: await novo.save({ useObjectStreams: true }), paginas };
  } catch (e) {
    return { motivo: 'arquivo_invalido', erro: nomeDoErro(e) };
  }
}

if (parentPort) {
  const saida = await regravar(workerData as Entrada);
  // o PDF regravado volta transferido (sem cópia): pode ter dezenas de MB
  parentPort.postMessage(saida, 'bytes' in saida ? [saida.bytes.buffer as ArrayBuffer] : []);
}
