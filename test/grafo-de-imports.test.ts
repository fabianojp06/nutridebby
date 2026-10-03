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
    // rodada 2: com allowJs e as pageExtensions padrão do Next, rota em JS também é rota
    escrever('src/app/api/y/route.js');
    escrever('src/app/z/page.jsx');
    escrever('src/app/z/util.mjs');
    escrever('src/app/z/velho.cjs');
    escrever('src/app/z/page.test.jsx');
    escrever('src/app/z/estilo.css');
    escrever('src/proxy.ts');
    escrever('src/instrumentation.ts');
    escrever('next.config.mjs');
    expect(rel(raizesDoNext(dir))).toEqual([
      'next.config.mjs',
      'src/app/api/x/route.ts',
      'src/app/api/y/route.js',
      'src/app/painel/page.tsx',
      'src/app/z/page.jsx',
      'src/app/z/util.mjs',
      'src/app/z/velho.cjs',
      'src/instrumentation.ts',
      'src/proxy.ts',
    ]);
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

  it('rodada 2: uma rota em JS (.js/.jsx) é percorrida como as em TS — inclusive o import sem extensão de um .js', () => {
    escrever('src/j/route.js', "import { f } from './util';\nexport const GET = () => f();\n");
    escrever('src/j/util.js', "const p = require('pacote-js');\nexport const f = () => p;\n");
    escrever('src/j/page.jsx', "import { f } from './util';\nexport default function Page() { return <p>{f()}</p>; }\n");
    const g = grafoDeImports([path.join(dir, 'src/j/route.js'), path.join(dir, 'src/j/page.jsx')], dir);
    expect([...g.arquivos.keys()].sort()).toEqual(['src/j/page.jsx', 'src/j/route.js', 'src/j/util.js']);
    expect([...g.pacotes.keys()]).toEqual(['pacote-js']);
  });
});
