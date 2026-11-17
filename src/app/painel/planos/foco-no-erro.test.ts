import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Lista } from '@/modules/plano-alimentar/listas';

// Revisão da T8 (rodada 1): na lista de substituição (até 20 grupos × 30 itens) o erro de um campo saía fora da tela de
// quem apertou "Salvar lista" no fim da página. Sem DOM no Vitest (ambiente node): o corpo do efeito roda sobre uma raiz
// falsa, e a montagem da lista confere que os avisos sem campo ao lado podem receber o foco.
// O comportamento no navegador fica no roteiro manual do relatório da T8.
const estado = vi.hoisted(() => ({ atual: {} as Record<string, unknown> }));
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useActionState: () => [estado.atual, () => {}, false] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { focarPrimeiroErro } = await import('./foco-no-erro');
const { ListaForm } = await import('./listas/lista-form');
const { ReferenciaForm } = await import('./referencias/referencia-form');

function raizFalsa() {
  const alvo = { scrollIntoView: vi.fn(), focus: vi.fn() };
  const querySelector = vi.fn(() => alvo);
  return { alvo, querySelector, raiz: { querySelector } as unknown as ParentNode };
}

describe('useFocoNoPrimeiroErro (corpo do efeito)', () => {
  it('com erro de campo: rola e põe o foco no primeiro campo inválido ou aviso marcado', () => {
    const { alvo, querySelector, raiz } = raizFalsa();
    focarPrimeiroErro(raiz, { nome: 'Já existe uma lista com este nome.' });
    expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"], [data-foco-erro]');
    expect(alvo.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(alvo.focus).toHaveBeenCalled();
  });

  it('sem erro ou só com o geral (que já sai junto do botão): o foco fica onde está', () => {
    for (const erros of [undefined, {}, { geral: 'Inclua pelo menos um grupo.' }] as (Record<string, string> | undefined)[]) {
      const { querySelector, raiz } = raizFalsa();
      focarPrimeiroErro(raiz, erros);
      expect(querySelector).not.toHaveBeenCalled();
    }
  });
});

describe('lista de substituição: avisos de erro sem campo ao lado recebem o foco', () => {
  it('grupo sem alimentos: o aviso tem tabindex -1 e a marca data-foco-erro; o nome inválido tem aria-invalid', () => {
    const G = '00000000-0000-4000-8000-000000000001';
    estado.atual = { erros: { nome: 'Já existe uma lista com este nome.', [`grupo:${G}:itens`]: 'Inclua pelo menos um alimento no grupo.' } };
    const lista = { id: 'l', nome: 'Frutas', orientacao: '', grupos: [{ id: G, nome: 'Frutas', itens: [] }] } as unknown as Lista;
    const html = renderToStaticMarkup(createElement(ListaForm, { acao: async (s) => s, lista, rotuloBotao: 'Salvar lista' }));
    expect(html).toMatch(/<input id="nome"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<p role="alert" tabindex="-1" data-foco-erro="true"[^>]*>Inclua pelo menos um alimento no grupo\.<\/p>/);
  });
});

describe('perfil de referência: salvar com erro leva o foco ao primeiro campo inválido (revisão final do Plano 19)', () => {
  it('Nome/Fonte inválidos têm aria-invalid (o primeiro da página recebe o foco); "nenhum nutriente" é aviso focável', () => {
    estado.atual = { erros: { fonte: 'Informe a fonte.', valores: 'Informe a meta ou o máximo de pelo menos um nutriente.' } };
    const html = renderToStaticMarkup(createElement(ReferenciaForm, { acao: async (s) => s, inicial: {}, rotuloBotao: 'Salvar' }));
    expect(html).toMatch(/<input id="fonte"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<p id="valores-erro" role="alert" data-foco-erro="true" tabindex="-1"[^>]*>Informe a meta/);
    // a ordem da página: o Nome/Fonte (topo) vem antes do aviso da tabela, e o querySelector pega o primeiro
    expect(html.indexOf('aria-invalid="true"')).toBeLessThan(html.indexOf('data-foco-erro'));
  });

  it('o formulário usa o mesmo efeito da lista de substituição', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/app/painel/planos/referencias/referencia-form.tsx', 'utf8')).toMatch(/useFocoNoPrimeiroErro\(raiz, state\.erros\)/);
  });
});
