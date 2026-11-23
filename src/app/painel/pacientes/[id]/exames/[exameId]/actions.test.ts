import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plano 22 (T6, US-375, R22-17): as actions "Mostrar no app" e "Retirar do app" do detalhe do exame. O módulo é simulado
// (o banco é provado em src/modules/exames/exames-no-app.test.ts); aqui, a sessão, os erros e o que a tela recebe.
vi.mock('server-only', () => ({}));
const sessao = { ctx: { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002' }, tenant: { fuso: 'America/Sao_Paulo' } };
const requireNutri = vi.fn<(caminho: string) => Promise<typeof sessao>>(async () => sessao);
vi.mock('@/lib/tenant-session', () => ({ requireNutri: (caminho: string) => requireNutri(caminho) }));
const revalidar = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidar(...a) }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((u: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url: u });
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
const mostrar = vi.fn();
const retirar = vi.fn();
vi.mock('@/modules/exames/edicao', async (orig) => ({ ...(await orig<typeof import('@/modules/exames/edicao')>()), mostrarNoApp: mostrar, retirarDoApp: retirar }));

const { mostrarNoAppAction, retirarDoAppAction } = await import('./actions');
const { MSG_BLOQUEADO, PacienteBloqueadoError, PacienteNaoEncontradoError } = await import('@/modules/pacientes/base');
const { ExameError } = await import('@/modules/pacientes/exames');
const { MSG_EXAMES } = await import('@/modules/exames/constantes');

const P = '00000000-0000-4000-8000-0000000000aa';
const EXAME = '00000000-0000-4000-8000-0000000000bb';
const ERRO = MSG_EXAMES.vazios.erroApp;
beforeEach(() => {
  vi.clearAllMocks();
  mostrar.mockResolvedValue({ pacienteUsaApp: true });
  retirar.mockResolvedValue(undefined);
});

describe('mostrarNoAppAction / retirarDoAppAction (Plano 22, T6, R22-17)', () => {
  it('sucesso: requireNutri com o caminho do detalhe, o módulo com o contexto da sessão, `ok` e `pacienteUsaApp`; a ficha é revalidada', async () => {
    expect(await mostrarNoAppAction(P, EXAME, {}, new FormData())).toEqual({ ok: true, pacienteUsaApp: true });
    expect(requireNutri).toHaveBeenCalledWith(`/painel/pacientes/${P}/exames/${EXAME}`);
    expect(mostrar).toHaveBeenCalledWith(sessao.ctx, P, EXAME);
    mostrar.mockResolvedValueOnce({ pacienteUsaApp: false });
    expect(await mostrarNoAppAction(P, EXAME, {}, new FormData())).toEqual({ ok: true, pacienteUsaApp: false });
    expect(await retirarDoAppAction(P, EXAME, {}, new FormData())).toEqual({ ok: true });
    expect(retirar).toHaveBeenCalledWith(sessao.ctx, P, EXAME);
    expect(revalidar).toHaveBeenCalledWith(`/painel/pacientes/${P}`, 'layout');
  });

  it('papel errado: o redirecionamento de requireNutri sai antes de qualquer gravação', async () => {
    requireNutri.mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { url: '/conta/outro-papel?esperado=nutri' }));
    await expect(mostrarNoAppAction(P, EXAME, {}, new FormData())).rejects.toMatchObject({ url: '/conta/outro-papel?esperado=nutri' });
    requireNutri.mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { url: '/conta/outro-papel?esperado=nutri' }));
    await expect(retirarDoAppAction(P, EXAME, {}, new FormData())).rejects.toMatchObject({ url: '/conta/outro-papel?esperado=nutri' });
    expect(mostrar).not.toHaveBeenCalled();
    expect(retirar).not.toHaveBeenCalled();
  });

  it('paciente bloqueado → `erro` com a recusa de hoje; exame que sumiu (excluído em outra aba) → "Não foi possível mudar o app do paciente. Tente de novo."', async () => {
    mostrar.mockRejectedValueOnce(new PacienteBloqueadoError());
    expect(await mostrarNoAppAction(P, EXAME, {}, new FormData())).toEqual({ erro: MSG_BLOQUEADO });
    retirar.mockRejectedValueOnce(new PacienteBloqueadoError());
    expect(await retirarDoAppAction(P, EXAME, {}, new FormData())).toEqual({ erro: MSG_BLOQUEADO });
    mostrar.mockRejectedValueOnce(new ExameError({ geral: MSG_EXAMES.erros.naoEncontrado }));
    expect(await mostrarNoAppAction(P, EXAME, {}, new FormData())).toEqual({ erro: ERRO });
    retirar.mockRejectedValueOnce(new ExameError({ geral: MSG_EXAMES.erros.naoEncontrado }));
    expect(await retirarDoAppAction(P, EXAME, {}, new FormData())).toEqual({ erro: ERRO });
    expect(ERRO).toBe('Não foi possível mudar o app do paciente. Tente de novo.');
    expect(revalidar).not.toHaveBeenCalled();
  });

  it('paciente de outro consultório → 404', async () => {
    mostrar.mockRejectedValueOnce(new PacienteNaoEncontradoError());
    await expect(mostrarNoAppAction(P, EXAME, {}, new FormData())).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
