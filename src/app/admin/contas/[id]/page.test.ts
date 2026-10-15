import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Revisão final do Plano 15 (RNF-108, DP-11): na página da conta, a linha da IA Nutri mostra o gasto do mês em US$ (como a
// da nutricionista), para a conferência mensal somar as duas linhas contra a fatura. Conta e métricas simuladas.
const TENANT = '00000000-0000-4000-8000-000000000001';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({}) }));
vi.mock('@/modules/plataforma/contas', () => ({
  MSG: {},
  contaPorId: async () => ({
    tenantId: TENANT, nomeExibicao: 'Consultório Teste', slug: 'teste', email: 'a@a.test', crn: null, status: 'ativa', convite: 'aceito',
    documentosLiberados: false, iaLiberada: true, iaAtivada: true, iaCotaMensalUsd: 30, iaNutriCotaMensalUsd: 7, waCotaMensal: 100,
    taxaFaltasBase: null, goLiveEm: null,
  }),
}));
vi.mock('@/modules/plataforma/metricas', () => ({
  metricasPorTenant: async () => new Map(),
  metricasDeSucessoPorTenant: async () => new Map(),
  metricasDeExamesEnviadosPorTenant: async () => new Map(),
  metricasDeIaPorEscopo: async () =>
    new Map([[TENANT, { nutri: { custoMesMicroUsd: 2_500_000, tarefasMes: 4 }, paciente: { custoMesMicroUsd: 1_750_000, perguntasMes: 12 } }]]),
}));
vi.mock('../../actions', () => ({ definirDocumentosAction: vi.fn(), definirIaAction: vi.fn(), reativarAction: vi.fn(), reenviarConviteAction: vi.fn(), suspenderAction: vi.fn() }));
vi.mock('../../convite', () => ({ Convite: () => 'aceito' }));
vi.mock('../../cota-form', () => ({ CotaForm: () => '[CotaForm]' }));
vi.mock('../../ia-cota-form', () => ({ IaCotaForm: () => '[IaCotaForm]' }));
vi.mock('../../ia-nutri-cota-form', () => ({ IaNutriCotaForm: () => '[IaNutriCotaForm]' }));
vi.mock('../../metricas-form', () => ({ MetricasForm: () => '[MetricasForm]' }));
vi.mock('@/components/confirmar-botao', () => ({ ConfirmarBotao: ({ children }: { children: ReactElement }) => children }));
const { default: ContaPage } = await import('./page');

describe('/admin/contas/[id] — Uso no mês (RNF-108, DP-11)', () => {
  it('a linha da IA Nutri traz o gasto do mês em US$ contra o limite dela, as perguntas e a porcentagem; a da nutricionista continua', async () => {
    const el = (await ContaPage({ params: Promise.resolve({ id: TENANT }), searchParams: Promise.resolve({}) } as never)) as ReactElement;
    const h = renderToStaticMarkup(el);
    expect(h).toContain('Uso de IA da nutricionista no mês</dt><dd class="text-right font-medium">US$ 2,50 de US$ 30,00</dd>');
    expect(h).toContain('Uso da IA Nutri (pacientes) no mês</dt><dd class="text-right font-medium">US$ 1,75 de US$ 7,00 · 12 perguntas · 25% do limite</dd>');
  });
});
