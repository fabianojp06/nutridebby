import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, IA_TESTE, iaPronta } from '../../../test/ia';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { iaAutorizacoes, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { autorizarPeloLink, estadoDoLinkIa, LinkIaError, retirarPeloLink, type DepsLinkIa } from './autorizacao-link';
import { assinarLinkPedido, assinarLinkRetirada, emailHmac } from './autorizacao-token';
import { MSG_AUTORIZACAO } from './constantes';
import { textoCorrido, textoExibido } from './textos-legais';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const PERFIL = { nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' };
let ip = 0;
const deps = (extra: Partial<DepsLinkIa> = {}): DepsLinkIa => ({
  ia: IA_TESTE, appUrl: 'https://app.test', db: app.db, ip: '203.0.113.50', ipDoLimite: `198.51.${Math.floor(Math.random() * 250)}.${++ip % 250}`,
  userAgent: 'Navegador de teste', verificarTurnstile: async (t) => (t === 'ok' ? 'ok' : 'invalido'), ...extra,
});
async function cenario() {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId);
  await app.db.update(tenants).set(PERFIL).where(eq(tenants.id, T.tenantId));
  const p = await novoPaciente(app.db, T.ctx);
  const pedido = (emitidoEm = new Date()) => assinarLinkPedido({ tenantId: T.tenantId, patientId: p.id, emitidoEm, email: p.email! });
  const eventos = () => withTenant(T.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, p.id)), app.db);
  return { T, p, pedido, eventos };
}
/** O texto que a página mostrou (destino de teste, versão e usos de agora): o formulário o devolve no POST. */
const LIDO = textoExibido('teste');
const status = (pr: Promise<unknown>) => pr.then(() => null, (e: unknown) => (e instanceof LinkIaError ? [e.status, e.mensagem] : e));

describe('US-107 — o estado do link (GET não grava nada)', () => {
  it('decidir: o consultório e o texto inteiro da versão atual, com a forma de retirar do link; nada de saúde', async () => {
    const { T, pedido } = await cenario();
    const e = await estadoDoLinkIa(pedido(), deps());
    expect(e).toMatchObject({ tipo: 'decidir', consultorio: expect.any(String) });
    if (e.tipo !== 'decidir') throw new Error('estado');
    const texto = e.texto.paragrafos.map(textoCorrido).join(' ');
    expect(e.texto.titulo).toBe('Autorização para uso de inteligência artificial');
    expect(texto).toContain('Debora Silva, CRN-3 12345');
    expect(texto).toContain('pelo link "Retirar a autorização" do e-mail de confirmação');
    expect(e.exibido).toEqual({ versao: '0.1-provisorio', destino: 'teste', usos: ['leitura_laudos'] }); // o que o POST devolve
    expect(T.tenantId).toBeTruthy();
  });

  it('inválido: token adulterado, de outro paciente, com o e-mail corrigido, paciente bloqueado/arquivado, IA desativada; vencido: depois de 7 dias', async () => {
    const { T, p, pedido } = await cenario();
    const t = pedido();
    expect(await estadoDoLinkIa(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), deps())).toEqual({ tipo: 'invalido' });
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await estadoDoLinkIa(assinarLinkPedido({ tenantId: T.tenantId, patientId: outro.id, emitidoEm: new Date(), email: p.email! }), deps())).toEqual({ tipo: 'invalido' });
    expect(await estadoDoLinkIa(pedido(new Date(Date.now() - 8 * 86_400_000)), deps())).toEqual({ tipo: 'expirado' });
    await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    expect(await estadoDoLinkIa(t, deps())).toEqual({ tipo: 'invalido' });
    await app.db.update(tenants).set({ iaAtivadaEm: new Date() }).where(eq(tenants.id, T.tenantId));
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ email: `trocado-${randomUUID().slice(0, 6)}@ex.com` }).where(eq(patients.id, p.id)), app.db);
    expect(await estadoDoLinkIa(t, deps())).toEqual({ tipo: 'invalido' });
  });
});

