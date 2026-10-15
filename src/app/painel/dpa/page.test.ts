import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DPA_MUDOU, DPA_PARAGRAFOS, DPA_VERSAO } from '@/modules/plataforma/dpa';

/**
 * P08-06: no deploy da 1.0, toda nutricionista que aceitou a 0.1 vai a /painel/dpa no meio do trabalho. A tela diz que o
 * contrato mudou (só para quem já aceitou uma versão anterior) e mostra o texto inteiro, sem caixa com rolagem própria.
 */
const sessao = vi.hoisted(() => ({ dpaVersao: null as string | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({
  DPA_PATH: '/painel/dpa',
  requireNutri: async () => ({ tenant: { dpaVersao: sessao.dpaVersao } }),
}));
vi.mock('./form', () => ({ DpaForm: ({ rotulo }: { rotulo: string }) => `[DpaForm ${rotulo}]` }));

const { default: DpaPage } = await import('./page');
const html = async () => renderToStaticMarkup(await DpaPage());

beforeEach(() => {
  sessao.dpaVersao = null;
});

describe('/painel/dpa (P08-06)', () => {
  it('quem aceitou a versão anterior vê que o contrato mudou, com a versão e a data, antes do texto', async () => {
    sessao.dpaVersao = '0.1-provisorio';
    expect(DPA_MUDOU).toBe('O contrato de tratamento de dados mudou (versão 1.0, de 15/10/2026). Leia e aceite para continuar usando o painel.');
    const h = await html();
    expect(h).toContain(`<p role="status" class="rounded-2xl border border-borda bg-cartao p-3 font-medium">${DPA_MUDOU}</p>`);
    expect(h.indexOf(DPA_MUDOU)).toBeLessThan(h.indexOf(DPA_PARAGRAFOS[0].slice(0, 30)));
    expect(h).toContain('[DpaForm Li e aceito');
  });

  it('primeiro aceite (sem versão anterior) não mostra o aviso de mudança', async () => {
    const h = await html();
    expect(h).not.toContain('mudou');
    expect(h).toContain('[DpaForm Li e aceito');
  });

  it('versão em vigor já aceita: sem o aviso e sem o formulário', async () => {
    sessao.dpaVersao = DPA_VERSAO;
    const h = await html();
    expect(h).not.toContain('mudou');
    expect(h).not.toContain('[DpaForm');
    expect(h).toContain('Você já aceitou esta versão do contrato.');
  });

  it('o texto inteiro fica na página, sem caixa de altura fixa com rolagem própria', async () => {
    sessao.dpaVersao = '0.1-provisorio';
    const h = await html();
    expect(h).not.toMatch(/max-h-|overflow-y-auto/);
    for (const p of DPA_PARAGRAFOS) expect(h).toContain(p.slice(0, 40));
  });
});
