import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const RAIZ = path.resolve('.');
const EXTENSOES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
/** Fontes que o grafo percorre (o resto — CSS, JSON, imagens — é folha). */
const CODIGO = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;
const tipoDoScript = (arquivo: string) =>
  /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : /\.jsx$/.test(arquivo) ? ts.ScriptKind.JSX : /\.(js|mjs|cjs)$/.test(arquivo) ? ts.ScriptKind.JS : ts.ScriptKind.TS;

/**
 * Especificadores importados em tempo de execução (pela árvore sintática do TypeScript): `import`, `export … from`,
 * `import('…')` e `require('…')`. `import type`/`export type` (a declaração inteira) somem na compilação e não contam;
 * `import { type X }` conta (pode sobrar como `import {} from`) — erra para o lado seguro.
 */
function especificadores(fonte: string, arquivo: string): string[] {
  const sf = ts.createSourceFile(arquivo, fonte, ts.ScriptTarget.Latest, false, tipoDoScript(arquivo));
  const out: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      if (!n.importClause?.isTypeOnly && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n)) {
      if (!n.isTypeOnly && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n)) {
      const chamada = n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require');
      const [arg] = n.arguments;
      if (chamada && arg && ts.isStringLiteralLike(arg)) out.push(arg.text);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return out;
}

/** Arquivo do projeto que o especificador aponta (alias `@/` = `src/`), ou null para pacote (node_modules, node:). */
function resolver(spec: string, de: string, raiz: string): string | null {
  const base = spec.startsWith('@/') ? path.join(raiz, 'src', spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(de), spec) : null;
  if (!base) return null;
  for (const c of [base, ...EXTENSOES.map((e) => base + e)]) if (existsSync(c) && statSync(c).isFile()) return c;
  throw new Error(`grafo de imports: não resolvi '${spec}' em ${path.relative(raiz, de)}`);
}

const nomeDoPacote = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

export type Grafo = {
  /** Arquivos alcançados (caminho relativo à raiz do projeto) → quem importou primeiro (null = raiz). */
  arquivos: Map<string, string | null>;
  /** Pacotes importados por algum arquivo alcançado → o primeiro arquivo que importou. */
  pacotes: Map<string, string>;
};

/** Tudo o que as raízes alcançam em tempo de execução, direta ou indiretamente (sem entrar em node_modules). */
export function grafoDeImports(raizes: readonly string[], raiz = RAIZ): Grafo {
  const arquivos = new Map<string, string | null>();
  const pacotes = new Map<string, string>();
  const fila: string[] = [];
  for (const r of raizes) {
    const rel = path.relative(raiz, path.resolve(r));
    if (!arquivos.has(rel)) {
      arquivos.set(rel, null);
      fila.push(rel);
    }
  }
  while (fila.length) {
    const atual = fila.shift()!;
    const abs = path.join(raiz, atual);
    for (const spec of especificadores(readFileSync(abs, 'utf8'), abs)) {
      const alvo = resolver(spec, abs, raiz);
      if (!alvo) {
        if (!pacotes.has(nomeDoPacote(spec))) pacotes.set(nomeDoPacote(spec), atual);
        continue;
      }
      const rel = path.relative(raiz, alvo);
      if (!CODIGO.test(rel) || arquivos.has(rel)) continue; // CSS, JSON etc.: folha
      arquivos.set(rel, atual);
      fila.push(rel);
    }
  }
  return { arquivos, pacotes };
}

/** O caminho de importação até `arquivo` (para a mensagem de erro do teste). */
export function caminhoAte(g: Grafo, arquivo: string): string[] {
  const c: string[] = [];
  for (let a: string | null | undefined = arquivo; a; a = g.arquivos.get(a)) c.unshift(a);
  return c;
}

/**
 * Fontes de uma pasta, recursivo, sem os testes. Rodada 2: também .js/.jsx/.mjs/.cjs — com `allowJs` e as
 * `pageExtensions` padrão do Next, um `route.js` ou `page.jsx` em src/app é rota e não pode escapar das guardas.
 */
export const fontesDe = (pasta: string): string[] =>
  readdirSync(path.resolve(pasta), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(tsx?|jsx?|mjs|cjs)$/.test(d.name) && !/\.(test|spec)\.(tsx?|jsx?|mjs|cjs)$/.test(d.name))
    .map((d) => path.join(d.parentPath, d.name));

/** Arquivos especiais que o Next compila além das rotas (`proxy`/`middleware`, `instrumentation`, `next.config`). */
const ESPECIAIS_DO_NEXT = [
  ...['proxy', 'middleware', 'instrumentation', 'instrumentation-client'].flatMap((n) => [`src/${n}.ts`, `src/${n}.js`, `${n}.ts`, `${n}.js`]),
  ...['ts', 'mts', 'js', 'mjs', 'cjs'].map((e) => `next.config.${e}`),
];

/**
 * R1 / R11: as raízes do grafo do Next — todo `src/app/**` e os arquivos especiais que existirem. Quem criar um
 * `src/instrumentation.ts` ou trocar o `next.config` entra na guarda sem mexer nela.
 */
export function raizesDoNext(raiz = RAIZ): string[] {
  return [...fontesDe(path.join(raiz, 'src/app')), ...ESPECIAIS_DO_NEXT.map((f) => path.join(raiz, f)).filter((f) => existsSync(f))];
}
