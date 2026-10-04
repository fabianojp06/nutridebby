import type { Sharp } from 'sharp';

/**
 * Pixels → JPEG que cabe em `ladoMax` × `ladoMax`, qualidade 80, sem metadados (o sharp só copia EXIF/GPS com
 * withMetadata). Transparência (PNG/WebP) sobre fundo BRANCO: sem o flatten, o JPEG pinta o transparente de preto.
 * Um pipeline só para a foto do diário (Plano 06, 1600 px) e a capa do conteúdo (Plano 07, 1280 px).
 */
export function paraJpegSemMetadados(img: Sharp, ladoMax: number): Promise<Buffer> {
  return img
    .resize({ width: ladoMax, height: ladoMax, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}
