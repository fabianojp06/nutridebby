import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { consents, tenants, user } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { requireUserComTenant } from '@/lib/session';
import { textoOutroPapel } from '@/lib/session-rules';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { MSG_EQUIPE, MSG_RECEPCAO } from '@/modules/plataforma/equipe-textos';
import { MSG_TEXTO_ATUALIZADO, SIGILO_EQUIPE_TERMO, SIGILO_EQUIPE_VERSAO } from '@/modules/plataforma/textos-versionados';
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
vi.mock('./acesso-desativado/aceite-do-termo', () => ({
  AceiteDoTermo: ({ rotulo, botao, versao }: { rotulo: string; botao: string; versao: string }) => `[AceiteDoTermo ${rotulo} | ${botao} | ${versao}]`,
}));
const { default: OutroPapel } = await import('./outro-papel/page');
const { default: Seguranca } = await import('./seguranca/page');
const { default: AcessoDesativado } = await import('./acesso-desativado/page');
const { aceitarTermoAction } = await import('./acesso-desativado/actions');

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
  it('revisão da P26-07 (RN-500): ativa, com senha, mas sem o aceite do termo — nenhuma tela abre; sem o 2FA, o aviso próprio, sem formulário', async () => {
    await recepcao({ semTermo: true, twoFactorEnabled: false });
    await expect(Seguranca()).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
    await expect(OutroPapel({ searchParams: Promise.resolve({ esperado: 'paciente' }) } as never)).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
    const h = await html(AcessoDesativado());
    expect(h).toContain('Seu acesso ainda não foi liberado: falta aceitar o Termo de confidencialidade da equipe. Fale com a nutricionista.');
    expect(h).not.toContain('foi desativado');
    expect(h).not.toContain('[AceiteDoTermo');
  });
  it('recepção ativa e a nutricionista não têm o que fazer aqui: vão ao painel', async () => {
    const r = await recepcao();
    await expect(AcessoDesativado()).rejects.toMatchObject({ url: '/painel' });
    req.headers = new Headers({ cookie: r.nutri.cookie });
    await expect(AcessoDesativado()).rejects.toMatchObject({ url: '/painel' });
  });
});

/**
 * Revisão do code review do PR 2 do Plano 26 (RN-500): o termo numa versão nova não tranca a recepção — a conta ativa, com o
 * 2FA e sem o aceite da versão em vigor, aceita em /conta/acesso-desativado. A action confere tudo de novo, no servidor.
 */
