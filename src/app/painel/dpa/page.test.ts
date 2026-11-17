import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DPA_MUDOU, DPA_O_QUE_MUDOU, DPA_PARAGRAFOS, DPA_VERSAO } from '@/modules/plataforma/dpa';

/**
 * P08-06: no deploy de uma versão nova (a 1.1 no Plano 20, US-309), toda nutricionista que aceitou a anterior vai a
 * /painel/dpa no meio do trabalho. A tela diz que o contrato mudou e o que mudou (só para quem já aceitou uma versão
 * anterior) e mostra o texto inteiro, sem caixa com rolagem própria.
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
  it('quem aceitou a 1.0 vê que o contrato mudou, com a versão e a data, e o que mudou, antes do texto (US-309)', async () => {
    sessao.dpaVersao = '1.0';
    expect(DPA_MUDOU).toMatch(/^O contrato de tratamento de dados mudou \(versão 1\.1, de \d\d\/\d\d\/\d{4}\)\. Leia e aceite para continuar usando o painel\.$/);
    const h = await html();
    expect(h).toContain(
      `<div role="status" class="space-y-1 rounded-2xl border border-borda bg-cartao p-3"><p class="font-medium">${DPA_MUDOU}</p><p>${DPA_O_QUE_MUDOU}</p></div>`,
    );
    expect(h.indexOf(DPA_O_QUE_MUDOU)).toBeLessThan(h.indexOf(DPA_PARAGRAFOS[0].slice(0, 30)));
    expect(h).toContain('[DpaForm Li e aceito');
  });

  it('quem aceitou uma versão mais antiga (0.1 provisória) também vê o aviso de mudança', async () => {
    sessao.dpaVersao = '0.1-provisorio';
    const h = await html();
    expect(h).toContain(DPA_MUDOU);
    expect(h).toContain('[DpaForm Li e aceito');
  });

  it('primeiro aceite (sem versão anterior) não mostra o aviso de mudança', async () => {
    const h = await html();
    expect(h).not.toContain('mudou');
    expect(h).not.toContain(DPA_O_QUE_MUDOU);
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
