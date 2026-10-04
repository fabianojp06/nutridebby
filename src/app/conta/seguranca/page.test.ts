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
