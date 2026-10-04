import { readdirSync, readFileSync } from 'node:fs';
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

describe('imagem Docker (.dockerignore tira o e2e/)', () => {
  it('todo arquivo de e2e/ importado por src/ volta ao contexto do build (o next build confere os tipos de src/)', () => {
    const fontes = (readdirSync('src', { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
    const doE2e = new Set(fontes.flatMap((f) => [...readFileSync(path.join('src', f), 'utf8').matchAll(/from '(?:\.\.\/)+e2e\/([\w-]+)'/g)].map((m) => `e2e/${m[1]}.ts`)));
    expect(doE2e.size).toBeGreaterThan(0);
    const ignore = readFileSync('.dockerignore', 'utf8').split('\n').map((l) => l.trim());
    expect(ignore).toContain('e2e');
    for (const f of doE2e) expect(ignore, f).toContain(`!${f}`);
  });
});