describe('US-107 — autorizar pelo link (RNF-111 e)', () => {
  it('grava canal link, sem conta, com IP, user-agent e o HMAC do e-mail; manda a confirmação; o estado vira "já autorizou"', async () => {
    const { p, pedido, eventos } = await cenario();
    const t = pedido();
    await autorizarPeloLink(t, { turnstile: 'ok', exibido: LIDO }, deps());
    const [e] = await eventos();
    expect(e).toMatchObject({ evento: 'autorizou', canal: 'link', registradoPor: null, ip: '203.0.113.50', userAgent: 'Navegador de teste', emailHmac: emailHmac(p.email!), destino: 'teste', usos: ['leitura_laudos'] }); // F2
    expect(await emailsNaFila('autorizacao_ia_confirmada', p.email!)).toHaveLength(1);
    expect(await estadoDoLinkIa(t, deps())).toMatchObject({ tipo: 'ja_autorizou' });
    await autorizarPeloLink(t, { turnstile: 'ok', exibido: LIDO }, deps()); // idempotente
    expect(await eventos()).toHaveLength(1);
  });

  it('sem Turnstile → 403; Turnstile fora → 503; acima de 20 por hora no mesmo IP → 429; nada gravado', async () => {
    const { pedido, eventos } = await cenario();
    expect(await status(autorizarPeloLink(pedido(), {}, deps()))).toEqual([403, MSG_AUTORIZACAO.robo]);
    expect(await status(autorizarPeloLink(pedido(), { turnstile: 'ok', exibido: LIDO }, deps({ verificarTurnstile: async () => 'indisponivel' })))).toEqual([503, MSG_AUTORIZACAO.turnstileFora]);
    const mesmoIp = deps();
    const t = 'x'.repeat(72); // inválido: consome o limite e cai no 410
    for (let i = 0; i < 20; i++) await autorizarPeloLink(t, { turnstile: 'ok', exibido: LIDO }, mesmoIp).catch(() => undefined);
    expect(await status(autorizarPeloLink(pedido(), { turnstile: 'ok', exibido: LIDO }, mesmoIp))).toEqual([429, MSG_AUTORIZACAO.muitasTentativas]);
    expect(await eventos()).toHaveLength(0);
  });

  it('vencido → 410 "Este link expirou…"; adulterado, de retirada ou com o e-mail corrigido → 410 "Este link não é mais válido…"', async () => {
    const { T, p, pedido, eventos } = await cenario();
    expect(await status(autorizarPeloLink(pedido(new Date(Date.now() - 8 * 86_400_000)), { turnstile: 'ok', exibido: LIDO }, deps()))).toEqual([410, MSG_AUTORIZACAO.linkExpirado]);
    expect(await status(autorizarPeloLink(assinarLinkRetirada({ tenantId: T.tenantId, patientId: p.id, autorizacaoId: randomUUID() }), { turnstile: 'ok', exibido: LIDO }, deps()))).toEqual([410, MSG_AUTORIZACAO.linkInvalido]);
    const t = pedido();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ email: `trocado-${randomUUID().slice(0, 6)}@ex.com` }).where(eq(patients.id, p.id)), app.db);
    expect(await status(autorizarPeloLink(t, { turnstile: 'ok', exibido: LIDO }, deps()))).toEqual([410, MSG_AUTORIZACAO.linkInvalido]);
    expect(await eventos()).toHaveLength(0);
  });
});

