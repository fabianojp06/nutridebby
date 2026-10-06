import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import sharp from 'sharp';
import { detectarTipo } from '@/lib/file-type';
import { paraJpegSemMetadados } from '@/lib/jpeg';
import { LIMITE_PAGINAS } from './constantes';
import type { ArquivoPreparado } from './provedor';

/**
 * Plano 11 (A-D7 = (a), RN-110): o laudo inteiro, sem metadados, pronto para ir inline em base64. Só o worker importa
 * (pdf-lib e sharp fora do grafo do Next; guarda em guardas.test.ts). Nada aqui é gravado em disco (regra 9: o arquivo
 * só é LIDO, pelo caminho do exame); o resultado vive em memória até a chamada.
 */
export const LADO_MAX_IMAGEM = 2576; // maior lado da alta resolução dos modelos 4.7+ (spec §5.4)
export const LIMITE_PEDIDO_BYTES = 32 * 1024 * 1024; // limite da API para o pedido inteiro
const MARGEM_DO_PEDIDO = 512 * 1024; // instruções, schema e o JSON em volta do base64
/** Chaves que carregam metadados ou ações (o conteúdo visível fica): XMP e dados de aplicativo em qualquer objeto, ações e miniatura da página. */
const CHAVES_DE_METADADOS = ['Metadata', 'PieceInfo', 'AA', 'Thumb'].map((c) => PDFName.of(c));

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
  let original: PDFDocument;
  let paginas: number;
  try {
    // ignoreEncryption + isEncrypted (e não `instanceof EncryptedPDFError`): o pdf-lib 1.17.1 é ES5 e a subclasse de
    // Error perde o protótipo, então o instanceof nunca casa e o PDF com senha viraria arquivo_invalido
    original = await PDFDocument.load(conteudo, { updateMetadata: false, throwOnInvalidObject: true, ignoreEncryption: true });
    paginas = original.getPageCount(); // dentro do try: PDF sem catálogo lança TypeError, que vira arquivo_invalido (não relança o job)
  } catch {
    // PDF cifrado com fluxos de objetos (o comum hoje) nem chega a abrir: os objetos dentro deles estão cifrados.
    // A chave /Encrypt fica em claro no trailer; só aqui, com a leitura já recusada, ela decide a mensagem.
    throw new PreparoError(conteudo.includes('/Encrypt') ? 'pdf_com_senha' : 'arquivo_invalido');
  }
  if (original.isEncrypted) throw new PreparoError('pdf_com_senha');
  if (paginas === 0) throw new PreparoError('arquivo_invalido');
  if (paginas > LIMITE_PAGINAS) throw new PreparoError('laudo_longo');
  let bytes: Uint8Array;
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
    bytes = await novo.save({ useObjectStreams: true });
  } catch {
    throw new PreparoError('arquivo_invalido');
  }
  if (!cabeNoPedido(bytes.length)) throw new PreparoError('arquivo_invalido');
  return { tipo: 'pdf', base64: Buffer.from(bytes).toString('base64'), paginas };
}

async function prepararImagem(conteudo: Buffer): Promise<ArquivoPreparado> {
  let jpeg: Buffer;
  try {
    // rotate() sem argumento = gira pela orientação EXIF; o JPEG novo sai sem nenhum metadado (src/lib/jpeg.ts)
    jpeg = await paraJpegSemMetadados(sharp(conteudo, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate(), LADO_MAX_IMAGEM);
  } catch {
    throw new PreparoError('arquivo_invalido');
  }
  if (!cabeNoPedido(jpeg.length)) throw new PreparoError('arquivo_invalido');
  return { tipo: 'imagem', base64: jpeg.toString('base64') };
}
