import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListaDoPlano } from '@/modules/portal/lista-compras';

// Só a montagem da página: sessão e lista simuladas.
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn(), back: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } }) }));
const lista = vi.hoisted(() => ({ atual: null as ListaDoPlano | null }));
vi.mock('@/modules/portal/lista-compras', async (orig) => ({
  ...(await orig<typeof import('@/modules/portal/lista-compras')>()),
  listaDoPlano: async () => lista.atual,
}));
const { default: Compras } = await import('./page');
const pagina = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Compras({ searchParams: Promise.resolve(busca) } as never));

describe('/p/compras (RN-248)', () => {
  afterEach(() => {
    lista.atual = null;
  });

  it('com itens: a lista e a dica de marcação; sem o texto de janela vazia', async () => {
    lista.atual = { planoId: 'p1', grupos: [{ grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz branco', gramas: 500, texto: '500 g' }] }], semAlimentos: false, textoLivreFora: false };
    const html = await pagina();
    expect(html).toContain('Arroz branco — 500 g');
    expect(html).toContain('Marque o que já comprou');
    expect(html).not.toContain('Nenhuma refeição com alimentos');
  });

  it('janela sem nenhuma refeição que valha (ex.: 1 dia num domingo, plano de seg a sex): texto de vazio em região de status, sem lista nem dica de marcação', async () => {
    lista.atual = { planoId: 'p1', grupos: [], semAlimentos: false, textoLivreFora: false };
    const html = await pagina({ dias: '1' });
    expect(html).toMatch(/<p role="status">Nenhuma refeição com alimentos do seu plano cai nesses dias\. Aumente o número de dias\.<\/p>/);
    expect(html).not.toContain('Marque o que já comprou');
    expect(html).not.toContain('<fieldset');
  });

  it('plano sem alimentos (texto livre): só o aviso da RN-248, não o de janela vazia', async () => {
    lista.atual = { planoId: 'p1', grupos: [], semAlimentos: true, textoLivreFora: false };
    const html = await pagina();
    expect(html).toContain('Este plano não tem alimentos com quantidade, então não há lista de compras.');
    expect(html).not.toContain('Nenhuma refeição com alimentos');
    expect(html).not.toContain('Marque o que já comprou');
  });
});
