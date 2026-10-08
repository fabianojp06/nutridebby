import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caminhoAte, grafoDeImports, raizesDoNext } from '../../../test/grafo-de-imports';

const fontes = (dir: string): string[] =>
  readdirSync(path.resolve(dir), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(ts|tsx|mjs|js)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)).split(path.sep).join('/'));
const importa = (pacote: string) => (f: string) => new RegExp(`from '${pacote}(/[^']*)?'|import\\('${pacote}`).test(readFileSync(f, 'utf8'));

describe('RNF-169 / R-175: a rasterização e o job do envio de exame só no worker', () => {
  it('@hyzyla/pdfium só no processo filho da rasterização (src e scripts)', () => {
    expect([...fontes('src'), ...fontes('scripts')].filter(importa('@hyzyla/pdfium'))).toEqual(['src/modules/pacientes/rasterizar-pdf-processo.ts']);
  });

  it('nada do grafo do Next alcança a rasterização, o processo filho, o job do envio nem o PDFium', () => {
    const g = grafoDeImports(raizesDoNext());
    for (const proibido of [
      'src/modules/pacientes/rasterizar-pdf.ts',
      'src/modules/pacientes/rasterizar-pdf-processo.ts',
      'src/modules/pacientes/exames-enviados-job.tsx',
    ]) {
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
    expect(g.pacotes.get('@hyzyla/pdfium'), '@hyzyla/pdfium importado (no grafo do Next) por').toBeUndefined();
    expect(g.pacotes.get('heic-decode'), 'heic-decode importado (no grafo do Next) por').toBeUndefined();
  });
});
