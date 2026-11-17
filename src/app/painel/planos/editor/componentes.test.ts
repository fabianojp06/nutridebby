import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_MINHAS_REFEICOES } from '@/modules/plano-alimentar/biblioteca-constantes';
import type { PlanoDoCliente } from '@/modules/plano-alimentar/tipos';

// Revisão final do Plano 19 (itens 11–13): montagem no servidor (o Vitest roda sem DOM) dos diálogos e da seção
// "Nutrientes do paciente". As actions do servidor não entram no teste.
vi.mock('../refeicoes/actions', () => ({ carregarMinhaRefeicaoAction: vi.fn(), salvarComoMinhaRefeicaoAction: vi.fn() }));
const { estadoInicial, reduzir } = await import('./estado');
const { NutrientesDoPaciente } = await import('./nutrientes-do-paciente');
const { DialogoBuscaAlimento } = await import('./dialogo-busca');
const { DialogoSalvar } = await import('./minhas-refeicoes');

const plano: PlanoDoCliente = {
  id: 'p', patientId: 'pac', isTemplate: false, titulo: 'Plano alimentar', metaKcal: null, energyCalcId: null, status: 'rascunho', versao: 1, revisao: 0,
  publicadoEm: null, mostrarCalorias: false, orientacoes: '', modo: 'calculado', macrosPrescritos: null, pdfStatus: null, refeicoes: [], origemIa: null, iaOrigemEm: null, listas: [], conteudos: [],
  referenciaId: null, referenciaCongelada: null, nutrientesExibidos: [], mostrarMicrosPdf: false,
};
const estado = estadoInicial(plano);

describe('"Escolher nutrientes": o erro do servidor fica à vista (item 11)', () => {
  const montar = (erro?: string) =>
    renderToStaticMarkup(createElement(NutrientesDoPaciente, { estado, filtro: 'todos', perfis: [], comPaciente: true, somenteLeitura: false, despachar: () => {}, erro }));

  it('com erro, o <details> nasce aberto e o alerta está dentro dele; sem erro, fechado', () => {
    const comErro = montar('Escolha até 12 nutrientes.');
    expect(comErro).toMatch(/<details open=""[^>]*><summary[^>]*>.*Escolher nutrientes/);
    expect(comErro).toContain('<p id="nutrientes-erro" role="alert"');
    expect(montar()).not.toMatch(/<details open=""[^>]*><summary[^>]*>.*Escolher nutrientes/);
  });

  it('os <summary> em flex têm a seta que gira com o <details> aberto (item 5)', () => {
    const html = montar();
    expect(html.match(/<details class="group /g)).toHaveLength(2);
    expect(html.match(/<summary[^>]*><svg aria-hidden="true"[^>]*group-open:rotate-90/g)).toHaveLength(2);
  });
});

describe('busca de alimentos: aba Equivalentes desabilitada (item 13)', () => {
  it('sem item de referência, a aba não aponta aria-controls para um painel que não existe; as outras apontam para o painel montado', () => {
    const html = renderToStaticMarkup(
      createElement(DialogoBuscaAlimento, { destino: { refeicaoId: 'r1', refeicao: 'Almoço', referencia: null, aba: 'lista' }, podeAdicionar: true, aoAdicionar: () => {}, aoFechar: () => {} }),
    );
    const abas = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    expect(abas).toHaveLength(3);
    const equivalentes = abas.find((a) => /id="[^"]*-aba-equivalentes"/.test(a))!;
    expect(equivalentes).toContain('aria-disabled="true"');
    expect(equivalentes).not.toContain('aria-controls');
    for (const a of abas.filter((x) => x !== equivalentes)) {
      const alvo = /aria-controls="([^"]+)"/.exec(a)![1];
      expect(html).toContain(`id="${alvo}"`);
    }
  });
});

describe('"Salvar refeição": aviso da observação num status sempre montado (item 12)', () => {
  it('o contêiner role="status" existe com a caixa desmarcada e sem texto (o texto entra ao marcar)', () => {
    const refeicao = reduzir(estado, { tipo: 'novaRefeicao', id: 'r1' }).refeicoes[0];
    const html = renderToStaticMarkup(createElement(DialogoSalvar, { refeicao, modo: 'calculado', aoFechar: () => {} }));
    expect(html).toMatch(/<p id="[^"]*-obs-aviso" role="status"[^>]*><\/p>/);
    expect(html).not.toContain(MSG_MINHAS_REFEICOES.avisoObservacao);
  });
});
