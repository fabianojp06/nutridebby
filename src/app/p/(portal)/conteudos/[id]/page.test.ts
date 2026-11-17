import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConteudoDoPaciente } from '@/modules/portal/conteudos';

// Só a montagem da página: sessão e conteúdo simulados.
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } }) }));
vi.mock('../actions', () => ({ favoritoAction: async () => undefined, vistoAction: async () => undefined }));
const pedidos = vi.hoisted(() => [] as { id: string; doPlano?: boolean }[]);
const doPlano = vi.hoisted(() => ({ so: false }));
vi.mock('@/modules/portal/conteudos', () => ({
  conteudoDoPaciente: async (_ctx: unknown, id: string, _db: unknown, o: { doPlano?: boolean } = {}): Promise<ConteudoDoPaciente> => {
    pedidos.push({ id, doPlano: o.doPlano });
    return {
      id,
      tipo: 'orientacao',
      titulo: 'Como montar o prato',
      resumo: '',
      corpoMd: 'Metade do prato com verduras.',
      capaUrl: null,
      video: null,
      temPdf: true,
      favorito: false,
      receita: null,
      porPorcao: null,
      soPeloPlano: doPlano.so,
    };
  },
}));
const { default: Pagina } = await import('./page');

const ID = '00000000-0000-4000-8000-0000000000c1';
const pagina = async (busca: Record<string, string>) => renderToStaticMarkup(await Pagina({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(busca) } as never));

describe('/p/conteudos/[id] (US-052, RN-253)', () => {
  it('aberto pelo plano, fora da audiência: o link do PDF leva ?de=plano (senão a rota dá 404), sem "Favoritar" e voltando para o Plano', async () => {
    doPlano.so = true;
    try {
      const html = await pagina({ de: 'plano' });
      expect(pedidos.at(-1)).toEqual({ id: ID, doPlano: true });
      expect(html).toContain(`href="/api/p/conteudos/${ID}/pdf?de=plano"`);
      expect(html).not.toContain('Favoritar');
      expect(html).toContain('href="/p/plano"');
    } finally {
      doPlano.so = false;
    }
  });

  it('pela audiência (Conteúdos, ou ?de=plano de conteúdo que ele já vê): o link do PDF sem ?de=plano', async () => {
    for (const busca of [{}, { de: 'plano' }] as Record<string, string>[]) {
      const html = await pagina(busca);
      expect(html).toContain(`href="/api/p/conteudos/${ID}/pdf"`);
      expect(html).not.toContain('?de=plano');
    }
    expect(pedidos.at(-2)).toEqual({ id: ID, doPlano: false });
  });
});
