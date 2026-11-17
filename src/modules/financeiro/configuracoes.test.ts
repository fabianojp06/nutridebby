import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import {
  arquivarCategoria,
  criarCategoria,
  excluirCategoria,
  lerConfiguracoes,
  listarCategorias,
  reativarCategoria,
  renomearCategoria,
  salvarConfiguracoes,
} from './configuracoes';
import { CATEGORIAS_INICIAIS, MSG_FINANCEIRO } from './constantes';
import { FinanceiroError, FinanceiroNaoConfiguradoError } from './erros';
import { criarLancamento } from './lancamentos';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const E = MSG_FINANCEIRO.errosConfig;
const EC = MSG_FINANCEIRO.errosCategoria;
/** 17/11/2026 22:30 em São Paulo (servidor em UTC já no dia 18). */
const agora = new Date('2026-11-18T01:30:00Z');
const deps = { db: app.db, agora };
const config = { saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00', valorConsulta: '250,00' };

const contar = async (sql: string, ...params: unknown[]) => (await owner.pool.query(sql, params)).rows[0].n as number;
const categoriasNoBanco = (tenantId: string) =>
  owner.pool.query('select tipo, nome, chave from fin_categorias where tenant_id = $1 order by tipo, nome', [tenantId]).then((r) => r.rows);

/** O erro do campo (FinanceiroError), ou falha o teste. */
async function errosDe(p: Promise<unknown>): Promise<Record<string, string>> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(FinanceiroError);
  return (e as FinanceiroError).erros;
}

async function configurado(): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db);
  await salvarConfiguracoes(T.ctx, T.tenant, config, deps);
  return T;
}
const categoria = async (T: TenantDeTeste, nome: string) => (await listarCategorias(T.ctx, deps)).find((c) => c.nome === nome)!;

