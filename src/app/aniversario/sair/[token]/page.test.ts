import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { novoPaciente, novoTenant } from '../../../../../test/pacientes';
import { closeDb } from '@/db/client';
import { aniversarioAutorizacoes, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { assinarLinkDeSaida } from '@/modules/agenda/aniversario-link';

/** Plano 23 (RN-434, US-414 "Pelo link do e-mail", AG-D71): a página de saída — o GET mostra e não grava. */
vi.mock('@serwist/turbopack', () => ({ withSerwist: <T,>(c: T) => c })); // só a configuração do Next

const { default: PaginaDeSaida, metadata } = await import('./page');
const { default: nextConfig } = await import('../../../../../next.config');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});
const render = async (token: string, searchParams: Record<string, string> = {}) =>
  renderToStaticMarkup(await PaginaDeSaida({ params: Promise.resolve({ token }), searchParams: Promise.resolve(searchParams) } as never));

async function autorizada(nome = 'Consultório Debby') {
  const T = await novoTenant(app.db, nome);
  const ana = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-20' });
  await withTenant(T.ctx, (tx) => tx.insert(aniversarioAutorizacoes).values({ tenantId: T.tenantId, patientId: ana.id, evento: 'autorizou', origem: 'nutri', forma: 'escrito', registradoPor: T.nutriId }), app.db);
  const linhas = () => withTenant(T.ctx, (tx) => tx.select().from(aniversarioAutorizacoes).where(eq(aniversarioAutorizacoes.patientId, ana.id)), app.db);
  return { T, ana, token: assinarLinkDeSaida({ tenantId: T.tenantId, patientId: ana.id }), linhas };
}

describe('/aniversario/sair/[token]', () => {
  it('GET: h1 "Mensagens de aniversário", a pergunta com o nome da nutricionista e "Confirmar" num formulário POST para a rota — sem gravar nada', async () => {
    const { T, token, linhas } = await autorizada();
    await app.db.update(tenants).set({ nomeProfissional: 'Débora Silva' }).where(eq(tenants.id, T.tenantId));
    const html = await render(token);
    expect(html).toMatch(/<h1[^>]*>Mensagens de aniversário<\/h1>/);
    expect(html).toContain('Você não quer mais receber mensagens de aniversário de Débora Silva?');
    expect(html).toMatch(new RegExp(`<form[^>]*method="post"[^>]*action="/api/aniversario/sair/${token}"|<form[^>]*action="/api/aniversario/sair/${token}"[^>]*method="post"`));
    expect(html).toMatch(/<input[^>]*name="origem"[^>]*value="pagina"|<input[^>]*value="pagina"[^>]*name="origem"/);
    expect(html).toMatch(/<button[^>]*>Confirmar<\/button>/);
    // o GET (leitores de link, pré-visualização) não grava
    await render(token);
    expect(await linhas()).toHaveLength(1);
  });

  it('?ok=1 depois da retirada: "Pronto. Você não vai mais receber mensagens de aniversário." numa região de status, sem formulário', async () => {
    const { T, ana, token } = await autorizada();
    await withTenant({ tenantId: T.tenantId, role: 'paciente', patientId: ana.id, semConta: true }, (tx) => tx.insert(aniversarioAutorizacoes).values({ tenantId: T.tenantId, patientId: ana.id, evento: 'retirou', origem: 'link' }), app.db);
    const html = await render(token, { ok: '1' });
    expect(html).toMatch(/role="status"[^>]*>Pronto\. Você não vai mais receber mensagens de aniversário\.</);
    expect(html).not.toContain('<form');
  });

  it('?ok=1 sem a retirada (URL digitada): mostra a pergunta de novo, nunca o "Pronto."', async () => {
    const { token } = await autorizada();
    const html = await render(token, { ok: '1' });
    expect(html).not.toContain('Pronto.');
    expect(html).toContain('<form');
  });

  it('token inválido: "Este link não é válido." sem formulário; ?erro=limite: "Muitas tentativas. Tente novamente mais tarde."', async () => {
    const i = await render('x'.repeat(66));
    expect(i).toMatch(/role="alert"[^>]*>Este link não é válido\.</);
    expect(i).not.toContain('<form');
    const { token } = await autorizada();
    expect(await render(token, { erro: 'limite' })).toContain('Muitas tentativas. Tente novamente mais tarde.');
  });

  it('metadados: sem Referer e fora dos buscadores; next.config.ts com no-referrer + no-store na página, depois da regra /:path* (AG-D71)', async () => {
    expect(metadata).toMatchObject({ title: 'Mensagens de aniversário', referrer: 'no-referrer', robots: { index: false, follow: false } });
    const regras = await nextConfig.headers!();
    const geral = regras.findIndex((r) => r.source === '/:path*');
    const i = regras.findIndex((r) => r.source === '/aniversario/sair/:token*');
    expect(i).toBeGreaterThan(geral);
    expect(regras[i].headers).toEqual(expect.arrayContaining([{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }]));
  });
});
