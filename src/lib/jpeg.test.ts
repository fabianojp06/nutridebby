import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { paraJpegSemMetadados } from './jpeg';

// pixels fixos (sem ruído aleatório): o mesmo pipeline com a mesma qualidade dá os mesmos bytes
const raw = Buffer.alloc(800 * 600 * 3);
for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
const img = () => sharp(raw, { raw: { width: 800, height: 600, channels: 3 } });

describe('paraJpegSemMetadados (PM-9)', () => {
  it('qualidade padrão 80 (diário e capa sem mudança) e 85 quando pedida (laudo enviado pelo paciente)', async () => {
    const padrao = await paraJpegSemMetadados(img(), 2000);
    expect(padrao.equals(await paraJpegSemMetadados(img(), 2000, 80))).toBe(true);
    expect((await paraJpegSemMetadados(img(), 2000, 85)).length).toBeGreaterThan(padrao.length);
  });
});
