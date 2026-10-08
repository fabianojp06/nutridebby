import type { Sharp } from 'sharp';

/**
 * Pixels → JPEG que cabe em `ladoMax` × `ladoMax`, sem metadados (o sharp só copia EXIF/GPS com withMetadata).
 * Transparência (PNG/WebP) sobre fundo BRANCO: sem o flatten, o JPEG pinta o transparente de preto. Um pipeline só para a
 * foto do diário (Plano 06, 1600 px, 80), a capa do conteúdo (Plano 07, 1280 px, 80) e o laudo enviado pelo paciente
 * (Plano 12, 2000 px, 85 — PM-9).
 */
export function paraJpegSemMetadados(img: Sharp, ladoMax: number, qualidade = 80): Promise<Buffer> {
  return img
    .resize({ width: ladoMax, height: ladoMax, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: qualidade, mozjpeg: true })
    .toBuffer();
}
