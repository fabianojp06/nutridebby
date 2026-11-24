import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { lerLinhasComErros } from '@/modules/pacientes/exames';
import type { FaixaDoConsultorio } from '@/db/schema/exames-catalogo';
import type { ItemDoCatalogo } from '@/app/painel/exames/escolher-do-catalogo';
import { linhaDoGravado, linhaParaEnvio, LinhasDoExame, linhaVazia, type LinhaDoForm } from './linhas-do-exame';
import { ConteudoDaReferencia } from './ver-referencia';

/**
 * Plano 22 (T4, spec §7 "Linhas do lançamento"): só a estrutura (sem DOM; o Vitest roda em `environment: 'node'`). O
 * comportamento no navegador (diálogos, foco, "Usar a a b" preenchendo os campos) fica no Playwright (EP-D54).
 */
const L = MSG_EXAMES.lancamento;
const linha = (o: Partial<LinhaDoForm>, chave = 0): LinhaDoForm => ({ ...linhaVazia(chave), ...o });
/** `chavesDoEnvio`: por padrão, as linhas de agora (os erros vieram deste mesmo desenho). */
const montar = (linhas: LinhaDoForm[], erros: Record<string, string> = {}, chavesDoEnvio: number[] = linhas.map((l) => l.chave), catalogo: ItemDoCatalogo[] = []) =>
  renderToStaticMarkup(createElement(LinhasDoExame, { idBase: 'novo', linhas, aoMudar: () => {}, erros, chavesDoEnvio, catalogo, modelos: [] }));