describe('RN-107 (revisão da T6) — a autorização gravada é a do texto que o paciente leu', () => {
  it('GET com o destino A, POST com o destino B (deploy entre a leitura e o toque) → 409, nada gravado nem enviado', async () => {
    const { p, pedido, eventos } = await cenario();
    const t = pedido();
    const lido = await estadoDoLinkIa(t, deps());
    if (lido.tipo !== 'decidir') throw new Error('estado');
    const emUe = deps({ ia: { ...IA_TESTE, destino: 'bedrock-eu' } });
    expect(await status(autorizarPeloLink(t, { turnstile: 'ok', exibido: lido.exibido }, emUe))).toEqual([409, MSG_AUTORIZACAO.textoMudouLink]);
    expect(await eventos()).toHaveLength(0);
    expect(await emailsNaFila('autorizacao_ia_confirmada', p.email!)).toHaveLength(0);
    // recarregou: a página mostra o texto do destino B, e aí grava
    const relido = await estadoDoLinkIa(t, emUe);
    if (relido.tipo !== 'decidir') throw new Error('estado');
    expect(relido.exibido.destino).toBe('bedrock-eu');
    await autorizarPeloLink(t, { turnstile: 'ok', exibido: relido.exibido }, emUe);
    expect(await eventos()).toMatchObject([{ evento: 'autorizou', destino: 'bedrock-eu', versao: '0.1-provisorio', usos: ['leitura_laudos'] }]);
  });

  it('sem o texto lido, ou com outra versão ou outros usos → 409, nada gravado', async () => {
    const { pedido, eventos } = await cenario();
    for (const exibido of [undefined, null, 'teste', [], { ...LIDO, versao: '0.0-antiga' }, { ...LIDO, usos: [...LIDO.usos, 'resumo_historico'] }, { ...LIDO, usos: [] }, { ...LIDO, usos: ['leitura_laudos', 'leitura_laudos'] }]) {
      expect(await status(autorizarPeloLink(pedido(), { turnstile: 'ok', exibido }, deps())), JSON.stringify(exibido)).toEqual([409, MSG_AUTORIZACAO.textoMudouLink]);
    }
    expect(await eventos()).toHaveLength(0);
  });
});

describe('US-109 — retirar pelo link (RNF-111 i)', () => {
  it('o link de retirada vale depois dos 7 dias e com a IA desativada; grava canal link e enfileira o ia-retirada', async () => {
    const { T, p, eventos } = await cenario();
    const autorizacaoId = await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await app.db.update(tenants).set({ iaAtivadaEm: null, iaLiberada: false }).where(eq(tenants.id, T.tenantId));
    const t = assinarLinkRetirada({ tenantId: T.tenantId, patientId: p.id, autorizacaoId });
    expect(await estadoDoLinkIa(t, deps())).toMatchObject({ tipo: 'retirar' });
    await retirarPeloLink(t, { turnstile: 'ok' }, deps());
    const ret = (await eventos()).find((e) => e.evento === 'retirou')!;
    expect(ret).toMatchObject({ canal: 'link', registradoPor: null, ip: '203.0.113.50', emailHmac: emailHmac(p.email!) });
    const jobs = await (await getBoss()).findJobs<{ retiradaId: string }>('ia-retirada');
    expect(jobs.some((j) => j.data.retiradaId === ret.id)).toBe(true);
    expect(await estadoDoLinkIa(t, deps())).toEqual({ tipo: 'nao_vigente' });
  });

  it('a autorização daquele link foi substituída (reautorizou) → 410 "Esta autorização já não está em vigor."', async () => {
    const { T, p } = await cenario();
    const antiga = await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    const t = assinarLinkRetirada({ tenantId: T.tenantId, patientId: p.id, autorizacaoId: antiga });
    expect(await status(retirarPeloLink(t, { turnstile: 'ok' }, deps()))).toEqual([410, MSG_AUTORIZACAO.naoVigente]);
  });

  it('com o link do pedido ainda válido também retira (US-109); vencido, não', async () => {
    const { T, p, pedido } = await cenario();
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    expect(await status(retirarPeloLink(pedido(new Date(Date.now() - 8 * 86_400_000)), { turnstile: 'ok' }, deps()))).toEqual([410, MSG_AUTORIZACAO.linkExpirado]);
    await retirarPeloLink(pedido(), { turnstile: 'ok' }, deps());
    expect((await estadoDoLinkIa(pedido(), deps())).tipo).toBe('decidir');
  });
});
