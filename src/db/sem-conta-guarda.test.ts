import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEM_CONTA_PERMITIDOS } from './tenant';

// N7: semConta tira a exigência do ator. Só os fluxos de paciente sem login podem usar (lista fechada).
describe('guarda do semConta', () => {
  it('semConta só nos arquivos de SEM_CONTA_PERMITIDOS (fora dos testes e do próprio tenant.ts)', () => {
    const usam = readdirSync(path.resolve('src'), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
      .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)))
      .filter((f) => f !== 'src/db/tenant.ts' && /\bsemConta\b/.test(readFileSync(f, 'utf8')))
      .sort();
    expect(usam).toEqual([...SEM_CONTA_PERMITIDOS].sort());
  });
  it('Plano 23 (RN-434): a retirada da autorização de aniversário pelo link do e-mail está na lista', () => {
    expect(SEM_CONTA_PERMITIDOS).toContain('src/modules/agenda/aniversarios.ts');
  });
});