describe('Configurações do Financeiro (US-300, RN-301, RN-302, RN-320, RN-324, RN-325)', () => {
  it('sem configuração: a leitura devolve null e não grava nada (nem categoria nem audit_log)', async () => {
    const T = await novoTenant(app.db);
    expect(await lerConfiguracoes(T.ctx, deps)).toBeNull();
    expect(await listarCategorias(T.ctx, deps)).toEqual([]);
    expect(await contar('select count(*)::int as n from fin_categorias where tenant_id = $1', T.tenantId)).toBe(0);
    expect(await contar('select count(*)::int as n from fin_configuracoes where tenant_id = $1', T.tenantId)).toBe(0);
    expect(await contar('select count(*)::int as n from audit_log where tenant_id = $1', T.tenantId)).toBe(0);
  });

  it('a primeira gravação salva os valores em centavos e semeia as categorias iniciais', async () => {
    const T = await configurado();
    expect(await lerConfiguracoes(T.ctx, deps)).toEqual({ saldoInicialCentavos: 150000, saldoInicialEm: '2026-11-01', valorConsultaCentavos: 25000 });
    const nomes = (await listarCategorias(T.ctx, deps)).map((c) => [c.tipo, c.nome, c.chave]);
    expect(nomes.sort()).toEqual(CATEGORIAS_INICIAIS.map((c) => [c.tipo, c.nome, c.chave]).sort());
  });

  it('duas primeiras gravações ao mesmo tempo: um conjunto só de categorias', async () => {
    const T = await novoTenant(app.db);
    await Promise.all([
      salvarConfiguracoes(T.ctx, T.tenant, config, deps),
      salvarConfiguracoes(T.ctx, T.tenant, { ...config, saldoInicial: '-320,00' }, deps),
      salvarConfiguracoes(T.ctx, T.tenant, { ...config, valorConsulta: '' }, deps),
    ]);
    expect(await contar('select count(*)::int as n from fin_categorias where tenant_id = $1', T.tenantId)).toBe(CATEGORIAS_INICIAIS.length);
    expect(await contar('select count(*)::int as n from fin_configuracoes where tenant_id = $1', T.tenantId)).toBe(1);
  });

  it('a segunda gravação muda os valores e não semeia de novo (nem a categoria apagada volta)', async () => {
    const T = await configurado();
    await excluirCategoria(T.ctx, (await categoria(T, 'Divulgação')).id, deps);
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-10-31', saldoInicial: '-320,00', valorConsulta: '' }, deps);
    expect(await lerConfiguracoes(T.ctx, deps)).toEqual({ saldoInicialCentavos: -32000, saldoInicialEm: '2026-10-31', valorConsultaCentavos: null });
    expect((await categoriasNoBanco(T.tenantId)).map((c) => c.nome)).not.toContain('Divulgação');
    expect(await contar('select count(*)::int as n from fin_categorias where tenant_id = $1', T.tenantId)).toBe(CATEGORIAS_INICIAIS.length - 1);
  });

  it('cada gravação grava um "alterar" de financeiro_configuracoes, sem paciente, com a autora (RN-320)', async () => {
    const T = await configurado();
    await salvarConfiguracoes(T.ctx, T.tenant, { ...config, valorConsulta: '300' }, deps);
    const { rows } = await owner.pool.query(
      `select acao, entidade, entidade_id, patient_id, actor_user_id from audit_log where tenant_id = $1 and entidade = 'financeiro_configuracoes' order by criado_em`,
      [T.tenantId],
    );
    expect(rows).toEqual([
      { acao: 'alterar', entidade: 'financeiro_configuracoes', entidade_id: T.tenantId, patient_id: null, actor_user_id: T.nutriId },
      { acao: 'alterar', entidade: 'financeiro_configuracoes', entidade_id: T.tenantId, patient_id: null, actor_user_id: T.nutriId },
    ]);
  });

  it('erros com os textos exatos (§6.2), todos de uma vez, e nada gravado', async () => {
    const T = await novoTenant(app.db);
    expect(await errosDe(salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '20.000.000,00', valorConsulta: 'abc' }, deps))).toEqual({
      saldoInicial: E.saldoFaixa,
      valorConsulta: E.valorInvalido,
    });
    expect(await errosDe(salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '', saldoInicial: '', valorConsulta: '1.000.000,01' }, deps))).toEqual({
      saldoInicialEm: E.informeDataSaldo,
      saldoInicial: E.informeValorSaldo,
      valorConsulta: E.valorConsultaFaixa,
    });
    expect(await errosDe(salvarConfiguracoes(T.ctx, T.tenant, { ...config, saldoInicial: '-10.000.000,01', valorConsulta: '0,00' }, deps))).toEqual({
      saldoInicial: E.saldoFaixa,
      valorConsulta: E.valorConsultaFaixa,
    });
    expect(await errosDe(salvarConfiguracoes(T.ctx, T.tenant, { ...config, saldoInicial: 'abc' }, deps))).toEqual({ saldoInicial: E.valorInvalido });
    expect(await errosDe(salvarConfiguracoes(T.ctx, T.tenant, { ...config, saldoInicialEm: '2026-02-30' }, deps))).toEqual({ saldoInicialEm: MSG_FINANCEIRO.erros.dataInvalida });
    expect(await errosDe(salvarConfiguracoes(T.ctx, T.tenant, { ...config, saldoInicialEm: '1999-12-31' }, deps))).toEqual({ saldoInicialEm: MSG_FINANCEIRO.erros.dataInvalida });
    expect(await contar('select count(*)::int as n from fin_configuracoes where tenant_id = $1', T.tenantId)).toBe(0);
  });

  it('data do saldo no fuso do consultório: 18/11 é amanhã às 22:30 de 17/11 em São Paulo (servidor já no dia 18 em UTC)', async () => {
    const T = await novoTenant(app.db);
    expect(T.tenant.fuso).toBe('America/Sao_Paulo');
    expect(await errosDe(salvarConfiguracoes(T.ctx, T.tenant, { ...config, saldoInicialEm: '2026-11-18' }, deps))).toEqual({ saldoInicialEm: E.saldoFuturo });
    await salvarConfiguracoes(T.ctx, T.tenant, { ...config, saldoInicialEm: '2026-11-17' }, deps);
    expect((await lerConfiguracoes(T.ctx, deps))?.saldoInicialEm).toBe('2026-11-17');
  });

  it('só a sessão nutri: a de paciente recebe o erro do assert (não uma leitura vazia)', async () => {
    const T = await configurado();
    const p = await novoPaciente(app.db, T.ctx);
    const pac = ctxPaciente(T.tenantId, p.id);
    await expect(lerConfiguracoes(pac, deps)).rejects.toThrow('financeiro: só a sessão nutri');
    await expect(salvarConfiguracoes(pac, T.tenant, config, deps)).rejects.toThrow('financeiro: só a sessão nutri');
    await expect(listarCategorias(pac, deps)).rejects.toThrow('financeiro: só a sessão nutri');
    await expect(criarCategoria(pac, { tipo: 'saida', nome: 'X' }, deps)).rejects.toThrow('financeiro: só a sessão nutri');
    await expect(salvarConfiguracoes({ tenantId: T.tenantId, role: 'worker' }, T.tenant, config, deps)).rejects.toThrow('financeiro: só a sessão nutri');
  });

  it('outro consultório não vê a configuração nem as categorias', async () => {
    await configurado();
    const B = await novoTenant(app.db);
    expect(await lerConfiguracoes(B.ctx, deps)).toBeNull();
    expect(await listarCategorias(B.ctx, deps)).toEqual([]);
  });
});

