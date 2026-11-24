import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccessHistoryItem, AccessHistoryPage } from '../audit';
import { formatarDataHora, HistoricoAcessosTabela } from './historico-acessos';

const item = (min: number, ator: AccessHistoryItem['ator']): AccessHistoryItem => ({
  id: `i${min}`, criadoEm: new Date(Date.UTC(2026, 9, 1, 12, min)), acao: 'ler', entidade: 'patients', entidadeId: 'p', ip: '203.0.113.1', ator,
});
const render = (pagina: AccessHistoryPage) =>
  renderToStaticMarkup(createElement(HistoricoAcessosTabela, { pagina, fuso: 'America/Sao_Paulo', baseHref: '/painel/pacientes/p' }));

describe('HistoricoAcessosTabela', () => {
  it('data no fuso do tenant, quem, ação, registro e IP; sem ator = Sistema', () => {
    const html = render({ itens: [item(1, { nome: 'Debby Silva', papel: 'nutri' }), item(0, null)], pagina: 1, totalPaginas: 1, total: 2 });
    for (const t of ['Histórico de acessos', '01/10/2026, 09:01', 'Debby Silva (nutricionista)', 'Sistema', 'Visualizou', 'Cadastro do paciente', '203.0.113.1']) {
      expect(html).toContain(t);
    }
    expect(html).not.toContain('Próxima');
  });
  it('Plano 26 (RN-516): a pessoa da recepção aparece identificada', () => {
    const html = render({ itens: [item(2, { nome: 'Ana Recepção', papel: 'recepcao' })], pagina: 1, totalPaginas: 1, total: 1 });
    expect(html).toContain('Ana Recepção (recepção)');
  });
  it('paginação com ?pagina=', () => {
    const html = render({ itens: [item(0, null)], pagina: 2, totalPaginas: 3, total: 120 });
    expect(html).toContain('href="/painel/pacientes/p?pagina=1"');
    expect(html).toContain('href="/painel/pacientes/p?pagina=3"');
    expect(html).toContain('Página 2 de 3');
  });
  it('sem acessos', () => {
    expect(render({ itens: [], pagina: 1, totalPaginas: 1, total: 0 })).toContain('Nenhum acesso registrado.');
  });
  it('formatarDataHora usa dd/mm/aaaa no fuso', () => {
    expect(formatarDataHora(new Date('2026-10-01T02:30:00Z'), 'America/Sao_Paulo')).toBe('30/09/2026, 23:30');
  });
});
