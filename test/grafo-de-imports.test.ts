import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { grafoDeImports, raizesDoNext } from './grafo-de-imports';

const dir = mkdtempSync(path.join(tmpdir(), 'nd-grafo-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const escrever = (arquivo: string, fonte = '') => {
  mkdirSync(path.dirname(path.join(dir, arquivo)), { recursive: true });
  writeFileSync(path.join(dir, arquivo), fonte);
};
const rel = (fs: string[]) => fs.map((f) => path.relative(dir, f)).sort();

describe('grafo de imports das guardas (R1, R11)', () => {
  it('raízes do Next: src/app (sem testes) e os arquivos especiais que existirem — proxy, instrumentation, next.config', () => {
    escrever('src/app/painel/page.tsx');
    escrever('src/app/api/x/route.ts');
    escrever('src/app/api/x/route.test.ts');
    escrever('src/proxy.ts');
    escrever('src/instrumentation.ts');
    escrever('next.config.mjs');
    expect(rel(raizesDoNext(dir))).toEqual(['next.config.mjs', 'src/app/api/x/route.ts', 'src/app/painel/page.tsx', 'src/instrumentation.ts', 'src/proxy.ts']);
    // no projeto: o next.config.ts existe e entra; instrumentation, quando for criado, entra sozinho
    expect(raizesDoNext().map((f) => path.relative(path.resolve('.'), f))).toEqual(expect.arrayContaining(['next.config.ts', 'src/proxy.ts']));
  });

  it('segue import, export … from, import() e require (com o alias @/); `import type` não conta; pacotes ficam registrados', () => {
    escrever('src/g/a.ts', "import { b } from './b';\nimport type { C } from './c';\nexport * from './e';\nexport const d = () => import('./d');\nconst x = require('pacote-x');\nimport '@/g/f';\n");
    for (const f of ['b', 'c', 'd', 'e', 'f']) escrever(`src/g/${f}.ts`, f === 'e' ? "import { y } from '@escopo/pacote/sub';" : '');
    const g = grafoDeImports([path.join(dir, 'src/g/a.ts')], dir);
    expect([...g.arquivos.keys()].sort()).toEqual(['src/g/a.ts', 'src/g/b.ts', 'src/g/d.ts', 'src/g/e.ts', 'src/g/f.ts']);
    expect([...g.pacotes.keys()].sort()).toEqual(['@escopo/pacote', 'pacote-x']);
    expect(g.arquivos.get('src/g/e.ts')).toBe('src/g/a.ts');
  });
});
