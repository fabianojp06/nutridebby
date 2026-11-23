import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plano 26 (RE-D47, US-490): "Sem permissão" com os dois textos; a página abre pela sessão da equipe (ROTAS_DA_RECEPCAO)
const sessao = vi.hoisted(() => ({ papel: 'recepcao' as 'nutri' | 'recepcao', chamadas: [] as unknown[][] }));
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
  requireEquipe: vi.fn(async (...a: unknown[]) => {
    sessao.chamadas.push(a);
    return { papel: sessao.papel, financeiro: false };
  }),
}));
const { default: SemPermissao } = await import('./page');

const render = async (motivo?: unknown) => renderToStaticMarkup(await SemPermissao({ searchParams: Promise.resolve(motivo === undefined ? {} : { motivo }) } as never));

beforeEach(() => {
  sessao.papel = 'recepcao';
  sessao.chamadas = [];
});

describe('/painel/sem-permissao (RE-D47)', () => {
  it('?motivo=nutri: "Esta página é só da nutricionista." e "Voltar ao início"', async () => {
    const html = await render('nutri');
    expect(html).toContain('<h1');
    expect(html).toContain('Sem permissão');
    expect(html).toContain('Esta página é só da nutricionista.');
    expect(html).toMatch(/<a [^>]*href="\/painel"[^>]*>Voltar ao início<\/a>/);
    expect(html).not.toContain('Financeiro');
    expect(sessao.chamadas).toEqual([['/painel/sem-permissao']]);
  });
  it('?motivo=financeiro: "Você não tem permissão para o Financeiro. Peça à nutricionista."', async () => {
    const html = await render('financeiro');
    expect(html).toContain('Você não tem permissão para o Financeiro. Peça à nutricionista.');
    expect(html).not.toContain('só da nutricionista');
  });
  it.each([undefined, 'outro', ['financeiro']])('motivo %j fora da lista → o texto da página só da nutricionista', async (motivo) => {
    expect(await render(motivo)).toContain('Esta página é só da nutricionista.');
  });
  it('a nutricionista não tem o que fazer aqui: vai ao Início', async () => {
    sessao.papel = 'nutri';
    await expect(render('nutri')).rejects.toMatchObject({ url: '/painel' });
  });
});