describe('/conta/acesso-desativado: o aceite da versão em vigor do termo (RN-500)', () => {
  const VERSAO_ANTIGA = 'sigilo-equipe-0.9';
  const form = (o: { versao?: string; sigilo?: boolean } = {}) => {
    const f = new FormData();
    f.set('versao', o.versao ?? SIGILO_EQUIPE_VERSAO);
    if (o.sigilo ?? true) f.set('sigilo', 'on');
    return f;
  };
  const aceites = (userId: string) =>
    db.select({ termo: consents.termoVersao, tenantId: consents.tenantId }).from(consents).where(eq(consents.userId, userId)).orderBy(consents.termoVersao);
  async function comVersaoAntiga(o: Parameters<typeof recepcaoComLogin>[3] = {}) {
    const r = await recepcao({ ...o, semTermo: true });
    const [u] = await db.select({ tenantId: user.tenantId }).from(user).where(eq(user.id, r.id));
    await db.insert(consents).values({ userId: r.id, tenantId: u.tenantId, termoVersao: VERSAO_ANTIGA, ip: null });
    return { ...r, tenantId: u.tenantId! };
  }

  it('ativa, com a versão antiga aceita: vê o termo inteiro, a caixa do convite e o botão; aceita, grava a versão em vigor e o painel abre', async () => {
    const r = await comVersaoAntiga();
    await expect(requireUserComTenant(['nutri', 'recepcao'], '/painel')).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
    const h = await html(AcessoDesativado());
    expect(h).toMatch(new RegExp(`<h1[^>]*>${MSG_RECEPCAO.acessoDesativado.aceiteDoTermo.titulo}</h1>`));
    expect(h).toContain(MSG_RECEPCAO.acessoDesativado.aceiteDoTermo.texto);
    expect(h).toMatch(/<h2 id="sigilo-titulo"[^>]*>Termo de confidencialidade da equipe<\/h2>/);
    expect(h).toContain('2. O que é confidencial.');
    expect(h).toContain(`[AceiteDoTermo ${MSG_EQUIPE.convite.rotuloTermo} | ${MSG_RECEPCAO.acessoDesativado.aceiteDoTermo.botao} | ${SIGILO_EQUIPE_VERSAO}]`);
    expect(h).toContain('[BotaoSair inline-flex min-h-11 items-center rounded-full border border-campo px-4]');
    expect(h).not.toContain('Fale com a nutricionista');

    await expect(aceitarTermoAction({}, form())).rejects.toMatchObject({ url: '/painel' });
    expect(await aceites(r.id)).toEqual([
      { termo: VERSAO_ANTIGA, tenantId: r.tenantId },
      { termo: SIGILO_EQUIPE_TERMO, tenantId: r.tenantId },
    ]);
    // a sessão passa: o painel abre, e a página do aviso manda ao painel
    await expect(requireUserComTenant(['nutri', 'recepcao'], '/painel')).resolves.toMatchObject({ membro: { ativo: true, termoAceito: true } });
    await expect(AcessoDesativado()).rejects.toMatchObject({ url: '/painel' });
    // de novo (outra aba): nada a gravar, o painel
    await expect(aceitarTermoAction({}, form())).rejects.toMatchObject({ url: '/painel' });
    expect(await aceites(r.id)).toHaveLength(2);
  });

  it('sem a caixa → a mensagem do convite; a versão da página diferente da em vigor → o texto mudou; nada gravado', async () => {
    const r = await comVersaoAntiga();
    await expect(aceitarTermoAction({}, form({ sigilo: false }))).resolves.toEqual({ erro: MSG_EQUIPE.convite.termoNaoAceito });
    await expect(aceitarTermoAction({}, form({ versao: '0.9' }))).resolves.toEqual({ erro: MSG_TEXTO_ATUALIZADO });
    const f = new FormData();
    f.set('sigilo', 'on');
    await expect(aceitarTermoAction({}, f)).resolves.toEqual({ erro: MSG_TEXTO_ATUALIZADO });
    expect(await aceites(r.id)).toEqual([{ termo: VERSAO_ANTIGA, tenantId: r.tenantId }]);
  });

  it('desativada de verdade (desativada_em): só o aviso de desativada, sem formulário, e a action recusa', async () => {
    const r = await comVersaoAntiga({ desativada: true });
    const h = await html(AcessoDesativado());
    expect(h).toMatch(/<h1[^>]*>Acesso desativado<\/h1>/);
    expect(h).toContain(MSG_RECEPCAO.acessoDesativado.texto);
    expect(h).not.toContain('[AceiteDoTermo');
    expect(h).not.toContain('sigilo-titulo');
    await expect(aceitarTermoAction({}, form())).resolves.toEqual({ erro: MSG_RECEPCAO.acessoDesativado.texto });
    expect(await aceites(r.id)).toEqual([{ termo: VERSAO_ANTIGA, tenantId: r.tenantId }]);
    await expect(requireUserComTenant(['nutri', 'recepcao'], '/painel')).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
  });

  it('ativa sem o 2FA: a action recusa (o POST direto também), com o aviso do termo pendente', async () => {
    const r = await comVersaoAntiga({ twoFactorEnabled: false });
    await expect(aceitarTermoAction({}, form())).resolves.toEqual({ erro: MSG_RECEPCAO.acessoDesativado.termoPendente });
    expect(await aceites(r.id)).toEqual([{ termo: VERSAO_ANTIGA, tenantId: r.tenantId }]);
  });

  it('outro papel (a nutricionista do consultório): a sessão recusa e nada é gravado', async () => {
    const r = await comVersaoAntiga();
    req.headers = new Headers({ cookie: r.nutri.cookie });
    await expect(aceitarTermoAction({}, form())).rejects.toBeInstanceOf(Redirect);
    await expect(aceitarTermoAction({}, form())).rejects.not.toMatchObject({ url: '/painel' });
    expect(await db.select({ id: consents.id }).from(consents).where(and(eq(consents.userId, r.nutri.id), eq(consents.termoVersao, SIGILO_EQUIPE_TERMO)))).toEqual([]);
    expect(await aceites(r.id)).toEqual([{ termo: VERSAO_ANTIGA, tenantId: r.tenantId }]);
  });
});