describe('Categorias (RN-303)', () => {
  it('criar, renomear, arquivar e reativar', async () => {
    const T = await configurado();
    await criarCategoria(T.ctx, { tipo: 'saida', nome: '  Supervisão clínica  ' }, deps);
    const c = await categoria(T, 'Supervisão clínica');
    expect(c).toMatchObject({ tipo: 'saida', chave: null, arquivadaEm: null });
    await renomearCategoria(T.ctx, c.id, 'Supervisão', deps);
    await arquivarCategoria(T.ctx, c.id, deps);
    expect((await categoria(T, 'Supervisão')).arquivadaEm).toBeInstanceOf(Date);
    await reativarCategoria(T.ctx, c.id, deps);
    expect((await categoria(T, 'Supervisão')).arquivadaEm).toBeNull();
  });

  it('"Consultas" pode mudar de nome, mas não arquiva nem exclui (mensagem exata)', async () => {
    const T = await configurado();
    const c = await categoria(T, 'Consultas');
    expect(await errosDe(arquivarCategoria(T.ctx, c.id, deps))).toEqual({ geral: EC.consultasFixa });
    expect(await errosDe(excluirCategoria(T.ctx, c.id, deps))).toEqual({ geral: EC.consultasFixa });
    await renomearCategoria(T.ctx, c.id, 'Atendimentos', deps);
    expect(await categoria(T, 'Atendimentos')).toMatchObject({ chave: 'consultas', arquivadaEm: null });
  });

  it('categoria com lançamento não se exclui (mensagem exata); sem lançamento, sai', async () => {
    const T = await configurado();
    const aluguel = await categoria(T, 'Aluguel e condomínio');
    await criarLancamento(T.ctx, T.tenant, { tipo: 'saida', valor: '1.200,00', categoriaId: aluguel.id, vencimento: '2026-11-05' }, deps);
    expect(await errosDe(excluirCategoria(T.ctx, aluguel.id, deps))).toEqual({ geral: EC.comLancamentos });
    const div = await categoria(T, 'Divulgação');
    await excluirCategoria(T.ctx, div.id, deps);
    expect((await listarCategorias(T.ctx, deps)).map((c) => c.id)).not.toContain(div.id);
  });

  it('nome repetido no mesmo tipo, sem diferença de maiúsculas → "Já existe uma categoria com este nome."; no outro tipo, pode', async () => {
    const T = await configurado();
    expect(await errosDe(criarCategoria(T.ctx, { tipo: 'saida', nome: 'divulgação' }, deps))).toEqual({ nome: EC.nomeRepetido });
    const c = await categoria(T, 'Equipamentos');
    expect(await errosDe(renomearCategoria(T.ctx, c.id, 'MATERIAL E INSUMOS', deps))).toEqual({ nome: EC.nomeRepetido });
    await criarCategoria(T.ctx, { tipo: 'entrada', nome: 'Divulgação' }, deps);
  });

  it('nome de 1 a 60 caracteres', async () => {
    const T = await configurado();
    expect(await errosDe(criarCategoria(T.ctx, { tipo: 'saida', nome: '   ' }, deps))).toEqual({ nome: EC.nomeTamanho });
    expect(await errosDe(criarCategoria(T.ctx, { tipo: 'saida', nome: 'x'.repeat(61) }, deps))).toEqual({ nome: EC.nomeTamanho });
    await criarCategoria(T.ctx, { tipo: 'saida', nome: 'é'.repeat(60) }, deps);
  });

  it('sem configuração não cria categoria (a semente da primeira gravação não pode bater num nome já usado)', async () => {
    const T = await novoTenant(app.db);
    await expect(criarCategoria(T.ctx, { tipo: 'entrada', nome: 'Consultas' }, deps)).rejects.toBeInstanceOf(FinanceiroNaoConfiguradoError);
  });

  it('categoria de outro consultório não é encontrada', async () => {
    const A = await configurado();
    const B = await configurado();
    const c = await categoria(A, 'Divulgação');
    await expect(arquivarCategoria(B.ctx, c.id, deps)).rejects.toThrow();
    await expect(excluirCategoria(B.ctx, c.id, deps)).rejects.toThrow();
    expect(await categoria(A, 'Divulgação')).toMatchObject({ arquivadaEm: null });
  });
});
