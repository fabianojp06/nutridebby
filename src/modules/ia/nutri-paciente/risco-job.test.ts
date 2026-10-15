import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../../test/db';
import { mensagemNoBanco } from '../../../../test/ia-nutri';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../../test/pacientes';
import { closeDb } from '@/db/client';
import { iaNutriMensagens, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { avisarRiscoIaNutri } from './risco-job';

// Plano 15 (D10 = a, DP-6, RNF-166): o e-mail genérico de sinal de risco às nutricionistas — no máximo 1 a cada 15 min por
// tenant; dentro da janela, ADIADO (um job só por tenant, R7 do pre-flight), nunca descartado
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const MIN = 60_000;
async function cenario() {
  const T = await novoTenant(app.db);
  const outraId = randomUUID();
  const outraEmail = `nutri-${outraId.slice(0, 8)}@teste.dev`;
  await app.db.insert(user).values({ id: outraId, name: 'Bia Lima', email: outraEmail, appRole: 'nutri', tenantId: T.tenantId });
  const nutriEmail = (await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId)))[0].email;
  const p = await novoPaciente(app.db, T.ctx);
  const risco = () => mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'emergencia', encaminhadaEm: new Date(), contouNoLimite: false });
  const marca = async () => (await app.db.select({ em: tenants.iaNutriRiscoAvisoEm }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].em;
  const pendentes = async () => (await getBoss()).findJobs<{ tenantId: string }>('ia-nutri-risco', { key: T.tenantId, queued: true });
  return { T, p, nutriEmail, outraEmail, risco, marca, pendentes };
}

describe('avisarRiscoIaNutri (D10, DP-6)', () => {
  it('risco não aberto → enviado: um e-mail por nutricionista do tenant e a marca gravada; risco 5 min depois → adiado, um job só; no fim da janela → enviado', async () => {
    const c = await cenario();
    await c.risco();
    const boss = await getBoss();
    const t0 = new Date(Date.now() - 60 * MIN); // relógio injetado (o worker usa o de agora)
    const em = (min: number) => ({ db: app.db, appUrl: 'https://app.teste/', boss, agora: () => new Date(t0.getTime() + min * MIN) });

    expect(await avisarRiscoIaNutri({ tenantId: c.T.tenantId }, em(0))).toBe('enviado');
    for (const para of [c.nutriEmail, c.outraEmail]) {
      expect(await emailsNaFila('risco_ia_nutri', para)).toEqual([{ tipo: 'risco_ia_nutri', para, link: 'https://app.teste/painel/duvidas' }]);
    }
    expect((await c.marca())?.getTime()).toBe(t0.getTime());

    await c.risco();
    expect(await avisarRiscoIaNutri({ tenantId: c.T.tenantId }, em(5))).toBe('adiado');
    expect(await emailsNaFila('risco_ia_nutri', c.nutriEmail)).toHaveLength(1); // nada na hora
    let pend = await c.pendentes();
    expect(pend).toHaveLength(1);
    expect(pend[0].data).toEqual({ tenantId: c.T.tenantId });
    expect(pend[0].startAfter.getTime()).toBe(t0.getTime() + 15 * MIN);
    // de novo dentro da janela (outro risco, outro job imediato): continua UM pendente
    expect(await avisarRiscoIaNutri({ tenantId: c.T.tenantId }, em(9))).toBe('adiado');
    pend = await c.pendentes();
    expect(pend).toHaveLength(1);
    expect(pend[0].startAfter.getTime()).toBe(t0.getTime() + 15 * MIN);
    expect((await c.marca())?.getTime()).toBe(t0.getTime()); // o adiamento não mexe na marca

    // o job adiado roda no fim da janela: o aviso sai (agrupar, nunca descartar)
    expect(await avisarRiscoIaNutri({ tenantId: c.T.tenantId }, em(15))).toBe('enviado');
    expect(await emailsNaFila('risco_ia_nutri', c.nutriEmail)).toHaveLength(2);
    expect(await emailsNaFila('risco_ia_nutri', c.outraEmail)).toHaveLength(2);
    expect((await c.marca())?.getTime()).toBe(t0.getTime() + 15 * MIN);
  });

  it('sem risco aberto → nada: sem e-mail, sem marca, sem job (aberta pela nutricionista, resolvida, ou só dúvida sem risco)', async () => {
    const c = await cenario();
    await mensagemNoBanco(app.db, c.T.tenantId, c.p.id, { status: 'respondida', encaminhadaEm: new Date(), contouNoLimite: false }); // sem risco
    const aberta = await c.risco();
    await withTenant(c.T.ctx, (tx) => tx.update(iaNutriMensagens).set({ abertaPelaNutriEm: new Date() }).where(eq(iaNutriMensagens.id, aberta)), app.db);
    const resolvida = await c.risco();
    await withTenant(c.T.ctx, (tx) => tx.update(iaNutriMensagens).set({ resolvidaEm: new Date(), resolvidaPor: c.T.nutriId, resolucao: 'vista' }).where(eq(iaNutriMensagens.id, resolvida)), app.db);
    // risco gravado acima de 10 no dia: fica fora da fila (encaminhada_em nulo) — não avisa
    await mensagemNoBanco(app.db, c.T.tenantId, c.p.id, { status: 'respondida', risco: 'emergencia', contouNoLimite: false });
    expect(await avisarRiscoIaNutri({ tenantId: c.T.tenantId }, { db: app.db, appUrl: 'https://app.teste' })).toBe('nada');
    expect(await emailsNaFila('risco_ia_nutri', c.nutriEmail)).toEqual([]);
    expect(await c.marca()).toBeNull();
    expect(await c.pendentes()).toEqual([]);
  });

  it('o risco de outro tenant não conta; tenant inexistente → nada', async () => {
    const a = await cenario();
    const b = await cenario();
    await b.risco();
    expect(await avisarRiscoIaNutri({ tenantId: a.T.tenantId }, { db: app.db, appUrl: 'https://app.teste' })).toBe('nada');
    expect(await avisarRiscoIaNutri({ tenantId: randomUUID() }, { db: app.db, appUrl: 'https://app.teste' })).toBe('nada');
    expect(await emailsNaFila('risco_ia_nutri', a.nutriEmail)).toEqual([]);
  });
});
