import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { closeDb, getDb } from '@/db/client';
import { consents, tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from '../../../test/sessao';

// T10-R2: salvarPerfilAction pelo caminho real (requireNutri → Postgres via Testcontainers); só o
// que depende do runtime do Next é simulado (headers da requisição), como em src/lib/session.test.ts.
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { aceitarDpaAction, salvarPerfilAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

async function nutriLogado() {
  const [t] = await db
    .insert(tenants)
    .values({
      slug: `perfil-${randomUUID().slice(0, 8)}`,
      nomeExibicao: 'Perfil',
      enderecoConsultorio: 'Rua Antiga, 1',
      linkOnlinePadrao: 'https://antigo.exemplo.com',
      agendamentoPublicoAtivo: true,
    })
    .returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  req.headers = new Headers({ cookie: n.cookie });
  return t;
}

const form = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const CAMPOS_VALIDOS = {
  nomeExibicao: 'Debby Silva',
  corPrimaria: '#2E7D32',
  antecedenciaMinH: '12',
  cancelamentoMinH: '24',
  fuso: 'America/Sao_Paulo',
};

describe('salvarPerfilAction (T10-R2, PF-N9)', () => {
  it('em erro de validação, o endereço intencionalmente limpo continua vazio (não volta o valor salvo no banco)', async () => {
    await nutriLogado();
    const fd = form({ ...CAMPOS_VALIDOS, crn: 'ruim', enderecoConsultorio: '' }); // crn inválido força o erro
    const state = await salvarPerfilAction({}, fd);
    expect(state.erros?.crn).toBe('CRN inválido. Ex.: CRN-3 12345');
    expect(state.valores?.enderecoConsultorio).toBe('');
  });

  it('em erro, o checkbox desmarcado volta como \'\' em state.valores (não o valor salvo no banco)', async () => {
    await nutriLogado(); // tenant nasce com agendamentoPublicoAtivo = true
    const fd = form({ ...CAMPOS_VALIDOS, crn: 'ruim', enderecoConsultorio: 'Rua Nova, 2' });
    // agendamentoPublicoAtivo não é setado no FormData — equivale ao checkbox desmarcado no submit
    const state = await salvarPerfilAction({}, fd);
    expect(state.erros?.crn).toBeDefined();
    expect(state.valores?.agendamentoPublicoAtivo).toBe('');
  });

  it('em erro, o checkbox marcado volta como \'on\' em state.valores', async () => {
    await nutriLogado();
    const fd = form({ ...CAMPOS_VALIDOS, crn: 'ruim', enderecoConsultorio: '' });
    fd.set('agendamentoPublicoAtivo', 'on');
    const state = await salvarPerfilAction({}, fd);
    expect(state.erros?.crn).toBeDefined();
    expect(state.valores?.agendamentoPublicoAtivo).toBe('on');
  });

  it('fechamento do Plano 05 (migration 0067): tenant novo nasce com a página pública desligada; a nutricionista liga em Configurações', async () => {
    const [t] = await db.insert(tenants).values({ slug: `nova-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Nova' }).returning();
    expect(t.agendamentoPublicoAtivo).toBe(false);
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
    req.headers = new Headers({ cookie: n.cookie });
    const fd = form({ ...CAMPOS_VALIDOS, crn: 'CRN-3 12345', enderecoConsultorio: '' });
    fd.set('agendamentoPublicoAtivo', 'on');
    expect(await salvarPerfilAction({}, fd)).toEqual({ ok: true });
    expect((await db.select({ ativo: tenants.agendamentoPublicoAtivo }).from(tenants).where(eq(tenants.id, t.id)))[0].ativo).toBe(true);
  });
});

describe('salvarPerfilAction sem o link padrão (Plano 23, AG-D7)', () => {
  it('salvar o Perfil não lê nem grava link_online_padrao: o valor antigo continua no banco', async () => {
    const t = await nutriLogado(); // link antigo: https://antigo.exemplo.com
    const fd = form({ ...CAMPOS_VALIDOS, crn: 'CRN-3 12345', enderecoConsultorio: 'Rua Nova, 3', linkOnlinePadrao: 'https://novo.exemplo.com' });
    expect(await salvarPerfilAction({}, fd)).toEqual({ ok: true });
    const [r] = await db.select({ link: tenants.linkOnlinePadrao, endereco: tenants.enderecoConsultorio }).from(tenants).where(eq(tenants.id, t.id));
    expect(r).toEqual({ link: 'https://antigo.exemplo.com', endereco: 'Rua Nova, 3' });
    // em erro, o campo não volta em `valores` (a tela não tem mais o campo)
    const erro = await salvarPerfilAction({}, form({ ...CAMPOS_VALIDOS, crn: 'ruim', linkOnlinePadrao: 'http://x' }));
    expect(erro.erros).toEqual({ crn: 'CRN inválido. Ex.: CRN-3 12345' });
    expect(erro.valores).not.toHaveProperty('linkOnlinePadrao');
  });
});

describe('aceitarDpaAction (T14)', () => {
  it('revalida o layout do painel antes de ir ao início: o cabeçalho mínimo vira o completo sem recarregar', async () => {
    const [t] = await db.insert(tenants).values({ slug: `dpa-${randomUUID().slice(0, 8)}`, nomeExibicao: 'DPA' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    req.headers = new Headers({ cookie: n.cookie });
    vi.mocked(revalidatePath).mockClear();
    await expect(aceitarDpaAction({}, form({ dpa: 'on', versao: '1.1' }))).rejects.toThrow('redirect /painel');
    expect(revalidatePath).toHaveBeenCalledWith('/painel', 'layout');
    const [depois] = await db.select({ dpaVersao: tenants.dpaVersao }).from(tenants).where(eq(tenants.id, t.id));
    expect(depois.dpaVersao).toBe('1.1');
    // US-309: o aceite fica em consents ("dpa-1.1")
    expect((await db.select({ termo: consents.termoVersao }).from(consents).where(eq(consents.userId, n.id))).map((c) => c.termo)).toEqual(['dpa-1.1']);
  });

  it('P08-06: a página aberta com outra versão do DPA (deploy no meio) não grava aceite: pede para recarregar', async () => {
    const [t] = await db.insert(tenants).values({ slug: `dpa-${randomUUID().slice(0, 8)}`, nomeExibicao: 'DPA' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    req.headers = new Headers({ cookie: n.cookie });
    expect(await aceitarDpaAction({}, form({ dpa: 'on', versao: '1.0' }))).toEqual({
      erro: 'O texto mudou enquanto esta página estava aberta. Recarregue a página, leia a versão nova e aceite de novo.',
    });
    const [depois] = await db.select({ dpaVersao: tenants.dpaVersao }).from(tenants).where(eq(tenants.id, t.id));
    expect(depois.dpaVersao).toBeNull();
  });
});
