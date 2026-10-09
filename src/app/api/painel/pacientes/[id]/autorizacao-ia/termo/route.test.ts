import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { iaAutorizacoes, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { codigoDeReferencia } from '@/modules/ia/autorizacao-token';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { AUTORIZACAO_IA_VERSAO } from '@/modules/ia/textos-legais';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { iaPronta, PDF_MINIMO } from '../../../../../../../../test/ia';
import { novoPaciente } from '../../../../../../../../test/pacientes';
import { criarEEntrar } from '../../../../../../../../test/sessao';
import { POST } from './route';

// R4 (pre-flight do Plano 14A): o getEnv() guarda o ambiente na primeira leitura — IA_PROVEDOR antes de qualquer import
const iaAntes = vi.hoisted(() => {
  const antes = process.env.IA_PROVEDOR;
  process.env.IA_PROVEDOR = 'sandbox';
  return antes;
});
vi.mock('server-only', () => ({}));
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
  if (iaAntes === undefined) delete process.env.IA_PROVEDOR;
  else process.env.IA_PROVEDOR = iaAntes;
});
async function nutri() {
  const [t] = await db.insert(tenants).values({ slug: `ti-${randomUUID().slice(0, 8)}`, nomeExibicao: 'TI', nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' }).returning();
  const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  await iaPronta(db, t.id);
  return { cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
const enviar = (id: string, campos: Record<string, string | Blob>, cookie: string, origin = 'http://localhost:3000') => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return POST(new Request(`http://localhost:3000/api/painel/pacientes/${id}/autorizacao-ia/termo`, { method: 'POST', body: f, headers: { cookie, origin } }), { params: Promise.resolve({ id }) });
};
const autorizacoes = (ctx: Awaited<ReturnType<typeof nutri>>['ctx'], patientId: string) =>
  withTenant(ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, patientId)), db);

describe('POST do termo em papel (US-108)', () => {
  it('grava o arquivo e a autorização; erros por campo com os textos da US-108; outra origem → 403', async () => {
    const N = await nutri();
    const p = await novoPaciente(db, N.ctx);
    const hoje = hojeNoFuso('America/Sao_Paulo');
    const sem = await enviar(p.id, { data: hoje }, N.cookie);
    expect(sem.status).toBe(400);
    expect(sem.headers.get('cache-control')).toBe('no-store');
    expect((await sem.json()).erros).toMatchObject({ arquivo: MSG_AUTORIZACAO.faltouArquivo, confirmacao: MSG_AUTORIZACAO.faltouConfirmacao, codigo: MSG_AUTORIZACAO.faltouCodigo });
    const codigo = codigoDeReferencia(N.ctx.tenantId, p.id, AUTORIZACAO_IA_VERSAO, 'teste'); // IA_PROVEDOR=sandbox
    expect((await enviar(p.id, { codigo, data: hoje, confirmacao: 'on', arquivo: new Blob([PDF_MINIMO]) }, N.cookie, 'https://outro.site')).status).toBe(403);
    // revisão final (RN-107/RN-109): o código impresso com outro destino → 400 no campo do código
    const outroDestino = await enviar(p.id, { codigo: codigoDeReferencia(N.ctx.tenantId, p.id, AUTORIZACAO_IA_VERSAO, 'anthropic-us'), data: hoje, confirmacao: 'on', arquivo: new Blob([PDF_MINIMO]) }, N.cookie);
    expect(outroDestino.status).toBe(400);
    expect((await outroDestino.json()).erros).toEqual({ codigo: MSG_AUTORIZACAO.codigoNaoConfere });
    expect(await autorizacoes(N.ctx, p.id)).toHaveLength(0);
    const ok = await enviar(p.id, { codigo, data: hoje, confirmacao: 'on', arquivo: new Blob([PDF_MINIMO], { type: 'application/pdf' }) }, N.cookie);
    expect(ok.status).toBe(200);
    const [a] = await autorizacoes(N.ctx, p.id);
    expect(a).toMatchObject({ canal: 'papel', evento: 'autorizou' });
  });

  it('arquivo fora do formato → erro no campo do arquivo; id inválido ou de outro consultório → 404; sem sessão → 401', async () => {
    const N = await nutri();
    const B = await nutri();
    const p = await novoPaciente(db, N.ctx);
    const hoje = hojeNoFuso('America/Sao_Paulo');
    const codigo = codigoDeReferencia(N.ctx.tenantId, p.id, AUTORIZACAO_IA_VERSAO, 'teste');
    const txt = await enviar(p.id, { codigo, data: hoje, confirmacao: 'on', arquivo: new Blob([Buffer.from('texto qualquer, não é imagem nem PDF')]) }, N.cookie);
    expect(txt.status).toBe(400);
    expect((await txt.json()).erros).toEqual({ arquivo: MSG_AUTORIZACAO.arquivoInvalido });
    expect((await enviar('nao-e-uuid', { codigo, data: hoje, confirmacao: 'on', arquivo: new Blob([PDF_MINIMO]) }, N.cookie)).status).toBe(404);
    expect((await enviar(p.id, { codigo, data: hoje, confirmacao: 'on', arquivo: new Blob([PDF_MINIMO]) }, B.cookie)).status).toBe(404);
    expect((await enviar(p.id, { codigo, data: hoje, confirmacao: 'on', arquivo: new Blob([PDF_MINIMO]) }, '')).status).toBe(401);
    expect(await autorizacoes(N.ctx, p.id)).toHaveLength(0);
  });
});
