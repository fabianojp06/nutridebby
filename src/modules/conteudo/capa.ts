import sharp from 'sharp';
import { detectarTipo } from '@/lib/file-type';
import { paraJpegSemMetadados } from '@/lib/jpeg';
import { logger, nomeDoErro } from '@/lib/logger';
import { TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';

export const CAPA_LADO_MAX = 1280;
type Aceito = 'jpg' | 'png' | 'webp';

/**
 * D8: toda capa vira JPEG ≤ 1280 px, qualidade 80, sem EXIF/GPS, transparência sobre branco — o mesmo pipeline da foto
 * do diário (`paraJpegSemMetadados`); `rotate()` aplica a orientação antes. Tipo pelo conteúdo; 40 MP no máximo (como
 * o logo). Upload da nutricionista: `['jpg', 'png']` (US-051); a miniatura do oEmbed também pode vir em WebP.
 */
export async function processarCapa(conteudo: Buffer, aceitos: readonly Aceito[] = ['jpg', 'png', 'webp']): Promise<Buffer> {
  const tipo = detectarTipo(conteudo);
  if (!tipo || !(aceitos as readonly string[]).includes(tipo.ext)) throw new TipoNaoPermitidoError();
  try {
    return await paraJpegSemMetadados(sharp(conteudo, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate(), CAPA_LADO_MAX);
  } catch (err) {
    logger.warn({ err: nomeDoErro(err) }, 'capa recusada pelo decodificador');
    throw new TipoNaoPermitidoError();
  }
}
