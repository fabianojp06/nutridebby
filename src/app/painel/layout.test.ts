import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { espiarLeiturasNegadas } from './leituras-negadas';

/**
 * Plano 26 (RN-514, R-482): o layout do painel na sessão da recepção — o menu dela, o menu da conta dela e o manual guiado
 * dela, sem chamar nenhum contador clínico. O espião de leituras negadas faz o render falhar se o layout chamar um módulo
 * que lê tabela negada à recepção; o controle positivo é a sessão da nutricionista (que chama os contadores dela).
 */
const sessao = vi.hoisted(() => ({ papel: 'recepcao' as 'nutri' | 'recepcao', financeiro: false }));
vi.mock('server-only', () => ({}));
vi.mock('@/app/fontes-painel', () => ({ FONTES_DO_PAINEL: '' }));
vi.mock('@/components/vigia-sessao', () => ({ VigiaDeSessao: () => null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/painel',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {} }),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('./preferencias/actions', () => ({ marcarGuiaAction: vi.fn(async () => {}), alternarTemaAction: vi.fn(async () => {}) }));
vi.mock('@/modules/plataforma/preferencias', async (original) => ({ ...(await original<typeof import('@/modules/plataforma/preferencias')>()), lerGuia: vi.fn(async () => ({})) }));
vi.mock('@/lib/tenant-session', async () => {
  const { DPA_VERSAO } = await import('@/modules/plataforma/dpa');
  return {
    requireEquipe: vi.fn(async () => ({
      data: { user: { id: '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b', name: 'Carla Lima', email: 'carla@ex.com', tema: 'sistema', appRole: sessao.papel } },
      tenant: { id: 't1', nomeExibicao: 'Consultório Debby', corPrimaria: null, logoPath: null, dpaVersao: DPA_VERSAO, examesPacienteAtivadoEm: new Date(), iaNutriAtivadaEm: new Date() },
      ctx: { tenantId: 't1', role: sessao.papel, actorUserId: '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b' },
      papel: sessao.papel,
      financeiro: sessao.papel === 'nutri' || sessao.financeiro,
    })),
  };
});
const { chamadas } = espiarLeiturasNegadas(vi);
const { default: PainelLayout } = await import('./layout');

const render = async () => renderToStaticMarkup(await PainelLayout({ children: createElement('p', null, 'conteúdo'), params: Promise.resolve({}) } as never));
const menu = (html: string) => [...(/<nav aria-label="Menu do painel"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '').matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);

beforeEach(() => {
  sessao.papel = 'recepcao';
  sessao.financeiro = false;
  chamadas.length = 0;
});

describe('layout do painel na sessão da recepção (RN-514)', () => {
  it('sem a permissão do Financeiro: Início, Pacientes, Agenda e Relatórios; nenhum contador clínico é lido (espião)', async () => {
    const html = await render();
    expect(chamadas).toEqual([]);
    expect(menu(html)).toEqual(['Início', 'Pacientes', 'Agenda', 'Relatórios']);
    expect(html).not.toMatch(/Exames recebidos|Dúvidas dos pacientes|Diários|Conteúdos|Configurações/);
  });
  it('com a permissão: + Financeiro, entre Agenda e Relatórios', async () => {
    sessao.financeiro = true;
    expect(menu(await render())).toEqual(['Início', 'Pacientes', 'Agenda', 'Financeiro', 'Relatórios']);
    expect(chamadas).toEqual([]);
  });
  it('menu da conta: "{nome} · Recepção", "Segurança", "Manual", "Rever o tour" (o dela) e "Sair"; sem "Perfil e marca"', async () => {
    const html = await render();
    expect(html).toContain('Carla Lima · Recepção');
    expect(html).toMatch(/href="\/conta\/seguranca"[^>]*>Segurança</);
    expect(html).toMatch(/href="\/painel\/ajuda"[^>]*>Manual</);
    expect(html).toMatch(/href="\/painel\?tour=recepcao-inicio"[^>]*>Rever o tour</);
    expect(html).toContain('Sair');
    expect(html).not.toContain('Perfil e marca');
    expect(html).not.toContain('tour=boas-vindas');
  });
  it('o tour do primeiro acesso é o `recepcao-inicio`, nunca o `boas-vindas` (RE-D42)', async () => {
    const html = await render();
    expect(html).toContain('Boas-vindas à recepção');
    expect(html).not.toContain('Boas-vindas ao NutriDebby');
  });
  it('controle positivo: na sessão da nutricionista o layout lê os contadores clínicos — e o espião pega', async () => {
    sessao.papel = 'nutri';
    await expect(render()).rejects.toThrow(/leitura negada à recepção/);
    expect(chamadas[0]).toMatch(/^@\/modules\/pacientes\/exames-enviados#contarEnviosRecebidos$/);
  });
});
