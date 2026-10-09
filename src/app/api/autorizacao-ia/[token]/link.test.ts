import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { iaPronta } from '../../../../../test/ia';
import { novoPaciente, novoTenant } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { iaAutorizacoes, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { assinarLinkPedido } from '@/modules/ia/autorizacao-token';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { textoExibido } from '@/modules/ia/textos-legais';
import { POST as autorizar } from './autorizar/route';
import { POST as retirar } from './retirar/route';

// O Turnstile de verdade iria à rede: aqui, só o token "ok" passa
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: async (t: string | null) => (t === 'ok' ? 'ok' : 'invalido') }));
// O provedor fake (destino "teste") só para este arquivo, antes da primeira leitura do getEnv (que guarda o ambiente)
const provedorAntes = vi.hoisted(() => {
  const antes = process.env.IA_PROVEDOR;
  process.env.IA_PROVEDOR = 'fake';
  return antes;
});
getDb();
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  if (provedorAntes === undefined) delete process.env.IA_PROVEDOR;
  else process.env.IA_PROVEDOR = provedorAntes;
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
type Rota = (req: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;
const bloco = `198.18.${Math.floor(Math.random() * 250)}`;
let n = 0;
const chamar = (rota: Rota, acao: string, token: string, o: { corpo?: string; origem?: string } = {}) =>
  rota(
    new Request(`http://localhost:3000/api/autorizacao-ia/${token}/${acao}`, {
      method: 'POST', body: o.corpo ?? '{}',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `${bloco}.${++n % 250}`, ...(o.origem ? { origin: o.origem } : {}) },
    }),
    { params: Promise.resolve({ token }) },
  );

describe('rotas do link da autorização de IA (US-107, US-109)', () => {
  it('outra origem → 403; sem Turnstile → 403 com o texto da US-107; token inválido → 410; corpo grande → 413', async () => {
    const t = 'x'.repeat(72);
    for (const [rota, acao] of [[autorizar, 'autorizar'], [retirar, 'retirar']] as const) {
      expect((await chamar(rota, acao, t, { origem: 'https://outro.site' })).status, acao).toBe(403);
      const semRobo = await chamar(rota, acao, t);
      expect(semRobo.status, acao).toBe(403);
      expect(await semRobo.json()).toEqual({ erro: MSG_AUTORIZACAO.robo });
      const r = await chamar(rota, acao, t, { corpo: JSON.stringify({ turnstile: 'ok' }) });
      expect(r.status, acao).toBe(410);
      expect(await r.json()).toEqual({ erro: MSG_AUTORIZACAO.linkInvalido });
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect((await chamar(rota, acao, t, { corpo: JSON.stringify({ turnstile: 'ok', lixo: 'x'.repeat(9000) }) })).status, acao).toBe(413);
    }
  });

  it('o corpo leva o texto lido (exibido) até o módulo: outra versão → 409 com o texto novo; o texto de agora → 200 (RN-107, revisão da T6)', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId);
    await app.db.update(tenants).set({ nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' }).where(eq(tenants.id, T.tenantId));
    const p = await novoPaciente(app.db, T.ctx);
    const t = assinarLinkPedido({ tenantId: T.tenantId, patientId: p.id, emitidoEm: new Date(), email: p.email! });
    const lido = textoExibido('teste');
    const velho = await chamar(autorizar, 'autorizar', t, { corpo: JSON.stringify({ turnstile: 'ok', exibido: { ...lido, versao: '0.0-antiga' } }) });
    expect(velho.status).toBe(409);
    expect(await velho.json()).toEqual({ erro: MSG_AUTORIZACAO.textoMudouLink });
    expect(velho.headers.get('cache-control')).toBe('no-store');
    expect((await chamar(autorizar, 'autorizar', t, { corpo: JSON.stringify({ turnstile: 'ok', exibido: lido }) })).status).toBe(200);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, p.id)), app.db);
    expect(linhas).toMatchObject([{ evento: 'autorizou', canal: 'link', versao: lido.versao, destino: 'teste' }]);
  });
});
