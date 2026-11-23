import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DECLARACAO_RECEITA, declaracaoDoDocumento, FRASE_FORMULA_FITOTERAPICA } from '@/modules/documentos/constantes';
import type { ConteudoReceita } from '@/modules/documentos/prescricao';

// Só a montagem do editor com um estado de erro (o useActionState devolve o estado pedido; as ações não rodam). O
// comportamento no navegador (o reset do React 19, o envio do que está na tela) fica no e2e/receita-editor.spec.ts.
const estado = vi.hoisted(() => ({ atual: {} as Record<string, unknown> }));
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useActionState: () => [estado.atual, () => {}, false] }));
vi.mock('../actions', () => ({ salvarRascunhoAction: vi.fn(), prepararAction: vi.fn() }));
const { ReceitaForm } = await import('./receita-form');
const { marcarDeclaracao, MSG_DECLARACAO_MUDOU, Preparar, seguirDeclaracao } = await import('./preparar');

const suplemento = (composicao: { nome: string; quantidade: number; unidade: string }[]) =>
  ({ tipo: 'suplemento', categoria: 'nutriente', composicao, forma: 'Cápsula', via: 'oral', posologia: '1 ao dia', manipulado: false }) as unknown as ConteudoReceita['itens'][number];
const VITD = { nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' };

function montar(itens: ConteudoReceita['itens'], erros: Record<string, string> = {}, extra: Record<string, unknown> = {}): string {
  estado.atual = { erros, ...extra };
  const conteudo = { versao: 1, tipo: 'receita', itens, orientacoes: '' } as ConteudoReceita;
  return renderToStaticMarkup(createElement(ReceitaForm, { patientId: 'p', docId: 'd', conteudo, justificativa: '', habilitada: false }));
}
/** A tag de abertura do controle com o id pedido. */
const tag = (html: string, id: string) => html.match(new RegExp(`<(?:input|select|textarea|fieldset)[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

describe('editor da receita: erros visíveis e ligados ao campo (revisão da T6)', () => {
  // Plano 22 (T9): os casos de cada item (composição, componentes, selects) foram para campos-do-item.test.ts
  it('Plano 22 (T9, R22-10): um CamposDoItem por item (o seletor do tipo de cada um) e "Adicionar item"', () => {
    const html = montar([suplemento([VITD]), suplemento([VITD])]);
    expect(html.match(/<select[^>]*\bid="itens-\d+-tipo"/g)).toHaveLength(2);
    expect(html).toContain('<legend class="px-1 font-semibold">Item 2: Suplemento alimentar</legend>');
    expect(html).toContain('>Adicionar item</button>');
  });

  it('orientações e justificativa: aria-invalid e aria-describedby apontando para o erro (RNF-10); a ajuda da marcação ligada às orientações', () => {
    const html = montar([suplemento([VITD])], { orientacoes: 'Use no máximo 2000 caracteres.', justificativa: 'Escreva a justificativa de uso (fica no prontuário, não vai na receita).' });
    expect(tag(html, 'orientacoes')).toContain('aria-invalid="true"');
    expect(tag(html, 'orientacoes')).toContain('aria-describedby="orientacoes-marcacao orientacoes-erro"');
    expect(html).toContain('<p id="orientacoes-erro" role="alert"');
    expect(tag(html, 'justificativa')).toContain('aria-describedby="justificativa-dica justificativa-erro"');
    expect(html).toContain('<p id="justificativa-erro" role="alert"');
  });

  it('Plano 22 (T9, RN-395): "Orientações gerais (opcional)" com "Negrito", "Lista", a ajuda da marcação e "Prévia"', () => {
    const html = montar([suplemento([VITD])]);
    expect(html).toContain('>Orientações gerais (opcional)</label>');
    for (const b of ['Negrito', 'Lista', 'Prévia']) expect(html, b).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>${b}</button>`));
    expect(html).toContain('Escreva ** antes e depois do trecho para negrito; comece a linha com um hífen para fazer lista.');
  });

  it('Plano 22 (T9, EP-D56): a declaração mostrada é a do conteúdo da tela — com a fórmula, a frase do art. 9º, II', () => {
    const formula = { tipo: 'formula_fitoterapica', compostos: [], formaFarmaceutica: 'Cápsula', via: 'oral', posologia: '1', duracao: '' } as unknown as ConteudoReceita['itens'][number];
    expect(montar([suplemento([VITD])])).toContain(`<label for="declaracao">${DECLARACAO_RECEITA}</label>`);
    expect(montar([suplemento([VITD]), formula])).toContain(`<label for="declaracao">${DECLARACAO_RECEITA.slice(0, -1)}${FRASE_FORMULA_FITOTERAPICA}.</label>`);
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

describe('revisão da P22-09: a confirmação da declaração vale só para o texto que estava na tela (EP-D56)', () => {
  const formula = { tipo: 'formula_fitoterapica', compostos: [], formaFarmaceutica: 'Cápsula', via: 'oral', posologia: '1', duracao: '' } as unknown as ConteudoReceita['itens'][number];
  const declDe = (itens: ConteudoReceita['itens']) => declaracaoDoDocumento({ versao: 1, tipo: 'receita', itens, orientacoes: '' } as ConteudoReceita);
  const semFormula = declDe([suplemento([VITD])]);
  const comFormula = declDe([suplemento([VITD]), formula]);

  it('marcar, adicionar a fórmula: a caixa volta desmarcada e o aviso aparece; marcar de novo tira o aviso', () => {
    expect(comFormula).not.toBe(semFormula); // controle: a fórmula muda mesmo o texto
    const marcada = marcarDeclaracao({ vista: semFormula, marcada: false, mudou: false }, true);
    expect(seguirDeclaracao(marcada, semFormula)).toBe(marcada); // controle: sem mudança no texto, a caixa continua marcada
    const depois = seguirDeclaracao(marcada, comFormula);
    expect(depois).toEqual({ vista: comFormula, marcada: false, mudou: true });
    expect(marcarDeclaracao(depois, true)).toEqual({ vista: comFormula, marcada: true, mudou: false });
  });

  it('tirar a fórmula depois de confirmar: também desmarca; voltar ao texto de antes não remarca sozinha', () => {
    const confirmada = marcarDeclaracao({ vista: comFormula, marcada: false, mudou: false }, true);
    const semEla = seguirDeclaracao(confirmada, semFormula);
    expect(semEla).toEqual({ vista: semFormula, marcada: false, mudou: true });
    expect(seguirDeclaracao(semEla, comFormula)).toEqual({ vista: comFormula, marcada: false, mudou: true });
  });

  it('sem a caixa marcada, a troca do texto não mostra o aviso (não havia o que confirmar de novo)', () => {
    expect(seguirDeclaracao({ vista: semFormula, marcada: false, mudou: false }, comFormula)).toEqual({ vista: comFormula, marcada: false, mudou: false });
  });

  it('a região role="status" do aviso existe desde a montagem (vazia), para o leitor de tela ouvir a troca', () => {
    const html = montar([suplemento([VITD])]);
    expect(html).toContain('<p id="declaracao-mudou" role="status" class="text-sm"></p>');
    expect(html).not.toContain(MSG_DECLARACAO_MUDOU);
    expect(tag(html, 'declaracao')).not.toContain('checked');
    expect(tag(html, 'declaracao')).not.toContain('declaracao-mudou'); // só aponta para o aviso quando ele aparece
    const mudou = renderToStaticMarkup(createElement(Preparar, { declaracao: comFormula, marcada: false, aoMarcar: () => {}, aviso: null, pendente: false, mudou: true }));
    expect(mudou).toContain(`<p id="declaracao-mudou" role="status" class="text-sm">${MSG_DECLARACAO_MUDOU}</p>`);
    expect(tag(mudou, 'declaracao')).toContain('aria-describedby="declaracao-mudou"');
    expect(tag(mudou, 'declaracao')).not.toContain('checked');
  });
});
