import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUIAS, guiasDoPapel } from '@/modules/ajuda/conteudo';
import { espiarLeiturasNegadas } from '../leituras-negadas';

// Plano 26 (RE-D42, RN-513): o manual completo por papel — a recepção só vê os guias dela (nunca os clínicos)
const sessao = vi.hoisted(() => ({ papel: 'recepcao' as 'nutri' | 'recepcao', chamadas: [] as unknown[][] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({
  requireEquipe: vi.fn(async (...a: unknown[]) => {
    sessao.chamadas.push(a);
    return { papel: sessao.papel, financeiro: false };
  }),
}));
const espiao = espiarLeiturasNegadas(vi);
const { default: AjudaPage } = await import('./page');
const secoes = (html: string) => [...html.matchAll(/<section [^>]*id="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  sessao.papel = 'recepcao';
  sessao.chamadas = [];
});

describe('/painel/ajuda por papel (RE-D42)', () => {
  it('a recepção vê só os guias dela (o Início e a Segurança dela), sem nenhum guia clínico nem da nutricionista', async () => {
    const html = renderToStaticMarkup(await AjudaPage());
    expect(sessao.chamadas).toEqual([['/painel/ajuda']]);
    expect(secoes(html)).toEqual(guiasDoPapel('recepcao').map((g) => g.id));
    expect(secoes(html)).toEqual(expect.arrayContaining(['recepcao-inicio', 'recepcao-seguranca']));
    expect(secoes(html).filter((id) => !id.startsWith('recepcao-'))).toEqual([]);
    // revisão final do PR 2: o índice ("Nesta página") também só aponta para os dois guias dela
    const indice = html.match(/<nav aria-labelledby="indice"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect([...indice.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])).toEqual(['recepcao-inicio', 'recepcao-seguranca']);
    for (const id of ['boas-vindas', 'seguranca', 'pacientes', 'prontuario', 'plano-alimentar', 'documentos', 'ia-nutri', 'agenda', 'diarios', 'configuracoes', 'equipe', 'financeiro', 'relatorios'])
      expect(html, id).not.toContain(`id="${id}"`);
    expect(espiao.chamadas).toEqual([]);
  });
  it('a nutricionista vê o manual dela inteiro, sem o guia da recepção e, com a Equipe desligada (RE-D52), sem o guia `equipe`', async () => {
    sessao.papel = 'nutri';
    const html = renderToStaticMarkup(await AjudaPage());
    expect(secoes(html)).toEqual(GUIAS.filter((g) => !g.id.startsWith('recepcao-') && g.id !== 'equipe').map((g) => g.id));
    // code review do PR 2: nem a seção nem o índice ("Nesta página") apontam para a Equipe desligada
    const indice = html.match(/<nav aria-labelledby="indice"[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(indice).not.toContain('href="#equipe"');
    expect(html).not.toContain('id="equipe"');
  });
});
