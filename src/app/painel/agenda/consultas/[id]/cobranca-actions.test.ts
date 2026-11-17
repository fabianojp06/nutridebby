import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { consultaDireta, em, tenantAgenda } from '../../../../../../test/agenda';
import { makeDb } from '../../../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../../test/pacientes';

/**
 * US-303 / RN-314 (Plano 20, T7): a seção "Cobrança" da tela da consulta — registrar à mão, salvar o valor, receber e
 * cancelar — com o banco de verdade. A sessão vem sempre de `requireNutri`; toda action volta para a mesma consulta.
 */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { cancelarCobrancaAction, receberCobrancaAction, registrarCobrancaAction, salvarValorCobrancaAction } = await import('./cobranca-actions');
const { closeDb } = await import('@/db/client');
const { withTenant } = await import('@/db/tenant');
const { salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { MSG_FINANCEIRO } = await import('@/modules/financeiro/constantes');
const { hojeNoFuso } = await import('@/modules/pacientes/datas');
const { revalidatePath } = await import('next/cache');

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
beforeEach(() => vi.clearAllMocks());

const M = MSG_FINANCEIRO.erros;
type Cenario = TenantDeTeste & { p: string; c: string; url: string };
const entrarComo = (T: TenantDeTeste) => (sessao.atual = { ctx: T.ctx, tenant: tenantAgenda(T) });
async function cenario(o: { configurar?: boolean; status?: 'realizada' | 'agendada' } = {}): Promise<Cenario> {
  const T = await novoTenant(app.db);
  entrarComo(T);
  if (o.configurar !== false)
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-01-01', saldoInicial: '0', valorConsulta: '250,00' }, { db: app.db });
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  const c = await consultaDireta(app.db, T.ctx, p, em('2026-11-10', '14:00'), 60, { status: o.status ?? 'realizada' });
  return { ...T, p, c, url: `/painel/agenda/consultas/${c}` };
}
const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const destino = (p: Promise<unknown>) =>
  p.then(
    (r) => {
      throw new Error(`devia redirecionar: ${JSON.stringify(r)}`);
    },
    (e: Error) => e.message.replace(/^redirect /, ''),
  );
const linhas = async (tenantId: string) =>
  (await owner.pool.query('select to_jsonb(l) as r from fin_lancamentos l where tenant_id = $1', [tenantId])).rows.map((x) => x.r);
/** A URL de volta: a mesma consulta, com o `ok=` e um envio novo (só dígitos). */
const volta = (C: Cenario, ok: string) => new RegExp(`^${C.url}\\?ok=${ok}&envio=\\d+$`);

describe('registrarCobrancaAction (RN-314)', () => {
  it('registra com o valor informado e volta à consulta; revalida o Financeiro e a agenda', async () => {
    const C = await cenario();
    expect(await destino(registrarCobrancaAction(C.c, {}, formulario({ valor: '180,00' })))).toMatch(volta(C, 'cobranca_registrada'));
    expect(await linhas(C.tenantId)).toEqual([expect.objectContaining({ valor_centavos: 18000, appointment_id: C.c, patient_id: C.p, vencimento: '2026-11-10' })]);
    expect(revalidatePath).toHaveBeenCalledWith('/painel/financeiro', 'layout');
    expect(revalidatePath).toHaveBeenCalledWith('/painel/agenda');
  });

  it('valor obrigatório e válido (mensagens exatas, com o digitado de volta); já tem cobrança → "Esta consulta já tem uma cobrança."', async () => {
    const C = await cenario();
    const vazio = await registrarCobrancaAction(C.c, {}, formulario({ valor: '' }));
    expect(vazio).toMatchObject({ erros: { valor: M.informeValor }, valores: { valor: '' } });
    expect(await registrarCobrancaAction(C.c, vazio, formulario({ valor: 'abc' }))).toMatchObject({ erros: { valor: M.valorInvalido }, valores: { valor: 'abc' } });
    expect(await registrarCobrancaAction(C.c, {}, formulario({ valor: '2.000.000,00' }))).toMatchObject({ erros: { valor: M.valorFaixa } });
    await destino(registrarCobrancaAction(C.c, {}, formulario({ valor: '250' })));
    expect(await registrarCobrancaAction(C.c, {}, formulario({ valor: '250' }))).toMatchObject({ erros: { geral: M.jaTemCobranca } });
    expect(await linhas(C.tenantId)).toHaveLength(1);
  });

  it('consulta não realizada → volta à consulta sem gravar; Financeiro não configurado → Configurações; bloqueado → o aviso da seção', async () => {
    const A = await cenario({ status: 'agendada' });
    expect(await destino(registrarCobrancaAction(A.c, {}, formulario({ valor: '250' })))).toBe(A.url);
    const S = await cenario({ configurar: false });
    expect(await destino(registrarCobrancaAction(S.c, {}, formulario({ valor: '250' })))).toBe('/painel/financeiro/configuracoes?aviso=informeSaldo');
    const B = await cenario();
    await withTenant(
      { tenantId: B.tenantId, role: 'worker' },
      (tx) => tx.execute(sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${B.p}`),
      app.db,
    );
    expect(await registrarCobrancaAction(B.c, {}, formulario({ valor: '250' }))).toMatchObject({ erros: { geral: MSG_FINANCEIRO.consulta.bloqueado } });
    expect([...(await linhas(A.tenantId)), ...(await linhas(S.tenantId)), ...(await linhas(B.tenantId))]).toEqual([]);
  });

  it('outra sessão (outro consultório) não grava: 404', async () => {
    const A = await cenario();
    const B = await cenario();
    entrarComo(B);
    await expect(registrarCobrancaAction(A.c, {}, formulario({ valor: '250' }))).rejects.toThrow('notFound');
    await expect(registrarCobrancaAction('nao-e-uuid', {}, formulario({ valor: '250' }))).rejects.toThrow('notFound');
    expect(await linhas(A.tenantId)).toEqual([]);
  });
});

describe('salvar o valor, receber e cancelar pela seção da consulta (US-303)', () => {
  async function comCobranca() {
    const C = await cenario();
    await destino(registrarCobrancaAction(C.c, {}, formulario({ valor: '250' })));
    const [l] = await linhas(C.tenantId);
    return { ...C, l: l.id as string };
  }

  it('"Salvar valor" muda só o valor e volta com "Lançamento salvo." (ok=cobranca_salva); valor inválido → erro junto do campo', async () => {
    const C = await comCobranca();
    const antes = (await linhas(C.tenantId))[0];
    expect(await destino(salvarValorCobrancaAction(C.c, {}, formulario({ id: C.l, valor: '180,00' })))).toMatch(volta(C, 'cobranca_salva'));
    const depois = (await linhas(C.tenantId))[0];
    expect(depois).toMatchObject({ valor_centavos: 18000, vencimento: antes.vencimento, categoria_id: antes.categoria_id, descricao: null, pago_em: null });
    expect(await salvarValorCobrancaAction(C.c, {}, formulario({ id: C.l, valor: '' }))).toMatchObject({ erros: { valor: M.informeValor }, valores: { valor: '' } });
    expect(await salvarValorCobrancaAction(C.c, {}, formulario({ id: C.l, valor: '0,00' }))).toMatchObject({ erros: { valor: M.valorFaixa } });
  });

  it('"Marcar como recebido" grava a data e a forma (ok=cobranca_recebida); sem forma → "Escolha a forma de pagamento."', async () => {
    const C = await comCobranca();
    const hoje = hojeNoFuso(C.tenant.fuso);
    expect(await receberCobrancaAction(C.c, {}, formulario({ id: C.l, pagoEm: hoje, forma: '' }))).toMatchObject({ erros: { forma: M.escolhaForma } });
    expect(await destino(receberCobrancaAction(C.c, {}, formulario({ id: C.l, pagoEm: hoje, forma: 'pix' })))).toMatch(volta(C, 'cobranca_recebida'));
    expect((await linhas(C.tenantId))[0]).toMatchObject({ pago_em: hoje, forma_pagamento: 'pix' });
  });

  it('"Cancelar lançamento" com motivo (ok=cobranca_cancelada); sem motivo → "Informe o motivo do cancelamento."', async () => {
    const C = await comCobranca();
    expect(await cancelarCobrancaAction(C.c, {}, formulario({ id: C.l, motivo: '' }))).toMatchObject({ erros: { motivo: M.informeMotivo } });
    expect(await destino(cancelarCobrancaAction(C.c, {}, formulario({ id: C.l, motivo: 'Não vou cobrar' })))).toMatch(volta(C, 'cobranca_cancelada'));
    expect((await linhas(C.tenantId))[0].cancelado_em).not.toBeNull();
  });

  it('outra sessão (outro consultório) não muda a cobrança: 404', async () => {
    const A = await comCobranca();
    const antes = await linhas(A.tenantId);
    const B = await cenario();
    entrarComo(B);
    await expect(salvarValorCobrancaAction(B.c, {}, formulario({ id: A.l, valor: '1,00' }))).rejects.toThrow('notFound');
    await expect(receberCobrancaAction(B.c, {}, formulario({ id: A.l, pagoEm: '2026-11-10', forma: 'pix' }))).rejects.toThrow('notFound');
    await expect(cancelarCobrancaAction(B.c, {}, formulario({ id: A.l, motivo: 'x' }))).rejects.toThrow('notFound');
    expect(await linhas(A.tenantId)).toEqual(antes);
  });
});
