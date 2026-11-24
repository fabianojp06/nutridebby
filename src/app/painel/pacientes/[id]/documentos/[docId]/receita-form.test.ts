import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConteudoReceita } from '@/modules/documentos/prescricao';

// Só a montagem do editor com um estado de erro (o useActionState devolve o estado pedido; as ações não rodam). O
// comportamento no navegador (o reset do React 19, o envio do que está na tela) fica no e2e/receita-editor.spec.ts.
const estado = vi.hoisted(() => ({ atual: {} as Record<string, unknown> }));
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useActionState: () => [estado.atual, () => {}, false] }));
vi.mock('../actions', () => ({ salvarRascunhoAction: vi.fn(), prepararAction: vi.fn() }));
const { ReceitaForm } = await import('./receita-form');

const suplemento = (composicao: { nome: string; quantidade: number; unidade: string }[]) =>
  ({ tipo: 'suplemento', categoria: 'nutriente', composicao, forma: 'Cápsula', via: 'oral', posologia: '1 ao dia', manipulado: false }) as unknown as ConteudoReceita['itens'][number];
const VITD = { nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' };

function montar(itens: ConteudoReceita['itens'], erros: Record<string, string> = {}, extra: Record<string, unknown> = {}): string {
  estado.atual = { erros, ...extra };
  const conteudo = { versao: 1, tipo: 'receita', itens, orientacoes: '' } as ConteudoReceita;
  return renderToStaticMarkup(createElement(ReceitaForm, { patientId: 'p', docId: 'd', conteudo, justificativa: '', habilitada: false, declaracao: 'Declaro que…' }));
}
/** A tag de abertura do controle com o id pedido. */
const tag = (html: string, id: string) => html.match(new RegExp(`<(?:input|select|textarea|fieldset)[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

describe('editor da receita: erros visíveis e ligados ao campo (revisão da T6)', () => {
  it('composição vazia: "Informe de 1 a 10 componentes." aparece na Composição, ligado ao grupo', () => {
    const html = montar([suplemento([])], { 'itens.0.composicao': 'Informe de 1 a 10 componentes.' });
    expect(html).toMatch(/<p id="itens-0-composicao-erro" role="alert"[^>]*>Informe de 1 a 10 componentes\.<\/p>/);
    expect(tag(html, 'itens-0-composicao')).toContain('aria-describedby="itens-0-composicao-erro"');
  });

  it('"Remover componente" só aparece quando há mais de um componente', () => {
    expect(montar([suplemento([VITD])])).not.toContain('Remover componente');
    const dois = montar([suplemento([VITD, { nome: 'Vitamina K2', quantidade: 100, unidade: 'mcg' }])]);
    expect(dois).toContain('Remover componente 1');
    expect(dois).toContain('Remover componente 2');
  });

  it('selects, componente, orientações e justificativa: aria-invalid e aria-describedby apontando para o erro (RNF-10)', () => {
    const erros = {
      'itens.0.categoria': 'Escolha uma das opções.',
      'itens.0.via': 'Escolha uma das opções.',
      'itens.0.composicao.0.nome': 'Informe o nome.',
      'itens.0.composicao.0.quantidade': 'Informe uma quantidade maior que zero.',
      'itens.0.composicao.0.unidade': 'Escolha uma das opções.',
      orientacoes: 'Use no máximo 2000 caracteres.',
    };
    const html = montar([suplemento([VITD])], { ...erros, justificativa: 'Escreva a justificativa de uso (fica no prontuário, não vai na receita).' });
    for (const k of Object.keys(erros)) {
      const id = k.replace(/\./g, '-');
      expect(tag(html, id), id).toContain('aria-invalid="true"');
      expect(tag(html, id), id).toContain(`aria-describedby="${id}-erro"`);
      expect(html, id).toContain(`<p id="${id}-erro" role="alert"`);
    }
    expect(tag(html, 'justificativa')).toContain('aria-describedby="justificativa-dica justificativa-erro"');
    expect(html).toContain('<p id="justificativa-erro" role="alert"');
  });

  it('erro de uma chave que nenhum campo mostra: aparece no aviso geral (nada some em silêncio)', () => {
    const html = montar([suplemento([VITD])], { 'itens.0.desconhecido': 'Mensagem sem campo.' });
    expect(html).toMatch(/role="alert"[^>]*>(?:<p>)?Mensagem sem campo\./);
  });

  it('a declaração e "Preparar para assinatura" ficam no mesmo formulário do editor (o preparo envia o que está na tela)', () => {
    const html = montar([suplemento([VITD])], { declaracao: 'Confirme a declaração para continuar.' }, { intencao: 'preparar' });
    expect(html.match(/<form/g)).toHaveLength(1);
    const botao = html.match(/<button[^>]*>Preparar para assinatura<\/button>/)?.[0] ?? '';
    expect(botao).toContain('name="intencao"');
    expect(botao).toContain('value="preparar"');
    expect(html.indexOf('Salvar rascunho')).toBeLessThan(html.indexOf('Preparar para assinatura')); // Enter num campo salva, não prepara
    expect(tag(html, 'declaracao')).toContain('aria-describedby="declaracao-erro"');
    expect(html).toContain('data-guia="preparar-documento"');
    expect(html).toContain('data-guia="editor-receita"');
  });
});

describe('editor da receita: o reset automático do React 19 não desencontra a tela do JSON (SUS-108)', () => {
  it('o <form> cancela o reset (semResetAutomatico) e o JSON escondido sai do mesmo estado que os campos mostram', () => {
    // Reproduzido no navegador: depois do erro do "Preparar" (e até do "Rascunho salvo."), a tela mostrava Categoria
    // "Nutriente", Unidade "g", Via "Oral" e "Manipulado" desmarcado, e o JSON salvava enzima/U/sublingual/manipulado.
    const f = readFileSync('src/app/painel/pacientes/[id]/documentos/[docId]/receita-form.tsx', 'utf8');
    expect(f).toMatch(/<form action=\{action\} ref=\{semResetAutomatico\}/);
    expect(f).toMatch(/<input type="hidden" name="conteudo" value=\{JSON\.stringify\(\{ itens, orientacoes \}\)\} \/>/);
    const p = readFileSync('src/app/painel/pacientes/[id]/documentos/[docId]/parecer-form.tsx', 'utf8');
    expect(p).toMatch(/<form action=\{action\} ref=\{semResetAutomatico\}/);
  });
});
