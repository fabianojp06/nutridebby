import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';

/**
 * US-300 (Plano 20, T5): as actions das Configurações do Financeiro, com o banco de verdade. A sessão (consultório, usuária,
 * IP) vem sempre de `requireNutri`, nunca do formulário.
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

const { categoriaAction, novaCategoriaAction, salvarConfiguracoesAction } = await import('./actions');
const { closeDb } = await import('@/db/client');
const { lerConfiguracoes, listarCategorias, salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { criarLancamento } = await import('@/modules/financeiro/lancamentos');
const { MSG_FINANCEIRO } = await import('@/modules/financeiro/constantes');
const { revalidatePath } = await import('next/cache');

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // o audit_log não é lido pelo papel da aplicação
afterAll(async () => {
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
beforeEach(() => vi.clearAllMocks());

const E = MSG_FINANCEIRO.errosConfig;
const EC = MSG_FINANCEIRO.errosCategoria;
const CAMINHO = '/painel/financeiro/configuracoes';

function entrarComo(T: TenantDeTeste) {
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant } };
}
const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const contar = async (sql: string, ...params: unknown[]) => (await app.pool.query(sql, params)).rows[0].n as number;

async function configurado(): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db);
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00', valorConsulta: '250,00' }, { db: app.db });
  entrarComo(T);
  return T;
}
const categoria = async (T: TenantDeTeste, nome: string) => (await listarCategorias(T.ctx, { db: app.db })).find((c) => c.nome === nome)!;

describe('salvarConfiguracoesAction (US-300)', () => {
  it('salva o saldo e o valor da consulta, semeia as categorias e redireciona com ?ok=config', async () => {
    const T = await novoTenant(app.db);
    entrarComo(T);
    const fd = formulario({ saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00', valorConsulta: '250,00' });
    await expect(salvarConfiguracoesAction({}, fd)).rejects.toThrow(`redirect ${CAMINHO}?ok=config`);
    expect(await lerConfiguracoes(T.ctx, { db: app.db })).toEqual({ saldoInicialCentavos: 150_000, saldoInicialEm: '2026-11-01', valorConsultaCentavos: 25_000 });
    expect((await listarCategorias(T.ctx, { db: app.db })).map((c) => c.nome)).toContain('Consultas');
    expect(revalidatePath).toHaveBeenCalledWith('/painel/financeiro', 'layout');
  });

  it('saldo negativo salva (conta no vermelho é saldo válido)', async () => {
    const T = await novoTenant(app.db);
    entrarComo(T);
    await expect(salvarConfiguracoesAction({}, formulario({ saldoInicialEm: '2026-11-01', saldoInicial: '-320,00', valorConsulta: '' }))).rejects.toThrow(
      `redirect ${CAMINHO}?ok=config`,
    );
    expect(await lerConfiguracoes(T.ctx, { db: app.db })).toMatchObject({ saldoInicialCentavos: -32_000, valorConsultaCentavos: null });
  });

  it('erro: devolve os erros por campo e o que foi digitado (valores), com um envio novo; nada é gravado', async () => {
    const T = await novoTenant(app.db);
    entrarComo(T);
    const digitado = { saldoInicialEm: '2026-11-01', saldoInicial: '20.000.000,00', valorConsulta: 'abc' };
    const r = await salvarConfiguracoesAction({}, formulario(digitado));
    expect(r.erros).toEqual({ saldoInicial: E.saldoFaixa, valorConsulta: E.valorInvalido });
    expect(r.valores).toEqual(digitado);
    expect(r.envio).toEqual(expect.any(Number));
    const outro = await salvarConfiguracoesAction(r, formulario(digitado));
    expect(outro.envio).not.toBe(r.envio); // o formulário remonta a cada envio (key), com o que foi digitado
    expect(await lerConfiguracoes(T.ctx, { db: app.db })).toBeNull();
    expect(await contar('select count(*)::int as n from fin_categorias where tenant_id = $1', T.tenantId)).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('o consultório e a usuária vêm da sessão: um tenantId no formulário não grava em outro consultório', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db, 'Outra Nutri');
    entrarComo(B);
    const fd = formulario({ saldoInicialEm: '2026-11-01', saldoInicial: '900,00', valorConsulta: '200,00', tenantId: A.tenantId, actorUserId: A.nutriId });
    await expect(salvarConfiguracoesAction({}, fd)).rejects.toThrow(`redirect ${CAMINHO}?ok=config`);
    expect(await lerConfiguracoes(A.ctx, { db: app.db })).toBeNull();
    expect(await lerConfiguracoes(B.ctx, { db: app.db })).toMatchObject({ saldoInicialCentavos: 90_000 });
    const autores = await owner.pool.query(
      `select tenant_id, actor_user_id from audit_log where entidade = 'financeiro_configuracoes' and tenant_id in ($1, $2)`,
      [A.tenantId, B.tenantId],
    );
    expect(autores.rows).toEqual([{ tenant_id: B.tenantId, actor_user_id: B.nutriId }]);
  });
});

describe('categorias (RN-303)', () => {
  it('nova categoria: grava no tipo escolhido; nome repetido volta como erro do campo, com o nome digitado', async () => {
    const T = await configurado();
    const ok = await novaCategoriaAction({}, formulario({ tipo: 'saida', nome: 'Contador' }));
    expect(ok.erros).toBeUndefined();
    expect(ok.envio).toEqual(expect.any(Number));
    expect((await categoria(T, 'Contador')).tipo).toBe('saida');
    const r = await novaCategoriaAction({}, formulario({ tipo: 'saida', nome: 'contador' }));
    expect(r).toMatchObject({ erros: { nome: EC.nomeRepetido }, valores: { nome: 'contador' } });
    expect(revalidatePath).toHaveBeenCalledWith('/painel/financeiro', 'layout');
  });

  it('renomear, arquivar, reativar e excluir pela linha da categoria', async () => {
    const T = await configurado();
    const div = await categoria(T, 'Divulgação');
    expect(await categoriaAction({}, formulario({ id: div.id, acao: 'renomear', nome: 'Anúncios' }))).toMatchObject({ feito: 'renomeada' });
    expect((await categoria(T, 'Anúncios')).id).toBe(div.id);
    expect(await categoriaAction({}, formulario({ id: div.id, acao: 'arquivar' }))).toMatchObject({ feito: 'arquivada' });
    expect((await categoria(T, 'Anúncios')).arquivadaEm).not.toBeNull();
    expect(await categoriaAction({}, formulario({ id: div.id, acao: 'reativar' }))).toMatchObject({ feito: 'reativada' });
    expect((await categoria(T, 'Anúncios')).arquivadaEm).toBeNull();
    expect(await categoriaAction({}, formulario({ id: div.id, acao: 'excluir' }))).toMatchObject({ feito: 'excluida' });
    expect(await categoria(T, 'Anúncios')).toBeUndefined();
  });

  it('as recusas do módulo voltam como erro da linha: Consultas não se arquiva; categoria com lançamento não se exclui; nome vazio', async () => {
    const T = await configurado();
    const consultas = await categoria(T, 'Consultas');
    expect(await categoriaAction({}, formulario({ id: consultas.id, acao: 'arquivar' }))).toMatchObject({ erros: { geral: EC.consultasFixa } });
    const aluguel = await categoria(T, 'Aluguel e condomínio');
    await criarLancamento(T.ctx, T.tenant, { tipo: 'saida', categoriaId: aluguel.id, valor: '1.200,00', vencimento: '2026-11-05' }, { db: app.db });
    expect(await categoriaAction({}, formulario({ id: aluguel.id, acao: 'excluir' }))).toMatchObject({ erros: { geral: EC.comLancamentos } });
    expect(await categoriaAction({}, formulario({ id: aluguel.id, acao: 'renomear', nome: '  ' }))).toMatchObject({ erros: { nome: EC.nomeTamanho }, valores: { nome: '  ' } });
    expect(await categoria(T, 'Aluguel e condomínio')).toBeDefined();
  });

  it('categoria de outro consultório não é encontrada (RLS): nada muda nele', async () => {
    const A = await configurado();
    const div = await categoria(A, 'Divulgação');
    await configurado(); // a sessão passa a ser de outro consultório
    await expect(categoriaAction({}, formulario({ id: div.id, acao: 'excluir' }))).rejects.toThrow('notFound');
    expect(await categoria(A, 'Divulgação')).toBeDefined();
  });

  it('ação fora da lista (formulário adulterado) não chega ao módulo', async () => {
    const T = await configurado();
    const div = await categoria(T, 'Divulgação');
    await expect(categoriaAction({}, formulario({ id: div.id, acao: 'apagar-tudo' }))).rejects.toThrow('notFound');
    expect(await categoria(T, 'Divulgação')).toBeDefined();
  });
});
