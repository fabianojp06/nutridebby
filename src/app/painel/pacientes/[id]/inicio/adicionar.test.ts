import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { montarAdicionar, type GrupoNoAdicionar } from '@/modules/ficha/adicionar';
import type { SecaoNoInicio } from '@/modules/ficha/inicio';
import { SECOES_DA_FICHA } from '@/modules/ficha/secoes';
import type { SecaoDaFicha } from '@/modules/ficha/tipos';
import { Adicionar } from './adicionar';

// Plano 18 (US-263, RN-280): o diálogo "Adicionar ao prontuário" — grupos, itens, destinos e o que some. Só a estrutura
// (sem DOM): o foco, o Esc e a volta do foco ao botão ficam no E2E (e2e/ficha.spec.ts).
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({ push: () => undefined }) }));

const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const BASE = `/painel/pacientes/${PACIENTE}`;
const naTela = (id: string, podeAdicionar = true): Pick<SecaoNoInicio, 'id' | 'podeAdicionar'> => ({ id, podeAdicionar });
const TODAS = SECOES_DA_FICHA.map((s) => naTela(s.id));
const acoes = { 'criar-receita': vi.fn(async () => undefined), 'criar-parecer': vi.fn(async () => undefined) };
const html = (grupos: GrupoNoAdicionar[]) => renderToStaticMarkup(createElement(Adicionar, { grupos, acoes }));
const rotulos = (grupos: GrupoNoAdicionar[]) => grupos.map((g) => [g.titulo, g.itens.map((i) => i.rotulo)]);

/** Seção de outro plano (como o Financeiro do Plano 20): grupo "Outros", destino absoluto em /painel/. */
const OUTRA: SecaoDaFicha = {
  id: 'financeiro-teste',
  titulo: 'Financeiro',
  aba: '',
  disponivel: () => true,
  resumo: async () => ({ total: 0, ultimos: [] }),
  adicionar: [{ grupo: 'outros', rotulo: 'Lançamento', destino: { href: '/painel/financeiro/novo' } }],
};

