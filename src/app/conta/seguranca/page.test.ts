import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// D17 (achado 9 do /code-review do PR #12): a Segurança segue o tema guardado na conta da nutricionista, como o painel
const usuario = vi.hoisted(() => ({ atual: { appRole: 'nutri', tema: 'escuro', twoFactorEnabled: false } as Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ requireUser: vi.fn(async () => ({ user: usuario.atual })) }));
vi.mock('@/components/botao-sair', () => ({ BotaoSair: () => '[BotaoSair]' }));
vi.mock('./enable-2fa', () => ({ Enable2fa: () => '[Enable2fa]' }));
const { default: SegurancaPage } = await import('./page');

const temaDaPagina = async () => /data-tema="([^"]+)"/.exec(renderToStaticMarkup(await SegurancaPage()))?.[1];

describe('/conta/seguranca: tema da conta (D17)', () => {
  it.each(['claro', 'escuro', 'sistema'])('nutricionista com tema %s → data-tema igual', async (tema) => {
    usuario.atual = { appRole: 'nutri', tema, twoFactorEnabled: false };
    expect(await temaDaPagina()).toBe(tema);
  });
  it('valor fora da lista → "sistema" (o padrão do painel)', async () => {
    usuario.atual = { appRole: 'nutri', tema: 'roxo', twoFactorEnabled: true };
    expect(await temaDaPagina()).toBe('sistema');
  });
  it('admin: claro, como a área do admin (que não tem tema)', async () => {
    usuario.atual = { appRole: 'admin', tema: 'escuro', twoFactorEnabled: false };
    expect(await temaDaPagina()).toBe('claro');
  });
});

describe('/conta/seguranca: ajuda na própria tela (D18, Plano 10A)', () => {
  it.each([false, true])('2FA ativo = %s → "Como funciona" com o resumo do guia', async (twoFactorEnabled) => {
    usuario.atual = { appRole: 'nutri', tema: 'claro', twoFactorEnabled };
    const html = renderToStaticMarkup(await SegurancaPage());
    expect(html).toContain('<summary');
    expect(html).toContain('Como funciona');
    expect(html).toContain('Ela é obrigatória para assinar documentos.');
    expect(html).toContain('Depois de 5 códigos errados, espere 15 minutos para tentar de novo.');
  });
});

describe('/conta/seguranca: recepção (Plano 26, RE-D45, RN-500)', () => {
  it('a página aceita a recepção (a lista de papéis tem `recepcao`)', async () => {
    const { requireUser } = await import('@/lib/session');
    usuario.atual = { appRole: 'recepcao', tema: 'claro', twoFactorEnabled: true };
    await SegurancaPage();
    expect(vi.mocked(requireUser).mock.lastCall?.[0]).toEqual(expect.arrayContaining(['admin', 'nutri', 'recepcao']));
  });
  it.each(['claro', 'escuro', 'sistema'])('tema da conta, como a nutricionista (%s)', async (tema) => {
    usuario.atual = { appRole: 'recepcao', tema, twoFactorEnabled: true };
    expect(await temaDaPagina()).toBe(tema);
  });
  it('sem 2FA: o aviso do 2FA obrigatório (como o do admin); com 2FA, sem aviso', async () => {
    usuario.atual = { appRole: 'recepcao', tema: 'claro', twoFactorEnabled: false };
    const sem = renderToStaticMarkup(await SegurancaPage());
    expect(sem).toContain('A recepção precisa da verificação em duas etapas. Configure agora para continuar.');
    expect(sem).toContain('role="alert"');
    usuario.atual = { appRole: 'recepcao', tema: 'claro', twoFactorEnabled: true };
    expect(renderToStaticMarkup(await SegurancaPage())).not.toContain('A recepção precisa');
    usuario.atual = { appRole: 'nutri', tema: 'claro', twoFactorEnabled: false };
    expect(renderToStaticMarkup(await SegurancaPage())).not.toContain('A recepção precisa');
  });
});
