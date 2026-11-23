import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DECLARACAO_SOLICITACAO, MSG_SOLICITACAO, type ConteudoSolicitacao } from '@/modules/documentos/solicitacao';

// Plano 22 (T8, US-377, §6.2, §7): só a estrutura do editor da solicitação (sem DOM; o useActionState devolve o estado
// pedido e as ações não rodam). Os diálogos, o foco e o axe ficam no e2e/solicitacao-exames.spec.ts (EP-D54).
const estado = vi.hoisted(() => ({ atual: {} as Record<string, unknown> }));
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useActionState: () => [estado.atual, () => {}, false] }));
vi.mock('../actions', () => ({ salvarSolicitacaoAction: vi.fn(), prepararSolicitacaoAction: vi.fn() }));
const { SolicitacaoForm } = await import('./solicitacao-form');
const { SolicitacaoVisao } = await import('./solicitacao-visao');

const CONTEUDO: ConteudoSolicitacao = {
  versao: 1, tipo: 'solicitacao_exames', exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'Glicemia de jejum' }],
  indicacaoClinica: null, orientacoes: '', orientacoesFormato: 'marcacao',
};
const CATALOGO = [{ nome: 'Hemograma completo', unidade: null, sinonimos: [], componentes: ['Hemoglobina', 'Hematócrito'] }];

