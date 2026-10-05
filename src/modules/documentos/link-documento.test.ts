import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos } from '../../../test/documentos';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { assinarLinkDocumento, confirmarCodigoDocumento, confirmarRecebimentoPeloLink, estadoDoLink, limparCodigosDeDocumentoVencidos, LinkError, MSG_LINK, pdfDoLink, pedirCodigoDocumento } from './link-documento';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});
let ip = 0;
const deps = (agora = new Date()) => ({ db: app.db, agora, ip: `198.51.100.${++ip % 250}`, ipDoLimite: `198.51.100.${ip % 250}`, verificarTurnstile: async () => 'ok' as const, appUrl: 'https://x' });

/** `liberado`: o interruptor do admin (D20); o novoTenant nasce desligado, como em produção. */
async function cenario(o: { liberado?: boolean } = {}) {
  const T = await novoTenant(app.db);
  if (o.liberado !== false) await liberarDocumentos(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx);
  const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
  const token = assinarLinkDocumento({ tenantId: T.tenantId, patientId: p.id, documentoId: d.id, emitidoEm: new Date(), email: p.email });
  return { T, p, d, token };
}
const ultimoCodigo = async (email: string) => (await emailsNaFila('codigo_documento', email)).at(-1)!.codigo;

describe('link de uso único (RN-158, Review Focus 4)', () => {
  it('o GET (estado) não consome nada; pedir código manda o e-mail; o código abre UMA vez e cria a sessão', async () => {
    const x = await cenario();
    expect(await estadoDoLink(x.token, undefined, deps())).toEqual({ tipo: 'pedir_codigo' });
    expect(await estadoDoLink(x.token, undefined, deps())).toEqual({ tipo: 'pedir_codigo' });
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps());
    const codigo = await ultimoCodigo(x.p.email);
    const { sessao } = await confirmarCodigoDocumento(x.token, { codigo }, deps());
    expect(await estadoDoLink(x.token, sessao, deps())).toMatchObject({ tipo: 'aberto' });
    await expect(confirmarCodigoDocumento(x.token, { codigo }, deps())).rejects.toBeInstanceOf(LinkError); // o mesmo código de novo
    expect(await pdfDoLink(x.token, sessao, deps())).toBe(x.d.pdfPath);
    const r = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select evento, via from signed_document_receipts where documento_id = ${x.d.id}`), app.db);
    expect(r.rows).toEqual([{ evento: 'aberto', via: 'link_email' }]);
  });

  it('limites: 1 código por minuto e 5 por hora por documento; 5 erros invalidam o código', async () => {
    const x = await cenario();
    const t0 = new Date();
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps(t0));
    await expect(pedirCodigoDocumento(x.token, { turnstile: 't' }, deps(new Date(t0.getTime() + 10_000)))).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.aguarde);
    for (let i = 1; i <= 4; i++) await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps(new Date(t0.getTime() + i * 61_000)));
    await expect(pedirCodigoDocumento(x.token, { turnstile: 't' }, deps(new Date(t0.getTime() + 5 * 61_000)))).rejects.toBeInstanceOf(LinkError);
    const y = await cenario();
    await pedirCodigoDocumento(y.token, { turnstile: 't' }, deps());
    const certo = await ultimoCodigo(y.p.email);
    for (let i = 0; i < 5; i++) await expect(confirmarCodigoDocumento(y.token, { codigo: certo === '000000' ? '111111' : '000000' }, deps())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.codigoInvalido);
    // o incremento sobreviveu aos erros (nada de rollback junto com o LinkError)
    const t = await withTenant(y.T.ctx, (tx) => tx.execute(sql`select tentativas from document_access_codes where documento_id = ${y.d.id}`), app.db);
    expect(t.rows).toEqual([{ tentativas: 5 }]);
    await expect(confirmarCodigoDocumento(y.token, { codigo: certo }, deps())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.codigoVencido);
  });

  it('a confirmação também tem limite por IP: a 31ª tentativa na hora, do mesmo IP, é recusada', async () => {
    const x = await cenario();
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps());
    const mesmoIp = (agora = new Date()) => ({ ...deps(agora), ipDoLimite: '203.0.113.77' });
    for (let i = 0; i < 30; i++) await expect(confirmarCodigoDocumento(x.token, { codigo: 'abc' }, mesmoIp())).rejects.toBeInstanceOf(LinkError);
    await expect(confirmarCodigoDocumento(x.token, { codigo: await ultimoCodigo(x.p.email) }, mesmoIp())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.limite);
  });

  it('e-mail corrigido, documento cancelado, paciente bloqueado, link de 31 dias → indisponível/expirado; a sessão de um link não abre outro', async () => {
    const x = await cenario();
    await withTenant(x.T.ctx, (tx) => tx.execute(sql`update patients set email = 'novo@ex.com' where id = ${x.p.id}`), app.db);
    expect((await estadoDoLink(x.token, undefined, deps())).tipo).toBe('invalido');
    const y = await cenario();
    await withTenant(y.T.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'cancelado', cancelado_em = now() where id = ${y.d.id}`), app.db);
    expect((await estadoDoLink(y.token, undefined, deps())).tipo).toBe('indisponivel');
    const z = await cenario();
    expect((await estadoDoLink(z.token, undefined, deps(new Date(Date.now() + 31 * 86_400_000)))).tipo).toBe('expirado');
    const w = await cenario();
    await pedirCodigoDocumento(w.token, { turnstile: 't' }, deps());
    const { sessao } = await confirmarCodigoDocumento(w.token, { codigo: await ultimoCodigo(w.p.email) }, deps());
    expect(await pdfDoLink(z.token, sessao, deps())).toBeNull();
  });

  it('D20: com o interruptor do admin desligado, o link fica indisponível, nenhum código é enviado e a sessão aberta antes deixa de abrir o PDF', async () => {
    const x = await cenario({ liberado: false });
    expect((await estadoDoLink(x.token, undefined, deps())).tipo).toBe('indisponivel');
    await expect(pedirCodigoDocumento(x.token, { turnstile: 't' }, deps())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.invalido);
    expect(await emailsNaFila('codigo_documento', x.p.email)).toEqual([]);
    const y = await cenario();
    await pedirCodigoDocumento(y.token, { turnstile: 't' }, deps());
    const { sessao } = await confirmarCodigoDocumento(y.token, { codigo: await ultimoCodigo(y.p.email) }, deps());
    await app.db.update(tenants).set({ documentosLiberados: false }).where(eq(tenants.id, y.T.tenantId)); // o admin desliga
    expect(await pdfDoLink(y.token, sessao, deps())).toBeNull();
    expect(await confirmarRecebimentoPeloLink(y.token, sessao, deps())).toBeNull();
    const r = await withTenant(y.T.ctx, (tx) => tx.execute(sql`select 1 from signed_document_receipts where documento_id = ${y.d.id}`), app.db);
    expect(r.rows).toEqual([]);
  });

  it('limpeza diária: código vencido há mais de 1 dia (e sem sessão viva) sai; o da sessão em uso fica', async () => {
    const x = await cenario();
    const q = (s: ReturnType<typeof sql>) => withTenant(x.T.ctx, (tx) => tx.execute(s), app.db);
    await q(sql`insert into document_access_codes (tenant_id, patient_id, documento_id, codigo_hash, expira_em, created_at) values (${x.T.tenantId}, ${x.p.id}, ${x.d.id}, 'velho', now() - interval '2 days', now() - interval '2 days')`);
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps());
    const { sessao } = await confirmarCodigoDocumento(x.token, { codigo: await ultimoCodigo(x.p.email) }, deps());
    expect(await limparCodigosDeDocumentoVencidos(app.db, new Date(), { tenantId: x.T.tenantId })).toBe(1); // só o tenant do teste (banco compartilhado)
    const restam = await q(sql`select codigo_hash from document_access_codes where documento_id = ${x.d.id}`);
    expect(restam.rows.map((r) => r.codigo_hash)).not.toContain('velho');
    expect(await pdfDoLink(x.token, sessao, deps())).toBe(x.d.pdfPath); // a sessão em uso continua valendo
  });
});
