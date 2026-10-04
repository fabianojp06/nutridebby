import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROTAS_DO_PAINEL } from '../../../e2e/painel-rotas';

// RNF-10 (D25): o axe do painel cobre toda tela. Tela nova em src/app/painel sem entrada em ROTAS_DO_PAINEL quebra aqui.
describe('ROTAS_DO_PAINEL', () => {
  it('tem exatamente um caminho por page.tsx de src/app/painel', () => {
    const raiz = path.resolve('src/app');
    const paginas = readdirSync(path.join(raiz, 'painel'), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && d.name === 'page.tsx')
      .map((d) => `/${path.relative(raiz, d.parentPath).split(path.sep).join('/')}`)
      .sort();
    expect(Object.keys(ROTAS_DO_PAINEL).sort()).toEqual(paginas);
  });
});
