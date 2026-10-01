import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Guarda estática do menu do painel: toda página de `src/app/painel/**` mostra o `Cabecalho` (menu com "Sair"), direto
// ou por um layout acima dela (`pacientes/[id]/layout.tsx`). A lacuna das páginas de alimentos (Plano 04) ficou meses
// sem aviso: o layout por grupo de rotas, que a dispensaria, está no backlog.
const RAIZ = path.resolve('src/app/painel');
const PAGINAS = readdirSync(RAIZ, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name === 'page.tsx')
  .map((d) => path.relative(RAIZ, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
  .sort();

/** Páginas que não renderizam o `Cabecalho`, com o motivo. */
const EXCECOES: Record<string, string> = {
  'dpa/page.tsx': 'o aceite do DPA é a página para onde a nutricionista com o contrato pendente é obrigada a ir: tem o "Sair" próprio, sem o menu das áreas que ela ainda não pode usar',
};

const renderiza = (arquivo: string) => /<Cabecalho[\s/>]/.test(readFileSync(arquivo, 'utf8'));

/** `layout.tsx` entre a página e `src/app/painel` (inclusive) que renderiza o `Cabecalho`. */
function layoutQueRenderiza(pagina: string): string | null {
  for (let dir = path.dirname(path.join(RAIZ, pagina)); dir.startsWith(RAIZ); dir = path.dirname(dir)) {
    const layout = path.join(dir, 'layout.tsx');
    if (existsSync(layout) && renderiza(layout)) return path.relative(RAIZ, layout);
  }
  return null;
}

describe('menu do painel em todas as páginas da nutricionista (US-005, "Sair")', () => {
  it('a varredura encontra as páginas conhecidas', () => {
    expect(PAGINAS).toEqual(expect.arrayContaining(['page.tsx', 'alimentos/page.tsx', 'alimentos/[id]/page.tsx', 'pacientes/[id]/plano-alimentar/page.tsx', 'dpa/page.tsx']));
  });

  it.each(PAGINAS.filter((p) => !(p in EXCECOES)))('%s renderiza o <Cabecalho> ou fica sob um layout que o renderiza', (pagina) => {
    expect(renderiza(path.join(RAIZ, pagina)) || layoutQueRenderiza(pagina) !== null, `${pagina} não mostra o menu do painel nem o "Sair"`).toBe(true);
  });

  it('as exceções ainda existem e continuam sem o <Cabecalho> (senão saem da lista)', () => {
    for (const pagina of Object.keys(EXCECOES)) {
      expect(PAGINAS, pagina).toContain(pagina);
      expect(renderiza(path.join(RAIZ, pagina)) || layoutQueRenderiza(pagina) !== null, `${pagina} já mostra o menu: tire da lista de exceções`).toBe(false);
    }
  });
});