function montar(o: { erros?: Record<string, string>; conteudo?: ConteudoSolicitacao; motivo?: string | null; extra?: Record<string, unknown> } = {}): string {
  estado.atual = { erros: o.erros, ...o.extra };
  return renderToStaticMarkup(
    createElement(SolicitacaoForm, { patientId: 'p', docId: 'd', conteudo: o.conteudo ?? CONTEUDO, catalogo: CATALOGO, modelos: [], declaracao: DECLARACAO_SOLICITACAO, motivo: o.motivo ?? null }),
  );
}
const tag = (html: string, id: string) => html.match(new RegExp(`<(?:input|select|textarea|fieldset)[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

describe('editor da solicitação de exames (US-377)', () => {
  it('as ajudas fixas da spec: fora do catálogo (Lei 8.234), indicação clínica (sem afirmar doença) e orientações', () => {
    const html = montar();
    expect(html).toContain(MSG_SOLICITACAO.ajudaForaDoCatalogo);
    expect(html).toContain('Só exames laboratoriais (Lei nº 8.234/1991, art. 4º, VIII).');
    expect(html).toContain(`>${MSG_SOLICITACAO.indicacao}</label>`);
    expect(html).toContain('Descreva a finalidade nutricional; não afirme doença.');
    expect(html).toContain(`>${MSG_SOLICITACAO.orientacoes}</label>`);
    expect(html).toContain('Preparo, jejum, horário. Aparecem no pedido.');
    // as ajudas ligadas aos campos (aria-describedby), sempre — não só com erro
    expect(tag(html, 'indicacaoClinica')).toContain('aria-describedby="indicacaoClinica-dica"');
    expect(tag(html, 'orientacoes')).toContain('aria-describedby="orientacoes-dica orientacoes-marcacao"'); // Plano 22 (T9): e a ajuda da marcação
    expect(tag(html, 'exame-livre')).toContain('aria-describedby="exame-livre-dica"');
  });

  it('o aviso dos planos de saúde num Aviso de aviso (fora de região viva) e a declaração da solicitação no preparo', () => {
    const html = montar();
    expect(html).toMatch(/<p(?![^>]*role=)[^>]*>Planos de saúde podem recusar pedido de exame feito por nutricionista\.<\/p>/);
    expect(html).toContain(`<label for="declaracao">${DECLARACAO_SOLICITACAO}</label>`);
    expect(html).toContain('Preparar para assinatura');
    expect(html).toContain('Salvar rascunho');
  });

  it('nenhum campo de laboratório (EP-D2, C-374): nem rótulo, nem nome, nem id', () => {
    const html = montar();
    // a única menção a laboratório é a declaração ("…não indica laboratório."), nunca um campo
    const rotulos = [...html.matchAll(/<label[^>]*>([^<]*)<\/label>/g)].map((m) => m[1]).filter((t) => t !== DECLARACAO_SOLICITACAO);
    expect(rotulos.length).toBeGreaterThanOrEqual(3);
    expect(rotulos.filter((t) => /laborat/i.test(t))).toEqual([]);
    expect(html).not.toMatch(/(?:name|id)="[^"]*laborat/i);
    const fonte = readFileSync(path.resolve('src/app/painel/pacientes/[id]/documentos/[docId]/solicitacao-form.tsx'), 'utf8');
    expect(fonte).not.toMatch(/laboratorio/i);
    expect(fonte).not.toContain('dangerouslySetInnerHTML');
  });

  it('os botões da US-377 e "Remover" por exame, com o nome do exame; o painel aparece como um item, com o nome dele', () => {
    const html = montar();
    for (const b of [MSG_SOLICITACAO.adicionarDoCatalogo, MSG_SOLICITACAO.carregarModelo, MSG_SOLICITACAO.removerTodos]) expect(html).toContain(`>${b}</button>`);
    expect(html).toContain(`>${MSG_SOLICITACAO.adicionarForaDoCatalogo}</label>`);
    expect(html).toMatch(/aria-label="Remover Hemograma completo"/);
    expect(html).toMatch(/aria-label="Remover Glicemia de jejum"/);
    expect(html).toContain('Painel (2 exames)');
    // o JSON da tela vai num campo só (como a receita e o parecer)
    expect(html).toContain('name="conteudo"');
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/); // a região de "Rascunho salvo." sempre montada
  });

  it('sem exames: sem "Remover todos" (nada a remover); com o erro da lista, o aviso ligado ao grupo', () => {
    const vazio = montar({ conteudo: { ...CONTEUDO, exames: [] }, erros: { exames: 'Inclua ao menos um exame.' } });
    expect(vazio).not.toContain(`>${MSG_SOLICITACAO.removerTodos}</button>`);
    // junto da lista, sem região viva (quem anuncia é o aviso perto do botão)
    expect(vazio).toMatch(/<p id="exames-erro" class="[^"]*">Inclua ao menos um exame\.<\/p>/);
    expect(tag(vazio, 'exames')).toContain('aria-describedby="exames-erro"');
  });

  // revisão da P22-08 (Plano 13: erro longe do botão): a lista fica no topo e pode passar de 40 linhas; o erro dela se
  // repete, com o mesmo texto, no aviso perto do botão que a nutricionista usou
  const bloco = (html: string, inicio: string, fim: string) => html.slice(html.indexOf(inicio), html.indexOf(fim, html.indexOf(inicio)));
  const ALERTA = (t: string) => new RegExp(`<div role="alert"[^>]*>(?:(?!</div>).)*<p>${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`);

  it('"Preparar" com o erro da lista (vazia ou mais de 40): o mesmo texto no aviso dentro do bloco do Preparar', () => {
    for (const texto of ['Inclua ao menos um exame.', MSG_SOLICITACAO.erros.max]) {
      const html = montar({ conteudo: { ...CONTEUDO, exames: [] }, erros: { exames: texto }, extra: { intencao: 'preparar' } });
      const preparar = bloco(html, 'data-guia="preparar-documento"', 'Preparar para assinatura');
      expect(preparar).toMatch(ALERTA(texto));
      // e só ali anunciado (o de perto do "Salvar rascunho" não aparece)
      expect(html.match(/role="alert"/g)).toHaveLength(1);
    }
  });

  it('"Salvar rascunho" com o erro da lista ou de uma linha: o aviso fica logo antes do botão, depois das orientações', () => {
    const html = montar({ erros: { exames: MSG_SOLICITACAO.erros.max, 'exames.1.nome': MSG_SOLICITACAO.erros.repetido }, extra: { intencao: 'salvar' } });
    const perto = bloco(html, 'id="orientacoes"', '>Salvar rascunho<');
    expect(perto).toMatch(ALERTA(MSG_SOLICITACAO.erros.max));
    expect(perto).toMatch(ALERTA(MSG_SOLICITACAO.erros.repetido));
    expect(bloco(html, 'data-guia="preparar-documento"', 'Preparar para assinatura')).not.toContain('role="alert"');
    // controle positivo: sem erro, nenhum aviso
    expect(montar({ extra: { intencao: 'salvar' } })).not.toContain('role="alert"');
  });

  it('erros de campo ligados ao controle (aria-invalid + aria-describedby com a ajuda e o erro); o erro de uma linha junto dela', () => {
    const html = montar({ erros: { indicacaoClinica: MSG_SOLICITACAO.erros.indicacao, orientacoes: MSG_SOLICITACAO.erros.orientacoes, 'exames.1.nome': MSG_SOLICITACAO.erros.repetido } });
    expect(tag(html, 'indicacaoClinica')).toContain('aria-invalid="true"');
    expect(tag(html, 'indicacaoClinica')).toContain('aria-describedby="indicacaoClinica-dica indicacaoClinica-erro"');
    expect(tag(html, 'orientacoes')).toContain('aria-describedby="orientacoes-dica orientacoes-marcacao orientacoes-erro"');
    expect(html).toMatch(/<p id="exames-1-nome-erro" class="[^"]*">Este exame já está na lista\.<\/p>/);
  });

  it('Plano 22 (T9, RN-395): as orientações com "Negrito", "Lista", a ajuda da marcação e "Prévia" (a prévia monta componentes, nunca HTML)', () => {
    const html = montar({ conteudo: { ...CONTEUDO, orientacoes: '**Jejum** <script>x</script>' } });
    for (const b of ['Negrito', 'Lista', 'Prévia']) expect(html, b).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>${b}</button>`));
    expect(html).toContain('<p id="orientacoes-marcacao" class="text-sm text-suave">Escreva ** antes e depois do trecho para negrito; comece a linha com um hífen para fazer lista.</p>');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="orientacoes-previa"[^>]*>Prévia<\/button>/);
    // o texto do campo sai escapado (o único <script> da página é o do React para a action do formulário)
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('numa retificação, o motivo (Q13-1 ★); na versão 1, sem o campo', () => {
    expect(montar({ motivo: '' })).toContain('Motivo da retificação');
    expect(montar()).not.toContain('Motivo da retificação');
  });
});

