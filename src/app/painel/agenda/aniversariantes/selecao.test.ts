import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TabelaDosAniversariantes, type LinhaDoAniversario } from './selecao';

// Revisão final do PR 3 do Plano 23 (M-1, §7 "Aniversariantes: tabela com `caption`"): a tabela leva o título da lista.
const linha: LinhaDoAniversario = {
  patientId: '00000000-0000-4000-8000-000000000001',
  nome: 'Ana Souza',
  dia: '20/11',
  faz: 30,
  situacao: 'Pode receber',
  pode: true,
  deHoje: false,
  autorizado: true,
  podeRetirar: true,
  menorHoje: false,
  whatsapp: null,
  registrar: async () => ({}),
  retirar: async () => {},
};

describe('TabelaDosAniversariantes', () => {
  it('a tabela tem o caption (sr-only) com o título da lista, "Aniversariantes de {mês}"', () => {
    const h = renderToStaticMarkup(createElement(TabelaDosAniversariantes, { titulo: 'Aniversariantes de novembro', linhas: [linha], corrente: true, nutri: 'Debby', saemAgora: false, enviar: async () => ({}) }));
    expect(h).toMatch(/<table[^>]*><caption class="sr-only">Aniversariantes de novembro<\/caption><thead>/);
  });
});
