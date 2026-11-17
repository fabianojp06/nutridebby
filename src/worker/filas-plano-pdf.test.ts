import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILA_DO_PDF_DO_PLANO, FILAS_DO_PDF_DO_PLANO, QUEUES } from '@/jobs/queues';

/**
 * R-244 (Plano 19, P19-10b): o PDF do plano publicado pelo app novo vai para a fila nova `plano-pdf-2`, que só este
 * worker registra; o worker antigo, de pé até o novo subir, geraria um PDF sem dias nem texto livre e o marcaria
 * `pronto`. O worker novo também consome `plano-pdf` (jobs do app antigo na janela do deploy), com o mesmo handler.
 * O registro fica dentro de `startWorker` (não exportável sem subir o worker): a guarda lê o fonte.
 */
const fonte = readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8');

describe('filas do PDF do plano (R-244)', () => {
  it('`plano-pdf-2` tem as mesmas opções de `plano-pdf`; o app enfileira na nova', () => {
    expect(QUEUES['plano-pdf-2']).toEqual(QUEUES['plano-pdf']);
    expect(FILAS_DO_PDF_DO_PLANO).toEqual(['plano-pdf', 'plano-pdf-2']);
    expect(FILA_DO_PDF_DO_PLANO).toBe('plano-pdf-2');
  });

  it('o worker registra `plano-pdf` e `plano-pdf-2` com o mesmo handler (um laço sobre as duas filas, uma chamada de gerarPdfDoPlano)', () => {
    expect(fonte).toMatch(/for \(const fila of FILAS_DO_PDF_DO_PLANO\) await work\(fila, \{ includeMetadata: true \}, pdfDoPlano\);/);
    expect(fonte.match(/gerarPdfDoPlano\(/g)).toHaveLength(1);
    expect(fonte).toMatch(/const pdfDoPlano = async \(\[job\]: JobWithMetadata<DadosJobPdf>\[\]\) => \{\s*await gerarPdfDoPlano\(job\.data,/);
    // nenhum outro registro de fila do PDF do plano por nome (a varredura `expirar-plano-pdf` é outra fila)
    expect(fonte).not.toMatch(/work\(\s*'plano-pdf(-2)?'/);
  });
});
