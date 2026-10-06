import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// P09-03: a tela do aviso. requireUser e os botões de sair simulados (a regra do redirect está em session.test.ts).
const usuario = vi.hoisted(() => ({ atual: { appRole: 'nutri', tema: 'escuro', name: 'Débora Nutri', email: 'debora@consultorio.dev' } as Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ requireUser: vi.fn(async () => ({ user: usuario.atual })) }));
vi.mock('@/components/botao-sair', () => ({ BotaoSair: () => '[BotaoSair]' }));
vi.mock('@/app/p/sair-portal', () => ({ SairPortal: () => '[SairPortal]' }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect ${url}`); } }));
const { default: OutroPapelPage } = await import('./page');

const pagina = async (esperado: unknown) => renderToStaticMarkup(await OutroPapelPage({ searchParams: Promise.resolve({ esperado }) } as never));

describe('/conta/outro-papel (P09-03)', () => {
  it('nutricionista no portal: o texto, o BotaoSair e o link do painel; nada da conta na tela', async () => {
    usuario.atual = { appRole: 'nutri', tema: 'escuro', name: 'Débora Nutri', email: 'debora@consultorio.dev' };
    const html = await pagina('paciente');
    expect(html).toContain('Este aparelho está conectado como nutricionista. Saia e entre com a conta de paciente.');
    expect(html).toContain('role="status"');
    expect(html).toContain('[BotaoSair]');
    expect(html).toContain('href="/painel"');
    expect(html).toContain('data-tema="escuro"');
    expect(html).not.toContain('Débora');
    expect(html).not.toContain('debora@consultorio.dev');
  });
  it('paciente no painel: o SairPortal (limpa o aparelho), nunca o BotaoSair', async () => {
    usuario.atual = { appRole: 'paciente', tema: 'sistema', name: 'Paula', email: 'paula@x.dev' };
    const html = await pagina('nutri');
    expect(html).toContain('Este aparelho está conectado como paciente. Saia e entre com a conta de nutricionista.');
    expect(html).toContain('[SairPortal]');
    expect(html).not.toContain('[BotaoSair]');
    expect(html).toContain('href="/p/inicio"');
  });
  it('Review Focus 4: esperado forjado, lista ou igual ao papel atual → home do papel, sem ecoar nada', async () => {
    usuario.atual = { appRole: 'nutri', tema: 'claro', name: 'N', email: 'n@x.dev' };
    for (const v of ['javascript:alert(1)', 'root', ['paciente', 'admin'], undefined, 'nutri']) {
      await expect(pagina(v)).rejects.toThrow(/^redirect \/painel$/);
    }
  });
});
