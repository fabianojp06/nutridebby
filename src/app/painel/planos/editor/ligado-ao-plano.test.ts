import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConteudoLigado, ListaLigada } from '@/modules/plano-alimentar/tipos';

// Só a montagem (US-239): as ações gravam no servidor e ficam simuladas.
vi.mock('./ligados-actions', () => ({
  ligarListaAction: vi.fn(), atualizarDaBibliotecaAction: vi.fn(), removerListaAction: vi.fn(), ligarConteudoAction: vi.fn(), desligarConteudoAction: vi.fn(),
}));
const { LigadoAoPlano } = await import('./ligado-ao-plano');

const lista: ListaLigada = {
  id: 'l1',
  listaOrigemId: 'b1',
  nome: 'Trocas do dia a dia',
  orientacao: 'Troque dentro do grupo.',
  copiadaEm: '2026-11-17T02:30:00Z', // 16/11 em São Paulo (fuso do consultório), 17/11 em UTC
  grupos: [{ nome: 'Carboidratos', itens: [{ nome: 'Arroz, tipo 1, cozido', quantidadeG: 100, medidaCaseiraTxt: '4 colheres de sopa cheias', fonte: 'taco', fonteVersao: null, fonteOrigem: null, porCem: { kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 } }] }],
};
const conteudos: ConteudoLigado[] = [
  { id: 'c1', contentId: 'x1', titulo: 'Como montar o prato', tipo: 'orientacao', situacao: 'publicado' },
  { id: 'c2', contentId: 'x2', titulo: 'Panqueca de aveia', tipo: 'receita', situacao: 'nao_publicado' },
  { id: 'c3', contentId: null, titulo: 'Vídeo antigo', tipo: null, situacao: 'excluido' },
];
const html = (o: { biblioteca?: Parameters<typeof LigadoAoPlano>[0]['biblioteca'] } = {}) =>
  renderToStaticMarkup(createElement(LigadoAoPlano, { planId: 'p1', patientId: 'a1', listas: [lista], conteudos, fuso: 'America/Sao_Paulo', ...o }));

describe('"Ligado ao plano" no editor (US-239)', () => {
  it('a cópia com a data no fuso do consultório; tipo e situação de cada conteúdo; o excluído com o título copiado', () => {
    const h = html();
    expect(h).toContain('Ligado ao plano');
    expect(h).toContain('Cópia de 16/11/2026. Mudanças na biblioteca não alteram este plano.');
    expect(h).toContain('Aparece para o paciente no app.'); // RN-254: a orientação da lista ligada
    expect(h).toContain('Arroz, tipo 1, cozido — 4 colheres de sopa cheias (100 g)');
    expect(h).toContain('Orientação · Publicado');
    expect(h).toContain('Receita · Não publicado — o paciente não vê');
    expect(h).toContain('Vídeo antigo (excluído)');
    // somente leitura (publicado, arquivado, bloqueado): nenhum botão
    expect(h).not.toMatch(/<button/);
  });

  it('rascunho: "Atualizar da biblioteca" só com a lista de origem na biblioteca; "Remover"; ligar só o que ainda não está; no limite, o botão desabilitado com o motivo', () => {
    const biblioteca = { listas: [{ id: 'b1', nome: 'Trocas do dia a dia', grupos: 1, itens: 1 }, { id: 'b2', nome: 'Lanches', grupos: 2, itens: 7 }], conteudos: [{ id: 'x1', titulo: 'Como montar o prato', tipo: 'orientacao' as const, publicado: true }, { id: 'x9', titulo: 'Sopa', tipo: 'receita' as const, publicado: false }] };
    const h = html({ biblioteca });
    expect(h).toMatch(/>Atualizar da biblioteca<span class="sr-only">: Trocas do dia a dia<\/span>/);
    expect(h.match(/>Remover<span/g)).toHaveLength(4);
    // sucesso de "Ligar" e "Atualizar": a região viva fica montada (vazia) desde o início, e os títulos dos itens recebem
    // o foco depois da ação (o painel de "Ligar" se esconde com o foco dentro)
    expect(h).toContain('<p role="status" class="sr-only"></p>');
    expect(h).toMatch(/<h3 id="[^"]+-lista-l1" tabindex="-1"[^>]*>Trocas do dia a dia<\/h3>/);
    expect(h).toMatch(/<p id="[^"]+-conteudo-c2" tabindex="-1"[^>]*>Panqueca de aveia<\/p>/);
    expect(h).toContain('>Ligar lista de substituição</button>');
    expect(h).toMatch(/<option value="b2"[^>]*>Lanches — 2 grupos · 7 itens<\/option>/);
    expect(h).not.toContain('<option value="b1"');
    expect(h).toMatch(/<option value="x9"[^>]*>Sopa — Receita · Não publicado — o paciente não vê<\/option>/);
    expect(h).not.toContain('<option value="x1"');
    // a lista de origem excluída da biblioteca: "Atualizar da biblioteca" some
    expect(html({ biblioteca: { ...biblioteca, listas: biblioteca.listas.slice(1) } })).not.toContain('Atualizar da biblioteca');
    // no limite (10 conteúdos): o botão desabilitado com "O plano pode ter até 5 listas e 10 receitas ou materiais."
    const cheio = renderToStaticMarkup(
      createElement(LigadoAoPlano, {
        planId: 'p1', patientId: 'a1', listas: [], fuso: 'America/Sao_Paulo', biblioteca,
        conteudos: Array.from({ length: 10 }, (_, k): ConteudoLigado => ({ id: `c${k}`, contentId: `y${k}`, titulo: `M${k}`, tipo: 'orientacao', situacao: 'publicado' })),
      }),
    );
    expect(cheio).toMatch(/<button type="button" disabled="" aria-expanded="false" aria-controls="[^"]+" aria-describedby="[^"]+-limite"[^>]*>Ligar receita ou material<\/button>/);
    expect(cheio).toContain('O plano pode ter até 5 listas e 10 receitas ou materiais.');
  });
});
