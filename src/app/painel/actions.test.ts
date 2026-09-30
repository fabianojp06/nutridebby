import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from '../../../test/sessao';

// T10-R2: salvarPerfilAction pelo caminho real (requireNutri → Postgres via Testcontainers); só o
// que depende do runtime do Next é simulado (headers da requisição), como em src/lib/session.test.ts.
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { salvarPerfilAction } = await import('./actions');

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
  it('em erro de validação, endereço e link intencionalmente limpos continuam vazios (não voltam o valor salvo no banco)', async () => {
    await nutriLogado();
    const fd = form({ ...CAMPOS_VALIDOS, crn: 'ruim', enderecoConsultorio: '', linkOnlinePadrao: '' }); // crn inválido força o erro
    const state = await salvarPerfilAction({}, fd);
    expect(state.erros?.crn).toBe('CRN inválido. Ex.: CRN-3 12345');
    expect(state.valores?.enderecoConsultorio).toBe('');
    expect(state.valores?.linkOnlinePadrao).toBe('');
  });

  it('em erro, o checkbox desmarcado volta como \'\' em state.valores (não o valor salvo no banco)', async () => {
    await nutriLogado(); // tenant nasce com agendamentoPublicoAtivo = true
    const fd = form({ ...CAMPOS_VALIDOS, crn: 'ruim', enderecoConsultorio: 'Rua Nova, 2', linkOnlinePadrao: '' });
    // agendamentoPublicoAtivo não é setado no FormData — equivale ao checkbox desmarcado no submit
    const state = await salvarPerfilAction({}, fd);
    expect(state.erros?.crn).toBeDefined();
    expect(state.valores?.agendamentoPublicoAtivo).toBe('');
  });

  it('em erro, o checkbox marcado volta como \'on\' em state.valores', async () => {
    await nutriLogado();
    const fd = form({ ...CAMPOS_VALIDOS, crn: 'ruim', enderecoConsultorio: '', linkOnlinePadrao: '' });
    fd.set('agendamentoPublicoAtivo', 'on');
    const state = await salvarPerfilAction({}, fd);
    expect(state.erros?.crn).toBeDefined();
    expect(state.valores?.agendamentoPublicoAtivo).toBe('on');
  });
});