/** A tag de abertura do controle com o id pedido. */
const tag = (html: string, id: string) => html.match(new RegExp(`<(?:input|button)[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
const descritoPor = (html: string, id: string) => (tag(html, id).match(/aria-describedby="([^"]*)"/)?.[1] ?? '').split(' ').filter(Boolean);

describe('LinhasDoExame — estrutura (sem DOM)', () => {
  it('cada linha é um grupo com aria-label "Linha {n}: {marcador}" e rótulos numerados por campo', () => {
    const html = montar([linha({ nome: 'Glicemia de jejum', valor: '105' }, 0), linha({ nome: 'Ferritina' }, 1)]);
    expect(html).toContain(`role="group" aria-label="${L.grupoLinha(1, 'Glicemia de jejum')}"`);
    expect(html).toContain(`role="group" aria-label="${L.grupoLinha(2, 'Ferritina')}"`);
    for (const n of [1, 2]) {
      for (const rotulo of [L.marcador(n), L.valor(n), L.unidade(n), L.referencia(n), L.faixaDe(n), L.faixaAte(n)]) {
        expect(html, rotulo).toMatch(new RegExp(`<label for="[^"]+"[^>]*>${rotulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</label>`));
      }
    }
    expect(html).toContain(`aria-label="Remover a linha 1"`);
  });

  it('o aviso fixo vem uma vez, antes das linhas, com o id citado no aria-describedby do valor; a ajuda da faixa no "de" e no "até"', () => {
    const html = montar([linha({ nome: 'Glicemia de jejum', valor: '105', refMin: '70', refMax: '99' }, 0), linha({ nome: 'Ferritina' }, 1)]);
    const aviso = MSG_EXAMES.classificacao.aviso;
    expect(html.split(aviso)).toHaveLength(2);
    const idAviso = html.match(new RegExp(`<p id="([^"]+)"[^>]*>${aviso.replace(/\./g, '\\.')}</p>`))?.[1];
    expect(idAviso).toBeTruthy();
    expect(html.indexOf(aviso)).toBeLessThan(html.indexOf('role="group"'));
    expect(descritoPor(html, 'novo-valor-0')).toContain(idAviso);
    expect(descritoPor(html, 'novo-valor-1')).toContain(idAviso);
    const idAjuda = html.match(new RegExp(`<p id="([^"]+)"[^>]*>${L.ajudaFaixa}</p>`))?.[1];
    expect(idAjuda).toBeTruthy();
    expect(descritoPor(html, 'novo-refMin-0')).toContain(idAjuda);
    expect(descritoPor(html, 'novo-refMax-0')).toContain(idAjuda);
  });

  it('classificação ao vivo: texto ligado ao valor por aria-describedby, nunca região viva', () => {
    const html = montar([linha({ nome: 'Glicemia de jejum', valor: '105', refMin: '70', refMax: '99' })]);
    const classe = html.match(/<p id="(novo-classe-0)"([^>]*)>([^<]*)<\/p>/);
    expect(classe?.[3]).toBe(MSG_EXAMES.classificacao.acima);
    expect(classe?.[2]).not.toMatch(/role=|aria-live/);
    expect(descritoPor(html, 'novo-valor-0')).toContain('novo-classe-0');
    expect(montar([linha({ nome: 'G', valor: '70', refMin: '70', refMax: '99' })])).toContain(MSG_EXAMES.classificacao.dentro);
    expect(montar([linha({ nome: 'G', valor: '', refMin: '70', refMax: '99' })])).not.toMatch(/Abaixo da referência|Dentro da referência|Acima da referência/);
  });

  it('"Usar 70 a 99 (linha 1)" só com referência de padrão único e a faixa vazia', () => {
    const com = montar([linha({ nome: 'Glicemia de jejum', referencia: '70 a 99 mg/dL' })]);
    expect(com).toContain(`aria-label="${L.usarFaixaRotulo('70', '99', 1)}"`);
    expect(com).toContain(`>${L.usarFaixa('70', '99')}</button>`);
    expect(montar([linha({ nome: 'Colesterol', referencia: 'Desejável < 200; Limítrofe 200 a 239' })])).not.toContain('Usar ');
    expect(montar([linha({ nome: 'G', referencia: '70 a 99', refMin: '70', refMax: '99' })])).not.toContain('Usar ');
    expect(montar([linha({ nome: 'G', referencia: '4,5 - 6,0' })])).toContain(`aria-label="${L.usarFaixaRotulo('4,5', '6', 1)}"`);
  });

  it('faixa e texto diferentes: o aviso sem bloquear, ligado aos campos da faixa', () => {
    const html = montar([linha({ nome: 'G', valor: '100', referencia: '70 a 99', refMin: '70', refMax: '110' })]);
    expect(html).toContain(L.faixaDiverge);
    expect(descritoPor(html, 'novo-refMin-0')).toContain('novo-diverge-0');
  });

  it('erros da linha: role="alert" junto do campo, com aria-invalid e aria-describedby', () => {
    const html = montar([linha({ nome: 'G', valor: '1', refMin: '120', refMax: '99' })], { 'valores.0.refMin': MSG_EXAMES.lancamentoErros.faixaInvertida });
    expect(html).toMatch(new RegExp(`<p id="novo-refMin-0-erro" role="alert"[^>]*>${MSG_EXAMES.lancamentoErros.faixaInvertida}</p>`));
    expect(tag(html, 'novo-refMin-0')).toContain('aria-invalid="true"');
    expect(descritoPor(html, 'novo-refMin-0')).toContain('novo-refMin-0-erro');
  });

  it('botões da barra: "Adicionar do catálogo", "Carregar modelo de solicitação" (com modelos), "Remover todos" e "Adicionar linha"', () => {
    const html = montar([linha({ nome: 'G' })]);
    for (const b of [L.adicionarDoCatalogo, L.carregarModelo, L.removerTodos, L.adicionarLinha]) expect(html, b).toContain(`>${b}</button>`);
    // nenhum diálogo montado com tudo fechado (o Dialogo só existe aberto, fora do <form> da tela)
    expect(html).not.toContain('<dialog');
  });

  it('a linha que veio da IA: nome, valor e unidade só de leitura, com "IA · conferido em {data}" e o porquê no nome acessível', () => {
    const html = montar([linha({ nome: 'Glicose de jejum', valor: '92', unidade: 'mg/dL', origem: 0, daIa: true, iaConferidoEm: '02/09/2026' })]);
    for (const c of ['nome', 'valor', 'unidade']) {
      expect(tag(html, `novo-${c}-0`), c).toContain('readOnly=""');
      expect(descritoPor(html, `novo-${c}-0`), c).toEqual(expect.arrayContaining(['novo-ia-0', 'novo-ia-fixa-0']));
    }
    expect(tag(html, 'novo-refMin-0')).not.toContain('readOnly');
    expect(descritoPor(html, 'novo-refMin-0')).not.toContain('novo-ia-0');
    expect(html).toContain(`<p id="novo-ia-0" class="text-suave">IA · conferido em 02/09/2026</p>`);
    expect(html).toContain(`<p id="novo-ia-fixa-0" class="text-suave">${L.iaFixa}</p>`);
    // sem a marca da tarefa (a data não veio): o texto sem data; linha que não é da IA, nada
    expect(montar([linha({ nome: 'G', valor: '92', origem: 0, daIa: true })])).toContain('>IA · conferido</p>');
    expect(montar([linha({ nome: 'G', valor: '92' })])).not.toContain('IA · conferido');
  });

  it('erros do servidor pela posição no envio: a linha removida leva o erro junto; a acrescentada depois não herda nenhum', () => {
    const erro = MSG_EXAMES.lancamentoErros.faixaInvalida;
    // no envio: chaves 3, 5 e 7 (o erro é da 5, índice 1); a 3 saiu depois e a 9 entrou
    const linhas = [linha({ nome: 'Ferritina', refMin: 'x' }, 5), linha({ nome: 'Vitamina D' }, 7), linha({ nome: 'Ferro' }, 9)];
    const html = montar(linhas, { 'valores.1.refMin': erro }, [3, 5, 7]);
    expect(tag(html, 'novo-refMin-5')).toContain('aria-invalid="true"');
    expect(html).toContain(`<p id="novo-refMin-5-erro" role="alert"`);
    for (const c of [7, 9]) expect(tag(html, `novo-refMin-${c}`), String(c)).not.toContain('aria-invalid');
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    // o erro da linha que saiu (índice 0, chave 3) não aparece em ninguém
    const semDona = montar(linhas, { 'valores.0.refMin': erro }, [3, 5, 7]);
    expect(semDona).not.toContain('aria-invalid');
    expect(semDona).not.toContain(erro);
  });

  it('o id de "Adicionar linha" (destino do foco ao remover a última linha e ao "Remover todos")', () => {
    expect(montar([linha({ nome: 'G' })])).toMatch(/<button [^>]*id="novo-adicionar-linha"[^>]*>Adicionar linha<\/button>/);
  });
});

