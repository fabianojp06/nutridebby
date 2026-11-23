import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Plano 08 (T14): o cabeçalho do painel é desenhado SÓ pelo layout (src/app/painel/layout.tsx). Nenhuma página nem layout
// interno desenha outro (menu em dobro). O layout não é barreira: toda página continua conferindo a sessão.
const RAIZ = path.resolve('src/app/painel');
const TSX = readdirSync(RAIZ, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.tsx'))
  .map((d) => path.relative(RAIZ, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
  .sort();
const PAGINAS = TSX.filter((f) => f.endsWith('page.tsx'));
const ler = (f: string) => readFileSync(path.join(RAIZ, f), 'utf8');

describe('cabeçalho do painel (D20)', () => {
  it('o layout do painel desenha o CabecalhoPainel e lê a sessão com o DPA pendente permitido', () => {
    const s = ler('layout.tsx');
    expect(s).toMatch(/<CabecalhoPainel[\s/>]/);
    expect(s).toMatch(/requireNutri\([^)]*permitirDpaPendente:\s*true/);
    expect(s).toMatch(/data-tema=/);
  });
  it('o link da marca tem o alvo de 44 px e o logo é decorativo (o nome do consultório já está no link)', () => {
    const s = ler('cabecalho.tsx');
    expect(s).toMatch(/<Link href="\/painel" className="[^"]*\bmin-h-11\b/);
    expect(s).toMatch(/<img src=\{marca\.logoUrl\} alt="" /);
  });
  it('o contêiner do layout não é flex: o <main className="mx-auto max-w-*"> das telas ocupa a largura até o máximo', () => {
    // num flex em coluna, item com margens laterais auto não estica: 17 telas ficariam com a largura do próprio conteúdo
    // className="…" ou className={`${FONTES_DO_PAINEL} …`} (P08-13: as fontes do painel com preload)
    const m = /<div data-tema=\{tema\}[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(ler('layout.tsx'));
    const conteiner = m?.[1] ?? m?.[2];
    expect(conteiner).toBeDefined();
    expect(conteiner).not.toMatch(/(^|\s)(inline-)?(flex|grid)(\s|$)/);
  });
  it('o menu da conta fecha ao navegar, com Esc e com clique fora (o layout fica montado; o open do <details> é do DOM)', () => {
    expect(ler('menu-conta.tsx')).toMatch(/<DetalhesDaConta>[\s\S]*<summary[\s\S]*<\/DetalhesDaConta>/);
    const d = ler('detalhes-da-conta.tsx');
    expect(d).toMatch(/^'use client';/);
    expect(d).toMatch(/<details ref=\{ref\}[^>]*data-guia="conta"/);
    expect(d).toMatch(/usePathname\(\)/);
    expect(d).toMatch(/\[caminho\]/);
    expect(d).toContain("'Escape'");
    expect(d).toContain("'pointerdown'");
    expect(d).toContain("closest('a')");
  });
  it.each(TSX.filter((f) => !['layout.tsx', 'cabecalho.tsx'].includes(f)))('%s não desenha cabeçalho próprio', (f) => {
    const s = ler(f);
    expect(s).not.toMatch(/<Cabecalho(Painel)?[\s/>]/);
    expect(s).not.toMatch(/from '(\.\.\/)+cabecalho'|from '\.\/cabecalho'/);
  });
  // Plano 22 (R22-11): acessoComDocumentos (src/app/painel/documentos-liberados.ts) é requireNutri + o interruptor de documentos.
  it.each(PAGINAS)('%s confere a sessão (requireNutri, carregarProntuario ou acessoComDocumentos)', (f) => {
    expect(ler(f)).toMatch(/requireNutri\(|carregarProntuario\(|acessoComDocumentos\(/);
  });
});
