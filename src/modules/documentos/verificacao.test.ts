import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('document_verifications só por verificacao.ts (RLS_EXCEPTIONS)', () => {
  it('nenhum outro arquivo de src (fora o schema) cita a tabela', () => {
    const arquivos = readdirSync('src', { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name) && !d.name.endsWith('.test.ts'))
      .map((d) => path.join(d.parentPath, d.name))
      .filter((f) => !f.endsWith(path.join('documentos', 'verificacao.ts')) && !f.includes(path.join('db', 'schema')) && !f.endsWith(path.join('db', 'rls-guard.ts')));
    const citam = arquivos.filter((f) => /documentVerifications|document_verifications/.test(readFileSync(f, 'utf8')));
    expect(citam).toEqual([]);
  });
});