describe('visão da solicitação (somente leitura)', () => {
  it('cartões "Exames solicitados", "Indicação clínica" e "Orientações"; os dois últimos só quando preenchidos; orientações pela marcação', () => {
    const com = renderToStaticMarkup(createElement(SolicitacaoVisao, { conteudo: { ...CONTEUDO, indicacaoClinica: 'Acompanhar a dieta.', orientacoes: 'Jejum de 8 h. <b>x</b> & **y**' } }));
    expect(com).toContain('Exames solicitados');
    expect(com).toContain('<li>Hemograma completo</li>');
    expect(com).toContain('Indicação clínica');
    expect(com).toContain('Acompanhar a dieta.');
    expect(com).toContain('Orientações');
    // Plano 22 (T9): orientacoesFormato "marcacao" → negrito em componente; "<b>" e "&" continuam texto (nunca HTML, RN-395)
    expect(com).toContain('Jejum de 8 h. &lt;b&gt;x&lt;/b&gt; &amp; <strong>y</strong>');
    const sem = renderToStaticMarkup(createElement(SolicitacaoVisao, { conteudo: CONTEUDO }));
    expect(sem).not.toContain('Indicação clínica');
    expect(sem).not.toContain('Orientações');
    expect(sem).not.toMatch(/[Ll]aboratório/);
  });
});
