import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Plano 26 (RN-513, RE-D67): leitura de fonte para as guardas das rotas da recepção (`rotas-da-recepcao.test.ts` e
 * `papeis-fora-do-painel.test.ts`). Só para testes: nada aqui roda no app.
 */
export type Arquivo = { arquivo: string; fonte: string };

/** Os arquivos `.ts`/`.tsx` (sem testes) de `src/app/<pasta>`, com o caminho relativo a `src/app` em `/`. */
export function arquivosDoApp(pasta: string): Arquivo[] {
  return arquivosDe('src/app', pasta);
}

/** Os arquivos `.ts`/`.tsx` (sem testes) de `<base>/<pasta>`, com o caminho relativo a `<base>` em `/`. */
export function arquivosDe(base: string, pasta = '.'): Arquivo[] {
  const raiz = path.resolve(base);
  return readdirSync(path.join(raiz, pasta), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => {
      const completo = path.join(d.parentPath, d.name);
      return { arquivo: path.relative(raiz, completo).split(path.sep).join('/'), fonte: readFileSync(completo, 'utf8') };
    })
    .sort((a, b) => a.arquivo.localeCompare(b.arquivo));
}

/**
 * Tira os comentários (bloco, JSDoc, JSX `{/* … *\/}` e `//` até o fim da linha): uma chamada citada num comentário não
 * conta. O `//` precedido de `:` ou de aspas (URL, texto) fica.
 */
export function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** O arquivo começa com a diretiva `'use server'` (Server Actions). */
export const ehDeServerActions = (fonte: string): boolean => /^\s*['"]use server['"]/.test(semComentarios(fonte));

/**
 * A rota de um `page.tsx`/`route.ts`/`layout.tsx` (`painel/ajuda/page.tsx` → `/painel/ajuda`); os outros arquivos ficam
 * como estão.
 */
export function rotaDoArquivo(arquivo: string): string {
  const m = /^(.*?)\/?(page\.tsx|route\.ts|layout\.tsx)$/.exec(arquivo);
  return m ? `/${m[1]}` : `/${arquivo}`;
}

/** `publico`: o nome com que o bloco sai do arquivo (o próprio, ou o de `export { local as publico }`). */
export type Bloco = { nome: string; exportado: boolean; publico: string; corpo: string };

const DECLARACAO = /^(export\s+)?(default\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)|const\s+(\w+)\b)/;
const FRONTEIRA = /^(export|async|function|const|let|var|type|interface|import|class|enum)\b/;
/** `export type`/`export interface` (só tipos: não viram código) e `export { … }` sem `from` são entendidos à parte. */
const SO_TIPO = /^export\s+(type|interface)\b/;

export type Topo = {
  blocos: Bloco[];
  /** As linhas `export` que o leitor não entende (default anônimo, reexportação, `export let`, desestruturação…): violação. */
  naoEntendidos: string[];
};

/**
 * As declarações de topo de um arquivo (funções e `const`), cada uma com o texto até a próxima declaração de topo. Basta
 * para seguir as chamadas a funções locais (`acesso(…)` → `requireNutri(…)`) sem um analisador de TypeScript. Os nomes de
 * `export { a, b as c }` e `export default a;` também contam como exportados; toda outra linha `export` que o leitor não
 * entende vai para `naoEntendidos`, para a guarda recusar em vez de deixar passar calada.
 */
export function analisarTopo(fonte: string): Topo {
  const linhas = semComentarios(fonte).split('\n');
  const blocos: Bloco[] = [];
  const naoEntendidos: string[] = [];
  const listas: [string, string][] = []; // [local, público] de `export { … }` e `export default nome;`
  // num objeto: o TypeScript não segue atribuições feitas dentro de `fechar`
  const e: { atual: { nome: string; exportado: boolean; publico: string; linhas: string[] } | null } = { atual: null };
  const fechar = () => {
    if (e.atual) blocos.push({ nome: e.atual.nome, exportado: e.atual.exportado, publico: e.atual.publico, corpo: e.atual.linhas.join('\n') });
    e.atual = null;
  };
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!FRONTEIRA.test(linha)) {
      e.atual?.linhas.push(linha);
      continue;
    }
    fechar();
    if (/^export\s*\{/.test(linha)) {
      let texto = linha;
      while (!texto.includes('}') && i + 1 < linhas.length) texto += ` ${linhas[++i]}`;
      const m = /^export\s*\{([^}]*)\}\s*;?\s*$/.exec(texto.trim());
      if (!m) naoEntendidos.push(texto.trim());
      else
        for (const item of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
          const n = /^(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?$/.exec(item);
          if (!n) naoEntendidos.push(texto.trim());
          else if (!item.startsWith('type ')) listas.push([n[1], n[2] ?? n[1]]);
        }
      continue;
    }
    const padrao = /^export\s+default\s+(\w+)\s*;?\s*$/.exec(linha);
    if (padrao && !/^(async|function|class)$/.test(padrao[1])) {
      listas.push([padrao[1], 'default']);
      continue;
    }
    const m = DECLARACAO.exec(linha);
    const nome = m?.[3] ?? m?.[4];
    if (m && nome) {
      e.atual = { nome, exportado: !!m[1], publico: m[2] ? 'default' : nome, linhas: [linha] };
      continue;
    }
    if (/^export\b/.test(linha) && !SO_TIPO.test(linha)) naoEntendidos.push(linha.trim());
  }
  fechar();
  for (const [local, publico] of listas) {
    const b = blocos.find((x) => x.nome === local);
    if (!b) naoEntendidos.push(`export { ${local} } sem declaração no arquivo`);
    else {
      b.exportado = true;
      b.publico = publico;
    }
  }
  return { blocos, naoEntendidos };
}

export const blocosDeTopo = (fonte: string): Bloco[] => analisarTopo(fonte).blocos;

const chama = (texto: string, funcao: string) => new RegExp(`\\b${funcao}\\s*\\(`).test(texto);

/** As funções de `guardas` alcançadas a partir do bloco `nome`, seguindo as chamadas a outros blocos do mesmo arquivo. */
export function guardasAlcancadas(blocos: Bloco[], nome: string, guardas: readonly string[]): Set<string> {
  const achadas = new Set<string>();
  const vistos = new Set<string>();
  const pilha = [nome];
  while (pilha.length) {
    const n = pilha.pop()!;
    if (vistos.has(n)) continue;
    vistos.add(n);
    const b = blocos.find((x) => x.nome === n);
    if (!b) continue;
    for (const g of guardas) if (chama(b.corpo, g)) achadas.add(g);
    for (const outro of blocos) if (outro.nome !== n && chama(b.corpo, outro.nome)) pilha.push(outro.nome);
  }
  return achadas;
}

/** As guardas chamadas em qualquer ponto do arquivo (sem comentários). */
export function guardasDoArquivo(fonte: string, guardas: readonly string[]): Set<string> {
  const s = semComentarios(fonte);
  return new Set(guardas.filter((g) => chama(s, g)));
}
