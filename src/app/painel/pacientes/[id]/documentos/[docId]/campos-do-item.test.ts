import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MSG_PRESCRICAO, TIPOS_ITEM } from '@/modules/documentos/prescricao';
import { CamposDoItem, chavesDoItem, doItem, novoItem, type ItemNoFormulario } from './campos-do-item';

// Plano 22 (T9, R22-10, US-378): os campos de um item da receita, extraídos de receita-form.tsx (a T10b reaproveita no item
// salvo). Sem DOM: só a estrutura. Os casos de item que estavam em receita-form.test.ts (revisão da T6) vieram para cá.
const suplemento = (composicao: { nome: string; quantidade: string; unidade: string }[]): ItemNoFormulario =>
  ({ tipo: 'suplemento', categoria: 'nutriente', composicao, forma: 'Cápsula', via: 'oral', posologia: '1 ao dia', manipulado: false }) as ItemNoFormulario;
const VITD = { nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' };

function montar(item: ItemNoFormulario, o: { erros?: Record<string, string>; habilitada?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(CamposDoItem, { item, indice: 0, habilitada: o.habilitada ?? false, aoMudar: () => {}, erros: o.erros ?? {} }));
}
/** A tag de abertura do controle com o id pedido. */
const tag = (html: string, id: string) => html.match(new RegExp(`<(?:input|select|textarea|fieldset)[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

describe('CamposDoItem: o seletor do tipo (US-378, §6.2)', () => {
  it('os cinco tipos; a ajuda sob o seletor ligada por aria-describedby, com o texto da spec', () => {
    const html = montar(suplemento([VITD]), { habilitada: true });
    for (const r of Object.values(TIPOS_ITEM)) expect(html).toContain(`>${r}</option>`);
    expect(Object.keys(TIPOS_ITEM)).toHaveLength(5);
    expect(html).toContain('<label for="itens-0-tipo"');
    expect(tag(html, 'itens-0-tipo')).toMatch(/aria-describedby="itens-0-tipo-ajuda"/);
    expect(html).toContain(`<p id="itens-0-tipo-ajuda" class="text-sm text-suave">${MSG_PRESCRICAO.ajudaTipo.replace(/'/g, '&#x27;')}</p>`);
    expect(html).not.toMatch(/<option[^>]*disabled/); // com a habilitação, nenhum tipo desabilitado
  });

  it('sem a habilitação: o fitoterápico e a fórmula aparecem desabilitados, com a mensagem semHabilitacao ligada ao seletor', () => {
    const html = montar(suplemento([VITD]));
    expect(html).toContain(`<option value="fitoterapico" disabled="">${TIPOS_ITEM.fitoterapico}</option>`);
    expect(html).toContain(`<option value="formula_fitoterapica" disabled="">${TIPOS_ITEM.formula_fitoterapica}</option>`);
    for (const t of ['suplemento', 'planta_cha', 'derivado_vegetal']) expect(html).toMatch(new RegExp(`<option value="${t}"(?: selected="")?>`));
    expect(tag(html, 'itens-0-tipo')).toContain('aria-describedby="itens-0-tipo-ajuda itens-0-tipo-sem-habilitacao"');
    expect(html).toContain(`<p id="itens-0-tipo-sem-habilitacao" class="text-sm text-suave">${MSG_PRESCRICAO.semHabilitacao.replace(/"/g, '&quot;')}</p>`);
  });

  it('o erro do tipo (habilitação retirada depois do salvar): aria-invalid e aria-describedby com o erro', () => {
    const html = montar({ ...novoItem('formula_fitoterapica') }, { erros: { 'itens.0.tipo': MSG_PRESCRICAO.semHabilitacao } });
    expect(tag(html, 'itens-0-tipo')).toContain('aria-invalid="true"');
    expect(tag(html, 'itens-0-tipo')).toContain('itens-0-tipo-erro');
    expect(html).toContain('<p id="itens-0-tipo-erro" role="alert"');
  });
});

describe('CamposDoItem: a fórmula magistral fitoterápica (US-378)', () => {
  it('nasce com 2 compostos; cada um com os seis campos da spec; "Acrescentar composto"; forma farmacêutica, via, posologia e duração', () => {
    const html = montar(novoItem('formula_fitoterapica'), { habilitada: true });
    expect(html).toContain('<legend class="font-medium">Compostos</legend>');
    for (const j of [0, 1]) {
      expect(html).toContain(`>Composto ${j + 1}</legend>`);
      for (const [campo, rotulo] of [['nomenclatura', 'Nomenclatura botânica'], ['parte', 'Parte usada'], ['extracao', 'Derivado ou extração'], ['padronizacao', 'Padronização (opcional)'], ['quantidade', 'Quantidade'], ['unidade', 'Unidade']]) {
        expect(html, `${j}.${campo}`).toContain(`<label for="itens-0-compostos-${j}-${campo}" class="block text-sm">${rotulo}</label>`);
      }
    }
    expect(html).not.toContain('Composto 3');
    expect(html).toContain('>Acrescentar composto</button>');
    expect(html).not.toContain('Remover composto'); // 2 é o mínimo
    for (const rotulo of ['Forma farmacêutica', 'Posologia', 'Duração (opcional)', 'Via']) expect(html, rotulo).toContain(`>${rotulo}</label>`);
  });

  it('com 3 compostos: "Remover composto N"; com 10, sem "Acrescentar composto"; o erro da lista ligado ao grupo', () => {
    const k = { nomenclatura: '', parte: '', extracao: '', padronizacao: '', quantidade: '', unidade: 'mg' };
    const tres = montar({ ...novoItem('formula_fitoterapica'), compostos: [k, k, k] } as ItemNoFormulario, { erros: { 'itens.0.compostos': MSG_PRESCRICAO.compostos } });
    expect(tres).toContain('Remover composto 3');
    expect(tag(tres, 'itens-0-compostos')).toContain('aria-describedby="itens-0-compostos-erro"');
    expect(tres).toContain(`<p id="itens-0-compostos-erro" role="alert" class="text-sm text-erro">${MSG_PRESCRICAO.compostos}</p>`);
    expect(montar({ ...novoItem('formula_fitoterapica'), compostos: Array(10).fill(k) } as ItemNoFormulario)).not.toContain('Acrescentar composto');
  });

  it('o erro de um composto (naoVegetal na nomenclatura) fica no campo, ligado por aria-describedby', () => {
    const html = montar(novoItem('formula_fitoterapica'), { erros: { 'itens.0.compostos.1.nomenclatura': MSG_PRESCRICAO.naoVegetal } });
    expect(tag(html, 'itens-0-compostos-1-nomenclatura')).toContain('aria-invalid="true"');
    expect(tag(html, 'itens-0-compostos-1-nomenclatura')).toContain('aria-describedby="itens-0-compostos-1-nomenclatura-erro"');
  });

  it('doItem: o item gravado vira o estado do formulário (quantidades com vírgula) e volta igual pelas chaves', () => {
    const it = doItem({ tipo: 'formula_fitoterapica', compostos: [{ nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', padronizacao: '', quantidade: 150.5, unidade: 'mg' }], formaFarmaceutica: 'Cápsula', via: 'oral', posologia: '1', duracao: '' });
    expect(it).toMatchObject({ tipo: 'formula_fitoterapica', compostos: [{ quantidade: '150,5' }] });
    expect(doItem({ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'X', quantidade: 0.5, unidade: 'mg' }], forma: 'C', via: 'oral', posologia: '1', duracao: '', manipulado: false })).toMatchObject({ composicao: [{ quantidade: '0,5' }] });
  });

  it('chavesDoItem: as chaves de erro que os campos do item mostram (a receita manda as que sobrarem ao aviso geral)', () => {
    const chaves = chavesDoItem(novoItem('formula_fitoterapica'), 'itens.2');
    for (const k of ['itens.2.tipo', 'itens.2.compostos', 'itens.2.compostos.0.nomenclatura', 'itens.2.compostos.1.unidade', 'itens.2.formaFarmaceutica', 'itens.2.via', 'itens.2.posologia', 'itens.2.duracao']) expect(chaves, k).toContain(k);
    expect(chaves).not.toContain('itens.2.desconhecido');
    expect(chavesDoItem(suplemento([VITD]), 'itens.0')).toEqual(expect.arrayContaining(['itens.0.categoria', 'itens.0.composicao', 'itens.0.composicao.0.nome', 'itens.0.forma', 'itens.0.via']));
  });
});

describe('CamposDoItem: o suplemento (revisão da T6, casos vindos de receita-form.test.ts)', () => {
  it('composição vazia: "Informe de 1 a 10 componentes." aparece na Composição, ligado ao grupo', () => {
    const html = montar(suplemento([]), { erros: { 'itens.0.composicao': 'Informe de 1 a 10 componentes.' } });
    expect(html).toMatch(/<p id="itens-0-composicao-erro" role="alert"[^>]*>Informe de 1 a 10 componentes\.<\/p>/);
    expect(tag(html, 'itens-0-composicao')).toContain('aria-describedby="itens-0-composicao-erro"');
  });

  it('"Remover componente" só aparece quando há mais de um componente', () => {
    expect(montar(suplemento([VITD]))).not.toContain('Remover componente');
    const dois = montar(suplemento([VITD, { nome: 'Vitamina K2', quantidade: '100', unidade: 'mcg' }]));
    expect(dois).toContain('Remover componente 1');
    expect(dois).toContain('Remover componente 2');
  });

  it('selects e componente: aria-invalid e aria-describedby apontando para o erro (RNF-10)', () => {
    const erros = {
      'itens.0.categoria': 'Escolha uma das opções.',
      'itens.0.via': 'Escolha uma das opções.',
      'itens.0.composicao.0.nome': 'Informe o nome.',
      'itens.0.composicao.0.quantidade': 'Informe uma quantidade maior que zero.',
      'itens.0.composicao.0.unidade': 'Escolha uma das opções.',
    };
    const html = montar(suplemento([VITD]), { erros });
    for (const k of Object.keys(erros)) {
      const id = k.replace(/\./g, '-');
      expect(tag(html, id), id).toContain('aria-invalid="true"');
      expect(tag(html, id), id).toContain(`aria-describedby="${id}-erro"`);
      expect(html, id).toContain(`<p id="${id}-erro" role="alert"`);
    }
  });

  it('categoria "Outro": a dica cita os dois tipos de fitoterápico (Minor 11 da revisão de normas, §6.2)', () => {
    const html = montar({ ...suplemento([VITD]), categoria: 'outro' });
    expect(html).toContain(MSG_PRESCRICAO.dicaOutro.replace(/"/g, '&quot;'));
  });
});
