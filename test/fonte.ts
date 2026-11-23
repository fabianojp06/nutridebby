import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Plano 26 (RN-513, RE-D67): leitura de fonte para as guardas das rotas da recepção (`rotas-da-recepcao.test.ts` e
 * `papeis-fora-do-painel.test.ts`). Só para testes: nada aqui roda no app.
 */
export type Arquivo = { arquivo: string; fonte: string };

/** Os arquivos `.ts`/`.tsx` (sem testes) de `src/app/<pasta>`, com o caminho relativo a `src/app` em `/`. */
export function arquivosDoApp(pasta: string): Arquivo[] {
  const raiz = path.resolve('src/app');
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

/** A rota de um `page.tsx`/`route.ts` (`painel/ajuda/page.tsx` → `/painel/ajuda`); os outros arquivos ficam como estão. */
export function rotaDoArquivo(arquivo: string): string {
  const m = /^(.*?)\/?(page\.tsx|route\.ts)$/.exec(arquivo);
  return m ? `/${m[1]}` : `/${arquivo}`;
}

export type Bloco = { nome: string; exportado: boolean; corpo: string };

const DECLARACAO = /^(export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)|const\s+(\w+)\b)/;
const FRONTEIRA = /^(export|async|function|const|let|var|type|interface|import|class|enum)\b/;

/**
 * As declarações de topo de um arquivo (funções e `const`), cada uma com o texto até a próxima declaração de topo. Basta
 * para seguir as chamadas a funções locais (`acesso(…)` → `requireNutri(…)`) sem um analisador de TypeScript.
 */
export function blocosDeTopo(fonte: string): Bloco[] {
  const linhas = semComentarios(fonte).split('\n');
  const blocos: Bloco[] = [];
  let atual: { nome: string; exportado: boolean; linhas: string[] } | null = null;
  for (const linha of linhas) {
    if (FRONTEIRA.test(linha)) {
      if (atual) blocos.push({ nome: atual.nome, exportado: atual.exportado, corpo: atual.linhas.join('\n') });
      const m = DECLARACAO.exec(linha);
      atual = m && (m[2] ?? m[3]) ? { nome: (m[2] ?? m[3])!, exportado: !!m[1], linhas: [linha] } : null;
      continue;
    }
    atual?.linhas.push(linha);
  }
  if (atual) blocos.push({ nome: atual.nome, exportado: atual.exportado, corpo: atual.linhas.join('\n') });
  return blocos;
}

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
