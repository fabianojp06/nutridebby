import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Visual V2 (D24): as telas da nutricionista usam só tokens (mudam com o tema). Cor fixa da paleta do Tailwind reprova no
// escuro (text-red-700: 2,55 sobre o cartão escuro; text-zinc-600: 2,14). `text-white` fica: só sobre bg-destaque/bg-marca.
const PASTAS = ['src/app/painel', 'src/components', 'src/modules', 'src/app/conta'];
const ARQUIVOS = PASTAS.flatMap((p) =>
  readdirSync(path.resolve(p), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.tsx') && (p !== 'src/modules' || d.parentPath.split(path.sep).includes('ui')))
    .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)).split(path.sep).join('/')),
).sort();

/** Arquivos que precisam de cor fixa, com o motivo. */
const EXCECOES: Record<string, string> = {
  'src/app/painel/whatsapp/conectar.tsx': 'o QR precisa de fundo branco para ser lido, também no modo escuro',
  'src/app/painel/cabecalho.tsx': 'o logo do consultório fica sobre fundo branco (um logo escuro sem fundo sumiria no escuro)',
  'src/app/painel/page.tsx': 'Início (T15): o botão "Abrir prontuário" é branco sobre o cartão de destaque, que tem a cor original da marca nos dois modos (bg-destaque); nenhum token é branco nos dois modos',
  'src/components/player-sob-demanda.tsx': 'player sob demanda (T6, D12): moldura preta como a do próprio YouTube/Vimeo nos dois modos, botão branco com texto preto sobre ela (21:1 fixo)',
};

const PALETA = 'red|amber|emerald|zinc|gray|green|yellow|blue|slate|neutral|stone|orange|lime|teal|sky|indigo|violet|purple|pink|rose';
const COR_FIXA = new RegExp(`(?<![\\w-])(?:dark:[\\w-]+|(?:text|bg|border|ring|outline|fill|stroke|divide|placeholder|decoration|from|via|to)-(?:${PALETA})-\\d{2,3}|bg-white|bg-black|text-black)(?![\\w-])`, 'g');
const CLASSES = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
const BORDA_COM_COR = /border-(?:campo|borda|transparent|marca|destaque|erro|aviso|ok|linha|current|white)/;

function problemas(arquivo: string): string[] {
  const s = readFileSync(arquivo, 'utf8');
  const out = [...s.matchAll(COR_FIXA)].map((m) => m[0]);
  for (const m of s.matchAll(CLASSES)) {
    const c = m[1] ?? m[2] ?? '';
    if (/(^|\s)border(\s|$)/.test(c) && !BORDA_COM_COR.test(c)) out.push(`"border" sem cor: ${c}`);
  }
  return out;
}

describe('sem cor fixa nas telas da nutricionista (D24)', () => {
  it.each(ARQUIVOS.filter((f) => !(f in EXCECOES)))('%s', (f) => expect(problemas(f)).toEqual([]));
  it('as exceções existem e ainda precisam ser exceção', () => {
    for (const f of Object.keys(EXCECOES)) expect(problemas(f).length, f).toBeGreaterThan(0);
  });
});