describe('Adicionar ao prontuário (US-263, RN-280)', () => {
  it('grupos e itens na ordem da US-263: Avaliações (Anamnese, Antropometria, Gasto energético, Exame, Atendimento) e Prescrições (Plano alimentar, Receita, Parecer nutricional)', () => {
    const grupos = montarAdicionar(PACIENTE, TODAS);
    expect(rotulos(grupos)).toEqual([
      ['Avaliações', ['Anamnese', 'Antropometria', 'Gasto energético', 'Exame', 'Atendimento']],
      ['Prescrições', ['Plano alimentar', 'Receita', 'Parecer nutricional']],
    ]);
    const h = html(grupos);
    expect([...h.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1])).toEqual(['Avaliações', 'Prescrições']);
    expect([...h.matchAll(/<(?:a|button)\b[^>]*>([^<]*)<\/(?:a|button)>/g)].map((m) => m[1]).filter((t) => !['Fechar', '+', 'Adicionar'].includes(t))).toEqual([
      'Anamnese', 'Antropometria', 'Gasto energético', 'Exame', 'Atendimento', 'Plano alimentar', 'Receita', 'Parecer nutricional',
    ]);
  });

  it('o diálogo: título "Adicionar ao prontuário" (focável por script), a dica, "Fechar" e o botão com o nome acessível', () => {
    const h = html(montarAdicionar(PACIENTE, TODAS));
    expect(h).toMatch(/<button[^>]*aria-label="Adicionar ao prontuário"[^>]*data-guia="adicionar-prontuario"/);
    expect(h).toMatch(/<button[^>]*aria-haspopup="dialog"/);
    expect(h).toContain('Adicionar</button>');
    expect(h).toMatch(/<dialog[^>]*aria-labelledby="adicionar-titulo"/);
    expect(h).toMatch(/<h2 id="adicionar-titulo" tabindex="-1"[^>]*>Adicionar ao prontuário<\/h2>/);
    expect(h).toContain('Antes do plano alimentar, registre a anamnese, a antropometria e o gasto energético.');
    expect(h).toContain('>Fechar</button>');
  });

  it('item com href relativo sai com /painel/pacientes/{id}/…; Receita e Parecer nutricional são formulários (as Server Actions da aba Documentos)', () => {
    const grupos = montarAdicionar(PACIENTE, TODAS);
    const itens = grupos.flatMap((g) => g.itens);
    expect(itens.find((i) => i.rotulo === 'Antropometria')).toEqual({ rotulo: 'Antropometria', href: `${BASE}/antropometria#nova-avaliacao` });
    expect(itens.find((i) => i.rotulo === 'Anamnese')).toEqual({ rotulo: 'Anamnese', href: `${BASE}/anamnese#modelo` });
    expect(itens.find((i) => i.rotulo === 'Plano alimentar')).toEqual({ rotulo: 'Plano alimentar', href: `${BASE}/plano-alimentar` });
    expect(itens.find((i) => i.rotulo === 'Receita')).toEqual({ rotulo: 'Receita', acao: 'criar-receita' });
    expect(itens.find((i) => i.rotulo === 'Parecer nutricional')).toEqual({ rotulo: 'Parecer nutricional', acao: 'criar-parecer' });
    const h = html(grupos);
    expect(h).toContain(`href="${BASE}/gasto-energetico#novo-calculo"`);
    expect(h).toContain(`href="${BASE}/exames#novo-exame"`);
    expect(h).toContain(`href="${BASE}/atendimentos#novo-atendimento"`);
    expect(h).toMatch(/<form[^>]*>(?:(?!<\/form>).)*Receita<\/button><\/form>/);
    expect(h).toMatch(/<form[^>]*>(?:(?!<\/form>).)*Parecer nutricional<\/button><\/form>/);
  });

  it('documentos desligados (a seção não veio do Início): sem "Receita" e "Parecer nutricional"', () => {
    const grupos = montarAdicionar(PACIENTE, TODAS.filter((s) => s.id !== 'documentos'));
    expect(rotulos(grupos)).toEqual([
      ['Avaliações', ['Anamnese', 'Antropometria', 'Gasto energético', 'Exame', 'Atendimento']],
      ['Prescrições', ['Plano alimentar']],
    ]);
    const h = html(grupos);
    expect(h).not.toContain('Receita');
    expect(h).not.toContain('Parecer nutricional');
  });

  it('sem item de "Outros": sem o grupo; com uma seção que o usa, "Outros" no fim e o destino absoluto como está', () => {
    expect(html(montarAdicionar(PACIENTE, TODAS))).not.toContain('Outros');
    const grupos = montarAdicionar(PACIENTE, [...TODAS, naTela(OUTRA.id)], [...SECOES_DA_FICHA, OUTRA]);
    expect(grupos.map((g) => g.titulo)).toEqual(['Avaliações', 'Prescrições', 'Outros']);
    expect(grupos[2].itens).toEqual([{ rotulo: 'Lançamento', href: '/painel/financeiro/novo' }]);
    expect(html(grupos)).toContain('href="/painel/financeiro/novo"');
  });

  it('podeAdicionar: false esconde os itens da seção; grupo sem item some', () => {
    const grupos = montarAdicionar(PACIENTE, TODAS.map((s) => (s.id === 'antropometria' || s.id === 'plano-alimentar' || s.id === 'documentos' ? naTela(s.id, false) : s)));
    expect(rotulos(grupos)).toEqual([['Avaliações', ['Anamnese', 'Gasto energético', 'Exame', 'Atendimento']]]);
    expect(html(grupos)).not.toContain('Prescrições');
  });

  it('seção fora do registro ou sem `adicionar` (envios do paciente) não traz item', () => {
    expect(montarAdicionar(PACIENTE, [naTela('exames-enviados'), naTela('nao-existe')])).toEqual([]);
  });

  it('guarda de fonte: os links do diálogo não pré-carregam (os destinos gravam auditRead)', () => {
    const src = readFileSync(path.resolve('src/app/painel/pacientes/[id]/inicio/adicionar.tsx'), 'utf8');
    const links = src.match(/<Link\b[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toContain('prefetch={false}');
  });
});
