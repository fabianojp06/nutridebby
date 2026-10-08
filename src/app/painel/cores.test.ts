import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Visual V2 (D24): as telas da nutricionista usam só tokens (mudam com o tema). Cor fixa da paleta do Tailwind reprova no
// escuro (text-red-700: 2,55 sobre o cartão escuro; text-zinc-600: 2,14). `text-white` fica: só sobre bg-destaque/bg-marca.
const PASTAS = ['src/app/painel', 'src/components', 'src/modules', 'src/app/conta', 'src/app/p'];
const ARQUIVOS = PASTAS.flatMap((p) =>
  readdirSync(path.resolve(p), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.tsx') && (p !== 'src/modules' || d.parentPath.split(path.sep).includes('ui')))
    .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)).split(path.sep).join('/')),
).sort();

/**
 * Cores fixas permitidas, por arquivo, com o motivo. A exceção vale só para as classes listadas: o resto do arquivo segue a
 * regra (o erro de conexão do WhatsApp ficou em text-red-700, 2,86:1 no escuro, quando a exceção valia para o arquivo todo).
 */
const EXCECOES: Record<string, { motivo: string; classes: string[] }> = {
  'src/app/painel/whatsapp/conectar.tsx': { motivo: 'o QR precisa de fundo branco para ser lido, também no modo escuro', classes: ['bg-white'] },
  'src/app/painel/cabecalho.tsx': { motivo: 'o logo do consultório fica sobre fundo branco (um logo escuro sem fundo sumiria no escuro)', classes: ['bg-white'] },
  'src/components/portal/faixa.tsx': {
    motivo: 'o logo do consultório fica sobre fundo branco e a seção atual é a pílula branca da faixa (texto na cor da faixa, ≥ 4,5:1 por corDaFaixa); nenhum token é branco nos dois modos',
    classes: ['bg-white'],
  },
  'src/app/p/(portal)/perfil/page.tsx': {
    motivo: 'o logo do consultório em Eu fica sobre fundo branco (um logo escuro sumiria no aparelho escuro), como na faixa',
    classes: ['bg-white'],
  },
  'src/components/portal/nav-secoes.tsx': {
    motivo: 'a seção atual é a pílula branca da faixa (texto na cor da faixa, ≥ 4,5:1 por corDaFaixa); nenhum token é branco nos dois modos',
    classes: ['bg-white'],
  },
  'src/app/painel/page.tsx': {
    motivo: 'Início (T15): o botão "Abrir prontuário" é branco sobre o cartão de destaque, que tem a cor original da marca nos dois modos (bg-destaque); nenhum token é branco nos dois modos',
    classes: ['bg-white'],
  },
  'src/components/player-sob-demanda.tsx': {
    motivo: 'player sob demanda (T6, D12): moldura preta como a do próprio YouTube/Vimeo nos dois modos, botão branco com texto preto sobre ela (21:1 fixo)',
    classes: ['bg-black', 'bg-white', 'text-black'],
  },
};

const PALETA = 'red|amber|emerald|zinc|gray|green|yellow|blue|slate|neutral|stone|orange|lime|teal|sky|indigo|violet|purple|pink|rose';
const COR_FIXA = new RegExp(`(?<![\\w-])(?:dark:[\\w-]+|(?:text|bg|border|ring|outline|fill|stroke|divide|placeholder|decoration|from|via|to)-(?:${PALETA})-\\d{2,3}|bg-white|bg-black|text-black)(?![\\w-])`, 'g');
const CLASSES = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
const TOKENS_DE_BORDA = 'campo|borda|transparent|marca|destaque|erro|aviso|ok|linha|current|white|p-marco-texto|p-marco|faixa';
const BORDA_COM_COR = new RegExp(`(?<![\\w-])border-(?:${TOKENS_DE_BORDA})(?![\\w-])`);
const DIVISOR_COM_COR = new RegExp(`(?<![\\w-])divide-(?:${TOKENS_DE_BORDA})(?![\\w-])`);
// Sem cor, a borda usa currentColor (no Tailwind v4): no escuro vira linha quase branca. Vale para `border`, um lado ou
// uma espessura (`border-t`, `border-l-2`, `md:border-b`) e para os divisores (`divide-y`).
const BORDA = /(?<![\w-])(?:[\w-]+:)*border(?:-[trblxyse])?(?:-[1-9]\d*)?(?![\w-])/;
const DIVISOR = /(?<![\w-])(?:[\w-]+:)*divide-[xy](?:-\d+)?(?![\w-])/;
// Botão ou link principal (fundo da marca com padding) tem o alvo de 44 px do `Botao` (T15; WCAG 2.5.8).
const BOTAO_PRINCIPAL = /(?<![\w-])bg-destaque(?![\w-])/;