describe('linhaDoGravado → linhaParaEnvio → lerLinhasComErros (revisão da T4: ida e volta sem mexer)', () => {
  it('valor e faixa abaixo de 1e-6 voltam sem notação exponencial e com o mesmo número', () => {
    const gravados = [
      { nome: 'Traço', valor: 1e-7, unidade: 'mg/L', referencia: null, refMin: 1e-7, refMax: 5e-7 },
      { nome: 'Outro', valor: 0.0000005, unidade: null, referencia: '< 1', refMin: 0, refMax: 2.5e-8 },
      { nome: 'Glicemia', valor: 95.5, unidade: 'mg/dL', referencia: '70 a 99', refMin: 70, refMax: 99 },
    ];
    const linhas = gravados.map((v, i) => linhaDoGravado(v, i));
    expect(linhas[0]).toMatchObject({ valor: '0,0000001', refMin: '0,0000001', refMax: '0,0000005' });
    expect(linhas.map((l) => [l.valor, l.refMin, l.refMax].join(' ')).join(' ')).not.toMatch(/e/i);
    const lidas = lerLinhasComErros(linhas.map(linhaParaEnvio));
    expect('erros' in lidas ? lidas.erros : null).toBeNull();
    const numeros = (v: { valor: number; refMin?: number; refMax?: number }) => [v.valor, v.refMin, v.refMax];
    expect('linhas' in lidas && lidas.linhas.map((l) => numeros(l.valor))).toEqual(gravados.map(numeros));
  });

  it('a linha da IA leva a data da conferência; a que não é da IA, nunca', () => {
    expect(linhaDoGravado({ nome: 'G', valor: 92, unidade: null, referencia: null, iaTarefaId: 't' }, 0, '02/09/2026')).toMatchObject({ daIa: true, iaConferidoEm: '02/09/2026' });
    expect(linhaDoGravado({ nome: 'G', valor: 92, unidade: null, referencia: null }, 0, '02/09/2026')).toMatchObject({ daIa: false, iaConferidoEm: null });
  });
});

