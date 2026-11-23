import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants, user } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { textoOutroPapel } from '@/lib/session-rules';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { recepcaoComLogin } from '../../../test/equipe';
import { criarEEntrar } from '../../../test/sessao';

/**
 * Plano 26 (RE-D45, RE-D67, RN-500, RN-503): as telas de /conta com a recepção, pelo caminho real da sessão (Better Auth +
 * Postgres do Testcontainers). Só o runtime do Next é simulado (cabeçalhos e redirect) e os componentes de cliente.
 */
const req = vi.hoisted(() => ({ headers: new Headers() }));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
// o alvo do "Sair" fica no rótulo (44 px, como no cabeçalho do painel)
vi.mock('@/components/botao-sair', () => ({ BotaoSair: ({ className }: { className?: string }) => `[BotaoSair ${className ?? ''}]` }));
vi.mock('@/app/p/sair-portal', () => ({ SairPortal: () => '[SairPortal]' }));
vi.mock('./seguranca/enable-2fa', () => ({ Enable2fa: () => '[Enable2fa]' }));
const { default: OutroPapel } = await import('./outro-papel/page');
const { default: Seguranca } = await import('./seguranca/page');
const { default: AcessoDesativado } = await import('./acesso-desativado/page');

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

async function recepcao(o: Parameters<typeof recepcaoComLogin>[3] = {}) {
  const [t] = await db.insert(tenants).values({ slug: `cr-${randomUUID().slice(0, 8)}`, nomeExibicao: 'CR' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  const r = await recepcaoComLogin(db, auth, t.id, o);
  req.headers = new Headers({ cookie: r.cookie });
  return { ...r, nutri: n };
}
const html = async (p: Promise<Parameters<typeof renderToStaticMarkup>[0]>) => renderToStaticMarkup(await p);

describe('/conta/outro-papel com a recepção (RE-D67)', () => {
  it('numa tela do paciente: o texto com "recepção", "Ir para o painel" e o tema da conta, como a nutricionista', async () => {
    const r = await recepcao();
    await db.update(user).set({ tema: 'escuro' }).where(eq(user.id, r.id));
    const h = await html(OutroPapel({ searchParams: Promise.resolve({ esperado: 'paciente' }) } as never));
    expect(h).toContain(textoOutroPapel('recepcao', 'paciente'));
    expect(h).toMatch(/<a href="\/painel"[^>]*>Ir para o painel<\/a>/);
    expect(h).toContain('data-tema="escuro"');
    expect(h).toContain('[BotaoSair inline-flex min-h-11 items-center rounded-full border border-campo px-4]');
  });
  it('sem papel esperado (ou o próprio) → o painel', async () => {
    await recepcao();
    await expect(OutroPapel({ searchParams: Promise.resolve({ esperado: 'recepcao' }) } as never)).rejects.toMatchObject({ url: '/painel' });
  });
});

describe('/conta/seguranca com a recepção (RE-D45, RN-500)', () => {
  it('sem 2FA: abre, com o aviso do 2FA obrigatório', async () => {
    await recepcao({ twoFactorEnabled: false });
    const h = await html(Seguranca());
    expect(h).toContain('A recepção precisa da verificação em duas etapas. Configure agora para continuar.');
    expect(h).toContain('[Enable2fa]');
    expect(h).toContain('[BotaoSair inline-flex min-h-11 items-center rounded-full border border-campo px-4]');
  });
  it('desativada → /conta/acesso-desativado (também sem 2FA)', async () => {
    await recepcao({ desativada: true });
    await expect(Seguranca()).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
    await recepcao({ desativada: true, twoFactorEnabled: false });
    await expect(Seguranca()).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
  });
});

describe('/conta/acesso-desativado (RN-503)', () => {
  it('desativada: "Acesso desativado", o texto da §6.2 e "Sair"', async () => {
    await recepcao({ desativada: true, twoFactorEnabled: false });
    const h = await html(AcessoDesativado());
    expect(h).toMatch(/<h1[^>]*>Acesso desativado<\/h1>/);
    expect(h).toContain('Seu acesso a este consultório foi desativado. Fale com a nutricionista.');
    expect(h).toContain('[BotaoSair inline-flex min-h-11 items-center rounded-full border border-campo px-4]');
  });
  it('revisão da P26-07 (RN-500): ativa, com senha e 2FA, mas sem o aceite do termo — nenhuma tela abre; o aviso próprio', async () => {
    await recepcao({ semTermo: true });
    await expect(Seguranca()).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
    await expect(OutroPapel({ searchParams: Promise.resolve({ esperado: 'paciente' }) } as never)).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
    const h = await html(AcessoDesativado());
    expect(h).toContain('Seu acesso ainda não foi liberado: falta aceitar o Termo de confidencialidade da equipe. Fale com a nutricionista.');
    expect(h).not.toContain('foi desativado');
  });
  it('recepção ativa e a nutricionista não têm o que fazer aqui: vão ao painel', async () => {
    const r = await recepcao();
    await expect(AcessoDesativado()).rejects.toMatchObject({ url: '/painel' });
    req.headers = new Headers({ cookie: r.nutri.cookie });
    await expect(AcessoDesativado()).rejects.toMatchObject({ url: '/painel' });
  });
});