function problemas(arquivo: string): string[] {
  const s = readFileSync(arquivo, 'utf8');
  const out = [...s.matchAll(COR_FIXA)].map((m) => m[0]);
  // Texto branco sobre a cor da marca: clarear no hover baixa o contraste (#767676 → ~#828282, 3,8:1); escurecer sobe.
  // No arquivo todo: o Botao guarda as classes numa constante, fora do className.
  for (const m of s.matchAll(/(?<![\w-])hover:brightness-(?:1\d\d|[2-9]\d\d)(?![\w-])/g)) out.push(`hover que clareia: ${m[0]}`);
  // Linha na cor da marca sobre o fundo (aba ativa, refeição seguinte): bg-destaque é a cor original nos dois modos (2,6:1
  // contra o cartão escuro); a borda usa a marca do modo (border-marca, com a variante clara no escuro).
  for (const m of s.matchAll(/(?<![\w-])border(?:-[trblxyse])?-destaque(?![\w-])/g)) out.push(`borda na cor original da marca: ${m[0]}`);
  for (const m of s.matchAll(CLASSES)) {
    const c = m[1] ?? m[2] ?? '';
    if (BORDA.test(c) && !BORDA_COM_COR.test(c)) out.push(`borda sem cor: ${c}`);
    if (DIVISOR.test(c) && !DIVISOR_COM_COR.test(c)) out.push(`divisor sem cor: ${c}`);
    if (BOTAO_PRINCIPAL.test(c) && /(?<![\w-])px-\d/.test(c) && !/(?<![\w-])min-h-11(?![\w-])/.test(c)) out.push(`botão principal sem min-h-11: ${c}`);
    // Estado ativo pintado com a marca: no escuro o bg-destaque fica abaixo de 3:1 contra o fundo (WCAG 1.4.1/1.4.11)
    if (/aria-\[current=page\]:bg-destaque/.test(c) && !/aria-\[current=page\]:underline/.test(c)) out.push(`ativo só pela cor: ${c}`);
  }
  return out;
}

describe('sem cor fixa nas telas da nutricionista (D24)', () => {
  it.each(ARQUIVOS)('%s', (f) => {
    const permitidas = EXCECOES[f]?.classes ?? [];
    expect(problemas(f).filter((p) => !permitidas.includes(p))).toEqual([]);
  });
  it('as exceções existem e ainda precisam ser exceção', () => {
    for (const [f, { classes }] of Object.entries(EXCECOES)) {
      const achadas = new Set(problemas(f));
      for (const c of classes) expect(achadas.has(c), `${f}: ${c}`).toBe(true);
    }
  });
});

describe('marca do consultório no portal (US-005, RN-207)', () => {
  it('a faixa usa a cor da faixa (bg-faixa = corDaFaixa, posta pelo layout em --nd-faixa), nunca a cor original em style', () => {
    const faixa = readFileSync('src/components/portal/faixa.tsx', 'utf8');
    expect(faixa).toMatch(/(?<![\w-])bg-faixa(?![\w-])/);
    expect(faixa).toMatch(/<img [^>]*className="[^"]*\bbg-white\b/);
    expect(faixa).not.toMatch(/backgroundColor/);
    expect(readFileSync('src/app/p/(portal)/layout.tsx', 'utf8')).toMatch(/'--nd-faixa': corDaFaixa\(marca\.cor\)/);
  });
});

describe('foco visível dentro de lista com rolagem vertical (RNF-10/D25)', () => {
  // O contorno global do :focus-visible (3 px, afastado 2 px) sai 5 px do item: a caixa com rolagem precisa de folga
  // interna (p-2 ou mais), senão o contorno das caixas de seleção é cortado à esquerda (lista de pacientes da audiência).
  it.each(ARQUIVOS.filter((f) => /(?<![\w-])overflow-y-auto(?![\w-])/.test(readFileSync(f, 'utf8'))))('%s', (f) => {
    for (const m of readFileSync(f, 'utf8').matchAll(CLASSES)) {
      const c = m[1] ?? m[2] ?? '';
      if (/(?<![\w-])overflow-y-auto(?![\w-])/.test(c)) expect(c).toMatch(/(?<![\w-])p-(?:[2-9]|1\d)(?![\w-])/);
    }
  });
});

describe('foco visível dentro de faixa com rolagem (RNF-10/D25)', () => {
  // overflow-x-auto também faz o eixo y rolar: o contorno global do :focus-visible (3 px, afastado 2 px, globals.css) fica
  // fora do item e é cortado em cima e embaixo. Os itens focáveis da faixa desenham o contorno para dentro.
  const COM_ROLAGEM = ARQUIVOS.filter((f) => /(?<![\w-])overflow-(?:x-)?auto(?![\w-])/.test(readFileSync(f, 'utf8')));
  it.each(COM_ROLAGEM)('%s', (f) => expect(readFileSync(f, 'utf8')).toMatch(/focus-visible:outline-offset-\[-3px\]/));
});
