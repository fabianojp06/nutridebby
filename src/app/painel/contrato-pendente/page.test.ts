import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';

// Plano 26 (RN-501, RE-D29, US-490): o DPA do consultório pendente para a recepção — ela não aceita, só a nutricionista
const sessao = vi.hoisted(() => ({ papel: 'recepcao' as 'nutri' | 'recepcao', dpa: null as string | null, chamadas: [] as unknown[][] }));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock('@/lib/tenant-session', () => ({
  DPA_PATH: '/painel/dpa',
  requireEquipe: vi.fn(async (...a: unknown[]) => {
    sessao.chamadas.push(a);
    return { papel: sessao.papel, financeiro: false, tenant: { dpaVersao: sessao.dpa } };
  }),
}));
const { default: ContratoPendente } = await import('./page');

beforeEach(() => {
  sessao.papel = 'recepcao';
  sessao.dpa = null;
  sessao.chamadas = [];
});

describe('/painel/contrato-pendente (RN-501)', () => {
  it('recepção com o DPA pendente: o título e o texto da §6.2; a sessão é lida com o DPA pendente permitido', async () => {
    const html = renderToStaticMarkup(await ContratoPendente());
    expect(html).toContain('Contrato do consultório pendente');
    expect(html).toContain('O contrato de tratamento de dados do consultório precisa ser aceito pela nutricionista. Peça para ela entrar no NutriDebby.');
    expect(sessao.chamadas).toEqual([['/painel/contrato-pendente', { permitirDpaPendente: true }]]);
  });
  it('recepção com o DPA em dia → Início', async () => {
    sessao.dpa = DPA_VERSAO;
    await expect(ContratoPendente()).rejects.toMatchObject({ url: '/painel' });
  });
  it('a nutricionista vai ao aceite (/painel/dpa) ou, em dia, ao Início', async () => {
    sessao.papel = 'nutri';
    await expect(ContratoPendente()).rejects.toMatchObject({ url: '/painel/dpa' });
    sessao.dpa = DPA_VERSAO;
    await expect(ContratoPendente()).rejects.toMatchObject({ url: '/painel' });
  });
});
