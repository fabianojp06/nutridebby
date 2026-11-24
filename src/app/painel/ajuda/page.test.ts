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
  it('a recepção vê só os guias dela (o Início dela e a Segurança), sem nenhum guia clínico nem da nutricionista', async () => {
    const html = renderToStaticMarkup(await AjudaPage());
    expect(sessao.chamadas).toEqual([['/painel/ajuda']]);
    expect(secoes(html)).toEqual(guiasDoPapel('recepcao').map((g) => g.id));
    expect(secoes(html)).toContain('recepcao-inicio');
    for (const id of ['boas-vindas', 'pacientes', 'prontuario', 'plano-alimentar', 'documentos', 'ia-nutri', 'agenda', 'diarios', 'configuracoes', 'equipe', 'financeiro', 'relatorios'])
      expect(html, id).not.toContain(`id="${id}"`);
    expect(espiao.chamadas).toEqual([]);
  });
  it('a nutricionista vê o manual dela inteiro, sem o guia da recepção', async () => {
    sessao.papel = 'nutri';
    const html = renderToStaticMarkup(await AjudaPage());
    expect(secoes(html)).toEqual(GUIAS.filter((g) => !g.id.startsWith('recepcao-')).map((g) => g.id));
  });
});
