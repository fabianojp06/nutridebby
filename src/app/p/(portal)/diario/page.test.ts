import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: sessão, diário e formulário simulados.
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } }) }));
vi.mock('@/modules/portal/plano', () => ({ planoDoPaciente: async () => null }));
vi.mock('./diario-form', () => ({ DiarioForm: () => null }));
const LINK = 'https://exemplo.com.br/receitas/lanche-integral-com-frutas-vermelhas-e-aveia-em-flocos-finos';
vi.mock('@/modules/portal/diario', () => ({
  diarioDoPaciente: async () => [
    { id: 'd1', dataHora: new Date('2026-10-08T15:00:00Z'), refeicao: 'Almoço', refeicaoDoPlano: null, resposta: null, texto: `arroz ${LINK}`, foto: { estado: 'sem_foto' }, comentario: `Veja ${LINK}` },
  ],
}));
const { default: Diario } = await import('./page');

describe('/p/diario', () => {
  it('o texto livre (o registro do paciente e o comentário da nutricionista) quebra: um link longo não faz a página rolar na horizontal a 320 px', async () => {
    const html = renderToStaticMarkup(await Diario({ searchParams: Promise.resolve({}) } as never));
    for (const texto of [`arroz ${LINK}`, `Veja ${LINK}`]) {
      const classe = new RegExp(`<p class="([^"]*)">${texto.replaceAll('.', '\\.')}</p>`).exec(html)?.[1].split(' ');
      expect(classe, texto).toContain('wrap-break-word');
    }
  });
});
