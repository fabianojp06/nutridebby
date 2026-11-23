import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILA_DA_DIGITALIZADA, FILA_DO_PDF_DO_DOCUMENTO, FILAS_DA_DIGITALIZADA, FILAS_DO_PDF_DO_DOCUMENTO, QUEUES } from '@/jobs/queues';

/**
 * Plano 22 (EP-D34, R-375, RN-397): o PDF preparado e o da digitalizada do app novo vão para as filas novas
 * `documento-pdf-2` e `documento-digitalizado-2`, que só este worker registra; o worker antigo, de pé até o novo subir
 * (e na volta atrás), desenharia uma solicitação de exames como receita (e com o título `undefined` na digitalizada).
 * O worker novo também consome as filas antigas (jobs do app antigo na janela do deploy), com os mesmos handlers.
 * Molde de `filas-plano-pdf.test.ts` (Plano 19, R-244): o registro fica dentro de `startWorker`, então a guarda lê o fonte.
 */
const fonte = readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8');

/** Todo `.ts`/`.tsx` de `src/`, menos os testes (que esperam os jobs nas filas pelo nome) e o próprio `queues.ts`. */
function fontesDoApp(): { arquivo: string; texto: string }[] {
  return readdirSync('src', { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => path.join(d.parentPath, d.name))
    .filter((f) => f !== path.join('src', 'jobs', 'queues.ts'))
    .map((arquivo) => ({ arquivo, texto: readFileSync(arquivo, 'utf8') }));
}

describe('filas do PDF de documento (EP-D34)', () => {
  it('as filas "-2" têm as mesmas opções das antigas; o app enfileira nas novas', () => {
    expect(QUEUES['documento-pdf-2']).toEqual(QUEUES['documento-pdf']);
    expect(QUEUES['documento-digitalizado-2']).toEqual(QUEUES['documento-digitalizado']);
    expect(FILA_DO_PDF_DO_DOCUMENTO).toBe('documento-pdf-2');
    expect(FILAS_DO_PDF_DO_DOCUMENTO).toEqual(['documento-pdf', 'documento-pdf-2']);
    expect(FILA_DA_DIGITALIZADA).toBe('documento-digitalizado-2');
    expect(FILAS_DA_DIGITALIZADA).toEqual(['documento-digitalizado', 'documento-digitalizado-2']);
  });

  it('nenhum send(\'documento-pdf\' nem send(\'documento-digitalizado\' (aspas simples, duplas ou crase) em src/ fora de queues.ts', () => {
    const fontes = fontesDoApp();
    // a varredura anda de verdade: os dois módulos que enfileiram estão na lista e usam as constantes
    const documentos = fontes.find((f) => f.arquivo === path.join('src', 'modules', 'documentos', 'documentos.ts'))!;
    const digitalizada = fontes.find((f) => f.arquivo === path.join('src', 'modules', 'documentos', 'digitalizada.ts'))!;
    expect(documentos.texto).toMatch(/\.send\(FILA_DO_PDF_DO_DOCUMENTO,/);
    expect(digitalizada.texto).toMatch(/\.send\(FILA_DA_DIGITALIZADA,/);
    const antigas = /send\(\s*['"`]documento-(pdf|digitalizado)['"`]/;
    expect(fontes.filter((f) => antigas.test(f.texto)).map((f) => f.arquivo)).toEqual([]);
    // nem a fila nova pelo nome: só pela constante (um send('documento-pdf-2' passaria, mas foge do ponto único)
    const novasPeloNome = /send\(\s*['"`]documento-(pdf|digitalizado)-2['"`]/;
    expect(fontes.filter((f) => novasPeloNome.test(f.texto)).map((f) => f.arquivo)).toEqual([]);
  });

  it('o worker registra as duas famílias com um handler cada (um laço sobre as filas; uma chamada de gerarPdfDoDocumento e de montarPdfDigitalizado)', () => {
    expect(fonte).toMatch(/for \(const fila of FILAS_DO_PDF_DO_DOCUMENTO\) await work\(fila, \{ includeMetadata: true \}, pdfDoDocumento\);/);
    expect(fonte).toMatch(/for \(const fila of FILAS_DA_DIGITALIZADA\) await work\(fila, \{ includeMetadata: true \}, pdfDaDigitalizada\);/);
    expect(fonte.match(/gerarPdfDoDocumento\(/g)).toHaveLength(1);
    expect(fonte.match(/montarPdfDigitalizado\(/g)).toHaveLength(1);
    expect(fonte).toMatch(/const pdfDoDocumento = async \(\[job\]: JobWithMetadata<\{ tenantId: string; documentoId: string \}>\[\]\) => \{\s*await gerarPdfDoDocumento\(job\.data,/);
    expect(fonte).toMatch(/const pdfDaDigitalizada = async \(\[job\]: JobWithMetadata<\{ tenantId: string; documentoId: string; userId: string \}>\[\]\) => \{\s*await montarPdfDigitalizado\(job\.data,/);
    // nenhum outro registro dessas filas pelo nome (a varredura `expirar-documento-pdf` é outra fila)
    expect(fonte).not.toMatch(/work\(\s*['"`]documento-(pdf|digitalizado)(-2)?['"`]/);
  });
});
