import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { termoAceito } from '@/modules/portal/termo';
import { consents } from '@/db/schema';
import { MSG_TEXTO_ATUALIZADO } from '@/modules/plataforma/textos-versionados';
import { TERMO_PACIENTE_MUDOU } from '@/modules/pacientes/termo-paciente';
import { novoTenant } from '../../../../test/pacientes';
import { pacienteComConta } from '../../../../test/portal';
import { entrar } from '../../../../test/sessao';

// S-1 (débitos pré-go-live): o aceite do termo volta ao destino que levou ao termo (link da exportação, push), não
// sempre ao Início — no go-live o termo novo (P08-06) leva todos os pacientes a /p/termo.
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers, cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));
vi.mock('./termo-form', () => ({ TermoForm: ({ volta }: { volta: string }) => `[TermoForm volta=${volta}]` }));

const { aceitarTermoAction } = await import('./actions');
const { default: NovoTermo } = await import('./page');
const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

async function semTermo() {
  const A = await novoTenant(db);
  const { userId, email } = await pacienteComConta(db, A, { semTermo: true });
  req.headers = new Headers({ cookie: await entrar(getAuth(), email), 'x-nd-caminho': '/p/termo' });
  return { A, userId };
}
const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

describe('/p/termo com ?volta= (S-1)', () => {
  it('o aceite volta ao destino (sem o ?v=); sem marcar, fica no termo com a mensagem', async () => {
    const { A, userId } = await semTermo();
    expect(await aceitarTermoAction({}, form({ volta: '/p/meus-dados/exportacoes/abc' }))).toEqual({ erro: 'Para continuar, aceite o Termo de Uso e Privacidade.' });
    await expect(aceitarTermoAction({}, form({ aceite: 'on', versao: '1.0', volta: `/p/meus-dados/exportacoes/abc?v=${A.tenantId}` }))).rejects.toMatchObject({
      url: '/p/meus-dados/exportacoes/abc',
    });
    expect(await termoAceito(userId, A.tenantId)).toBe(true);
  });

  it('volta insegura, fora do portal ou a própria tela do termo → Início', async () => {
    for (const volta of ['//evil.example/p/x', 'https://evil.example', '/painel', '/p/termo?volta=%2Fp%2Fplano', '']) {
      await semTermo();
      await expect(aceitarTermoAction({}, form({ aceite: 'on', versao: '1.0', volta })), volta).rejects.toMatchObject({ url: '/p/inicio' });
    }
  });

  it('a página leva o destino ao formulário; termo já aceito → vai direto ao destino', async () => {
    await semTermo();
    const html = renderToStaticMarkup(await NovoTermo({ searchParams: Promise.resolve({ volta: '/p/diario' }) } as never));
    expect(html).toContain('[TermoForm volta=/p/diario]');
    expect(renderToStaticMarkup(await NovoTermo({ searchParams: Promise.resolve({}) } as never))).toContain('[TermoForm volta=/p/inicio]');
    await aceitarTermoAction({}, form({ aceite: 'on', versao: '1.0', volta: '/p/diario' })).catch(() => undefined);
    await expect(NovoTermo({ searchParams: Promise.resolve({ volta: '/p/diario' }) } as never)).rejects.toMatchObject({ url: '/p/diario' });
  });
});

describe('/p/termo e a versão lida (P08-06)', () => {
  it('a página aberta com outra versão (deploy no meio) não grava aceite: pede para recarregar', async () => {
    const { A, userId } = await semTermo();
    for (const versao of ['0.1-provisorio', '']) {
      expect(await aceitarTermoAction({}, form({ aceite: 'on', versao, volta: '/p/diario' }))).toEqual({ erro: MSG_TEXTO_ATUALIZADO });
    }
    expect(await termoAceito(userId, A.tenantId)).toBe(false);
  });

  it('"O termo mudou" só para quem aceitou uma versão anterior neste consultório', async () => {
    const { A, userId } = await semTermo();
    expect(renderToStaticMarkup(await NovoTermo({ searchParams: Promise.resolve({}) } as never))).not.toContain('O termo mudou');
    await db.insert(consents).values({ userId, tenantId: A.tenantId, termoVersao: 'termo-paciente-0.1-provisorio', ip: null });
    expect(renderToStaticMarkup(await NovoTermo({ searchParams: Promise.resolve({}) } as never))).toContain(TERMO_PACIENTE_MUDOU);
  });
});
