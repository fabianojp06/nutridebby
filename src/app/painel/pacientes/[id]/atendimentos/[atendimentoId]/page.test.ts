import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta } from '../../../../../../../test/agenda';
import { makeDb } from '../../../../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../../../test/pacientes';

/**
 * US-303 (Plano 20, T7, F-D13): "Registrar atendimento" ligado a uma consulta que não era "Realizada" gera a cobrança, e a
 * página do atendimento diz o que aconteceu (`?ok=atendimento&cobranca=…`, só com consulta e resultado). O valor vem da
 * própria cobrança, nunca da URL.
 */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { default: AtendimentoPage } = await import('./page');
const { registrarAtendimentoAction } = await import('../actions');
const { closeDb } = await import('@/db/client');
const { salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { MSG_FINANCEIRO: M } = await import('@/modules/financeiro/constantes');
const { formatarReais } = await import('@/modules/financeiro/dinheiro');
const { hojeNoFuso } = await import('@/modules/pacientes/datas');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});

type Cenario = TenantDeTeste & { p: string; c: string };
async function cenario(o: { configurar?: boolean; status?: 'faltou' | 'realizada' } = {}): Promise<Cenario> {
  const T = await novoTenant(app.db);
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant } };
  if (o.configurar !== false)
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-01-01', saldoInicial: '0', valorConsulta: '250,00' }, { db: app.db });
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  const c = await consultaDireta(app.db, T.ctx, p, new Date(Date.now() - 3_600_000), 30, { status: o.status ?? 'faltou' });
  return { ...T, p, c };
}
const formulario = (C: Cenario, appointmentId: string) => {
  const fd = new FormData();
  fd.set('data', hojeNoFuso(C.tenant.fuso));
  fd.set('notasPrivadas', '');
  fd.set('orientacoes', '');
  fd.set('appointmentId', appointmentId);
  return fd;
};
const registrar = (C: Cenario, appointmentId: string) =>
  registrarAtendimentoAction(C.p, {}, formulario(C, appointmentId)).then(
    (r) => {
      throw new Error(`devia redirecionar: ${JSON.stringify(r)}`);
    },
    (e: Error) => e.message.replace(/^redirect /, ''),
  );
const pagina = async (C: Cenario, atendimentoId: string, sp: Record<string, string>) =>
  renderToStaticMarkup(
    await AtendimentoPage({ params: Promise.resolve({ id: C.p, atendimentoId }), searchParams: Promise.resolve(sp) } as never),
  );
const texto = (html: string) => html.replace(/<[^>]+>/g, '');
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idDa = (url: string) => /\/atendimentos\/([0-9a-f-]{36})/.exec(url)![1];

describe('registrarAtendimentoAction + a página do atendimento (US-303, §6.2)', () => {
  it('ligado a consulta "faltou" → ?ok=atendimento&cobranca=criada; a página diz o valor da cobrança na região de status', async () => {
    const C = await cenario();
    const url = await registrar(C, C.c);
    expect(url).toMatch(new RegExp(`^/painel/pacientes/${C.p}/atendimentos/[0-9a-f-]{36}\\?ok=atendimento&cobranca=criada$`));
    const html = await pagina(C, idDa(url), { ok: 'atendimento', cobranca: 'criada' });
    expect(html).toMatch(new RegExp(`<p role="status"[^>]*>${escapar(M.atendimento.criada(formatarReais(25000)))}</p>`));
  });

  it('sem o valor da consulta → cobranca=sem_valor; o texto com o link para as configurações', async () => {
    const C = await cenario({ configurar: false });
    const url = await registrar(C, C.c);
    expect(url).toMatch(/\?ok=atendimento&cobranca=sem_valor$/);
    const html = await pagina(C, idDa(url), { ok: 'atendimento', cobranca: 'sem_valor' });
    const t = M.atendimento.semValor;
    expect(texto(html)).toContain(`${t.antes}${t.link}${t.depois}`);
    expect(html).toMatch(new RegExp(`<a [^>]*href="/painel/financeiro/configuracoes"[^>]*>${t.link}</a>`));
  });

  it('consulta já "realizada" ou atendimento sem consulta → a URL termina no id; sem a query, nenhuma mensagem', async () => {
    const C = await cenario({ status: 'realizada' });
    const ligado = await registrar(C, C.c);
    expect(ligado).toMatch(/\/atendimentos\/[0-9a-f-]{36}$/);
    const solto = await registrar(C, '');
    expect(solto).toMatch(/\/atendimentos\/[0-9a-f-]{36}$/);
    const html = await pagina(C, idDa(solto), {});
    expect(texto(html)).not.toContain('Atendimento registrado.');
    expect(html).not.toContain('role="status"');
  });

  it('ja_existia ou bloqueado: sem mensagem do Financeiro; resultado desconhecido também não', async () => {
    const C = await cenario();
    const url = await registrar(C, C.c);
    for (const cobranca of ['ja_existia', 'bloqueado', 'qualquer'])
      expect(texto(await pagina(C, idDa(url), { ok: 'atendimento', cobranca }))).not.toContain('Atendimento registrado.');
  });
});