const R = MSG_EXAMES.ref;
const DEFICIENCIA: FaixaDoConsultorio = { sexo: null, idadeMin: 18, idadeMax: 120, aPartirDe: null, abaixoDe: 20, categoria: 'Deficiência', fonte: 'Diretriz X, 2024', atualizadaEm: '2026-01-10' };
const conteudo = (p: Parameters<typeof ConteudoDaReferencia>[0]) => renderToStaticMarkup(createElement(ConteudoDaReferencia, p));

describe('"Ver referência" (T5a, RN-382, R22-05)', () => {
  it('cada linha com marcador tem o botão "Ver referência" com o nome acessível "Referência de {marcador}"; a linha sem marcador, não', async () => {
    const html = montar([linha({ nome: 'Vitamina D', valor: '15' }, 0), linha({ nome: 'Ferritina' }, 1), linha({}, 2)]);
    expect(html).toContain(`aria-label="${R.rotulo('Vitamina D')}"`);
    expect(html).toContain(`aria-label="${R.rotulo('Ferritina')}"`);
    expect(html.match(/>Ver referência<\/button>/g)).toHaveLength(2);
    // o diálogo só existe aberto (fora do <form> da tela)
    expect(html).not.toContain('<dialog');
  });

  it('o conteúdo: referência e faixa do laudo, as faixas do consultório com público, idade, limites, categoria, fonte e data', () => {
    const html = conteudo({ referencia: '30 a 100', refMin: 30, refMax: 100, faixas: [DEFICIENCIA], unidadeDoCatalogo: 'ng/mL' });
    expect(html).toContain(R.doLaudo('30 a 100'));
    expect(html).toContain(R.faixaDoLaudo('30 a 100'));
    expect(html).toContain(R.faixasDoConsultorio);
    expect(html).toContain(R.linhaFaixa('Todos', '18 a 120 anos', 'abaixo de 20 ng/mL', 'Deficiência'));
    expect(html).toContain(R.fonte('Diretriz X, 2024', '10/01/2026'));
    expect(html).not.toContain(R.semReferencia);
  });

  it('sem catálogo (ou sem faixas do consultório), o diálogo diz "Sem referência."; sem texto nem faixa do laudo, "—"', () => {
    const html = conteudo({ referencia: null, faixas: [], unidadeDoCatalogo: null });
    expect(html).toContain(R.semReferencia);
    expect(html).toContain(R.doLaudo('—'));
    expect(html).toContain(R.faixaDoLaudo('—'));
    expect(html).not.toContain(R.faixasDoConsultorio);
  });

  it('no formulário (lançar e editar): só a faixa digitada e as faixas do consultório, sem a "Referência do laudo" (o campo está à vista)', () => {
    const html = conteudo({ refMin: 70, faixas: [{ ...DEFICIENCIA, sexo: 'F', idadeMin: null, idadeMax: null, aPartirDe: 20, abaixoDe: 30, categoria: 'Insuficiente' }], unidadeDoCatalogo: 'ng/mL' });
    expect(html).not.toContain('Referência do laudo');
    expect(html).toContain(R.faixaDoLaudo('a partir de 70'));
    expect(html).toContain(R.linhaFaixa('Feminino', R.qualquerIdade, 'a partir de 20 e abaixo de 30 ng/mL', 'Insuficiente'));
  });
});
