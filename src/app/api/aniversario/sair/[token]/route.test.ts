import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../../test/pacientes';
import { closeDb } from '@/db/client';
import { aniversarioAutorizacoes } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { assinarLinkDeSaida } from '@/modules/agenda/aniversario-link';
import { LIMITE_SAIDA_POR_HORA } from '@/modules/agenda/aniversarios';

/**
 * Plano 23 (RN-434, AG-D51, AG-D71): o POST de um clique (RFC 8058) que o provedor de e-mail faz na URL do
 * `List-Unsubscribe`, sem cookie e de outra origem, e o formulário "Confirmar" da página. Contra o banco: a linha
 * `retirou` de origem `link`, sem linha nova na repetição, sem efeito no token inválido.
 */
vi.mock('@/env', async (orig) => ({ ...(await orig<typeof import('@/env')>()), getEnv: () => ({ APP_URL: 'https://app.exemplo.com', TRUSTED_PROXIES: [] }) }));
vi.mock('@serwist/turbopack', () => ({ withSerwist: <T,>(c: T) => c }));

const { POST } = await import('./route');
const { default: nextConfig } = await import('../../../../../../next.config');

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só lê public_rate_limits (sem RLS, fora do app)
afterAll(async () => {
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});

const UM_CLIQUE = 'List-Unsubscribe=One-Click';
const chamar = (token: string, corpo: BodyInit | null, tipo = 'application/x-www-form-urlencoded') =>
  POST(
    new Request(`https://app.exemplo.com/api/aniversario/sair/${token}`, {
      method: 'POST',
      // o provedor de e-mail: outra origem, sem cookie
      headers: { 'content-type': tipo, origin: 'https://mail.provedor.example', 'x-forwarded-for': '198.51.100.40' },
      body: corpo,
    }),
    { params: Promise.resolve({ token }) },
  );
const eventos = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(aniversarioAutorizacoes).where(eq(aniversarioAutorizacoes.patientId, patientId)).orderBy(asc(aniversarioAutorizacoes.registradoEm)), app.db);

async function autorizada() {
  const T = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx, { dataNascimento: '1990-11-20' });
  await withTenant(T.ctx, (tx) => tx.insert(aniversarioAutorizacoes).values({ tenantId: T.tenantId, patientId: ana.id, evento: 'autorizou', origem: 'nutri', forma: 'escrito', registradoPor: T.nutriId }), app.db);
  return { T, ana, token: assinarLinkDeSaida({ tenantId: T.tenantId, patientId: ana.id }) };
}

describe('POST /api/aniversario/sair/[token] (RFC 8058)', () => {
  it('um clique (corpo List-Unsubscribe=One-Click, sem cookie, de outra origem) → 200 sem corpo e a linha `retirou` de origem link; de novo → 200 sem linha nova', async () => {
    const { T, ana, token } = await autorizada();
    const r = await chamar(token, UM_CLIQUE);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await eventos(T, ana.id)).map((e) => [e.evento, e.origem, e.registradoPor])).toEqual([
      ['autorizou', 'nutri', T.nutriId],
      ['retirou', 'link', null],
    ]);
    const de2 = await chamar(token, UM_CLIQUE);
    expect(de2.status).toBe(200);
    expect(await de2.text()).toBe('');
    expect(await eventos(T, ana.id)).toHaveLength(2);
  });

  it('o mesmo corpo em multipart/form-data também vale', async () => {
    const { T, ana, token } = await autorizada();
    const fd = new FormData();
    fd.set('List-Unsubscribe', 'One-Click');
    expect((await POST(new Request(`https://app.exemplo.com/api/aniversario/sair/${token}`, { method: 'POST', body: fd }), { params: Promise.resolve({ token }) })).status).toBe(200);
    expect((await eventos(T, ana.id)).map((e) => e.evento)).toEqual(['autorizou', 'retirou']);
  });

  it('token inválido (formato ou assinatura) → 200 sem efeito e sem corpo (sem enumeração)', async () => {
    const { T, ana, token } = await autorizada();
    for (const t of ['curto', 'x'.repeat(66), `${token.slice(0, 65)}${token[65] === 'A' ? 'B' : 'A'}`, `${token}%0d%0a`]) {
      const r = await chamar(t, UM_CLIQUE);
      expect(r.status, t).toBe(200);
      expect(await r.text()).toBe('');
    }
    expect(await eventos(T, ana.id)).toHaveLength(1);
  });

  it('o formulário da página (origem=pagina) → 303 para a página com ?ok=1; sem o corpo do RFC nem a origem → 400 sem efeito', async () => {
    const { T, ana, token } = await autorizada();
    const r = await chamar(token, 'origem=pagina');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`https://app.exemplo.com/aniversario/sair/${token}?ok=1`);
    expect((await eventos(T, ana.id)).map((e) => e.evento)).toEqual(['autorizou', 'retirou']);
    const { T: T2, ana: bia, token: t2 } = await autorizada();
    expect((await chamar(t2, 'qualquer=coisa')).status).toBe(400);
    expect((await chamar(t2, null)).status).toBe(400);
    expect(await eventos(T2, bia.id)).toHaveLength(1);
  });

  it('limite por token: acima dele, 429 no um clique e ?erro=limite na página — outro token segue', async () => {
    const { token } = await autorizada();
    for (let i = 0; i < LIMITE_SAIDA_POR_HORA; i++) expect((await chamar(token, UM_CLIQUE)).status).toBe(200);
    expect((await chamar(token, UM_CLIQUE)).status).toBe(429);
    const p = await chamar(token, 'origem=pagina');
    expect(p.status).toBe(303);
    expect(p.headers.get('location')).toBe(`https://app.exemplo.com/aniversario/sair/${token}?erro=limite`);
    const { token: outro } = await autorizada();
    expect((await chamar(outro, UM_CLIQUE)).status).toBe(200);
    // o balde guarda só o HMAC do token, nunca o token
    const linhas = await owner.db.execute<{ chave: string }>(sql`select chave from public_rate_limits where chave like 'aniversario-sair:%'`);
    expect(linhas.rows.length).toBeGreaterThan(0);
    expect(linhas.rows.some((l) => l.chave.includes(token))).toBe(false);
  });

  it('next.config.ts: a rota do token sem Referer e sem cache (AG-D71), depois da regra /:path*', async () => {
    const regras = await nextConfig.headers!();
    const geral = regras.findIndex((x) => x.source === '/:path*');
    const i = regras.findIndex((x) => x.source === '/api/aniversario/sair/:token*');
    expect(i).toBeGreaterThan(geral);
    expect(regras[i].headers).toEqual(expect.arrayContaining([{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }]));
  });
});
