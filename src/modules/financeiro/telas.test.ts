import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { dbQueContaConsultas } from '../../../test/financeiro';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withTenant, type TenantContext } from '@/db/tenant';
import { lerConfiguracoes, listarCategorias, salvarConfiguracoes } from './configuracoes';
import { abrirLancamento, cancelarLancamento, criarLancamento, listarLancamentos } from './lancamentos';
import { formularioNovo, telaDeConfiguracoes, telaDeEdicao, telaDeLancamentos } from './telas';

/** RNF-301 ("cada tela em uma transação"): as telas dos lançamentos (Plano 20, T6) leem tudo num `withTenant` só. */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
const contado = dbQueContaConsultas(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
  await contado.pool.end();
});

/** 17/11/2026, 12:00 em São Paulo. */
const agora = new Date('2026-11-17T15:00:00Z');
const deps = { db: app.db, agora };
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });

type Cenario = TenantDeTeste & { p: string; bruno: string; consultas: string; aluguel: string; arquivada: string };
async function cenario(): Promise<Cenario> {
  const T = await novoTenant(app.db);
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00', valorConsulta: '250,00' }, deps);
  const cats = await listarCategorias(T.ctx, deps);
  const id = (nome: string) => cats.find((c) => c.nome === nome)!.id;
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  const bruno = (await novoPaciente(app.db, T.ctx, { nome: 'Bruno Lima' })).id;
  await withTenant(worker(T), (tx) => tx.execute(sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${bruno}`), app.db);
  const arquivada = id('Outras entradas');
  await owner.pool.query('update fin_categorias set arquivada_em = now() where id = $1', [arquivada]);
  return { ...T, p, bruno, consultas: id('Consultas'), aluguel: id('Aluguel e condomínio'), arquivada };
}
const entrada = (C: Cenario, extra: Record<string, unknown> = {}) =>
  criarLancamento(C.ctx, C.tenant, { tipo: 'entrada', valor: '250,00', categoriaId: C.consultas, vencimento: '2026-11-20', pacienteId: C.p, ...extra }, deps);
const leituras = (tenantId: string) =>
  owner.pool.query(`select entidade, entidade_id, patient_id from audit_log where tenant_id = $1 and acao = 'ler' order by criado_em`, [tenantId]).then((r) => r.rows);

/** As transações (BEGIN) e o total de consultas de uma chamada, pelo pool que conta. */
async function medir(f: (d: { db: typeof contado.db; agora: Date }) => Promise<unknown>) {
  contado.consultas.length = 0;
  await f({ db: contado.db, agora });
  const c = contado.consultas.map((q) => q.trim().toLowerCase());
  return { transacoes: c.filter((q) => q.startsWith('begin')).length, consultas: c.length };
}

describe('telaDeLancamentos (US-302, RN-306, RN-318)', () => {
  it('sem configuração: só a configuração nula, numa transação', async () => {
    const T = await novoTenant(app.db);
    expect(await telaDeLancamentos(T.ctx, T.tenant, {}, deps)).toEqual({ config: null });
    expect(await medir((d) => telaDeLancamentos(T.ctx, T.tenant, {}, d))).toEqual({ transacoes: 1, consultas: 3 + 1 });
  });

  it('a mesma lista e as mesmas categorias das funções avulsas; o paciente do filtro e UM "ler" da RN-318', async () => {
    const C = await cenario();
    await entrada(C, { descricao: 'Retorno' });
    await criarLancamento(C.ctx, C.tenant, { tipo: 'saida', valor: '90,00', categoriaId: C.aluguel, vencimento: '2026-11-05' }, deps);
    const t = await telaDeLancamentos(C.ctx, C.tenant, { pacienteId: C.p }, deps);
    if (!t.config) throw new Error('configurado');
    expect(t.config).toMatchObject({ saldoInicialEm: '2026-11-01', saldoInicialCentavos: 150000 });
    expect(t.paciente).toEqual({ id: C.p, nome: 'Ana Souza', bloqueado: false, anonimizado: false });
    expect(t.lista.linhas.map((l) => l.descricao)).toEqual(['Retorno']);
    expect(await leituras(C.tenantId)).toEqual([{ entidade: 'financeiro', entidade_id: null, patient_id: C.p }]);
    expect(t.lista).toEqual(await listarLancamentos(C.ctx, C.tenant, { pacienteId: C.p }, deps));
    expect(t.categorias).toEqual(await listarCategorias(C.ctx, deps));
    const semPaciente = await telaDeLancamentos(C.ctx, C.tenant, {}, deps);
    expect(semPaciente).toMatchObject({ paciente: null });
    if (semPaciente.config) expect(semPaciente.lista.linhas).toHaveLength(2);
  });

  it('paciente de outro consultório ou id inválido: paciente nulo', async () => {
    const C = await cenario();
    const B = await cenario();
    for (const pacienteId of [B.p, 'x']) expect(await telaDeLancamentos(C.ctx, C.tenant, { pacienteId }, deps)).toMatchObject({ paciente: null });
  });
});

describe('formularioNovo (US-301, F-D24, F-D28)', () => {
  it('sem configuração → null, em qualquer tipo', async () => {
    const T = await novoTenant(app.db);
    for (const tipo of ['entrada', 'saida', null] as const) expect(await formularioNovo(T.ctx, tipo, undefined, deps)).toBeNull();
  });

  it('entrada: categorias ativas do tipo, pacientes sem bloqueados; o pedido escolhido; bloqueado → sem paciente e com o aviso', async () => {
    const C = await cenario();
    const f = await formularioNovo(C.ctx, 'entrada', C.p, deps);
    expect(f?.categorias.map((c) => c.id)).toContain(C.consultas);
    expect(f?.categorias.map((c) => c.id)).not.toContain(C.arquivada);
    expect(f?.categorias.map((c) => c.id)).not.toContain(C.aluguel);
    expect(f?.pacientes?.map((p) => p.nome)).toEqual(['Ana Souza']);
    expect(f).toMatchObject({ escolhido: C.p, bloqueado: false });
    expect(await formularioNovo(C.ctx, 'entrada', C.bruno, deps)).toMatchObject({ escolhido: '', bloqueado: true });
    const B = await cenario();
    for (const id of [B.p, B.bruno, 'x', undefined]) expect(await formularioNovo(C.ctx, 'entrada', id, deps)).toMatchObject({ escolhido: '', bloqueado: false });
  });

  it('saída: sem pacientes, e o paciente pedido é ignorado (nem o bloqueado ganha aviso); tipo nulo só traz a configuração', async () => {
    const C = await cenario();
    const s = await formularioNovo(C.ctx, 'saida', C.bruno, deps);
    expect(s).toMatchObject({ pacientes: undefined, escolhido: '', bloqueado: false });
    expect(s?.categorias.map((c) => c.id)).toContain(C.aluguel);
    expect(s?.categorias.map((c) => c.id)).not.toContain(C.consultas);
    expect(await formularioNovo(C.ctx, null, C.p, deps)).toMatchObject({ categorias: [], pacientes: undefined, escolhido: '', bloqueado: false });
  });
});

describe('telaDeEdicao (US-302, RN-318)', () => {
  it('o lançamento de abrirLancamento (com o "ler") e as categorias do tipo, ativas ou a atual arquivada', async () => {
    const C = await cenario();
    const e = await entrada(C, { categoriaId: C.consultas });
    const t = await telaDeEdicao(C.ctx, C.tenant, e.id, deps);
    expect(t?.lancamento).toEqual(await abrirLancamento(C.ctx, C.tenant, e.id, deps));
    expect(t?.categorias.map((c) => c.id)).toContain(C.consultas);
    expect(t?.categorias.map((c) => c.id)).not.toContain(C.arquivada);
    expect(await leituras(C.tenantId)).toEqual([
      { entidade: 'financeiro', entidade_id: e.id, patient_id: C.p },
      { entidade: 'financeiro', entidade_id: e.id, patient_id: C.p },
    ]);
  });

  it('cancelado: só leitura, sem categorias; de outro consultório ou inválido → null', async () => {
    const C = await cenario();
    const e = await entrada(C);
    await cancelarLancamento(C.ctx, e.id, 'Lançado em dobro', deps);
    expect(await telaDeEdicao(C.ctx, C.tenant, e.id, deps)).toMatchObject({ lancamento: { id: e.id, situacao: 'cancelado' }, categorias: [] });
    const B = await cenario();
    expect(await telaDeEdicao(B.ctx, B.tenant, e.id, deps)).toBeNull();
    expect(await telaDeEdicao(C.ctx, C.tenant, 'x', deps)).toBeNull();
  });
});

describe('telaDeConfiguracoes (US-300, RN-301, RN-303)', () => {
  it('a configuração e todas as categorias (arquivadas também) das funções avulsas; sem configuração, sem categorias', async () => {
    const C = await cenario();
    const t = await telaDeConfiguracoes(C.ctx, deps);
    expect(t.config).toEqual(await lerConfiguracoes(C.ctx, deps));
    expect(t.categorias).toEqual(await listarCategorias(C.ctx, deps));
    expect(t.categorias.map((c) => c.id)).toContain(C.arquivada);
    const T = await novoTenant(app.db);
    expect(await telaDeConfiguracoes(T.ctx, deps)).toEqual({ config: null, categorias: [] });
  });
});

describe('RNF-301: cada tela em uma transação', () => {
  it('lista, formulário novo e edição: um BEGIN cada, com um número fixo de consultas', async () => {
    const C = await cenario();
    const e = await entrada(C);
    // BEGIN, set_config do withTenant e COMMIT + as consultas de cada tela
    expect({
      lista: await medir((d) => telaDeLancamentos(C.ctx, C.tenant, {}, d)),
      // configuração, paciente, linhas, totais, mês mais antigo, auditRead, categorias
      listaDoPaciente: await medir((d) => telaDeLancamentos(C.ctx, C.tenant, { pacienteId: C.p }, d)),
      // configuração, categorias, pacientes, paciente pedido (bloqueado)
      novaEntrada: await medir((d) => formularioNovo(C.ctx, 'entrada', C.bruno, d)),
      novaSaida: await medir((d) => formularioNovo(C.ctx, 'saida', undefined, d)),
      // lançamento, auditRead, categorias
      edicao: await medir((d) => telaDeEdicao(C.ctx, C.tenant, e.id, d)),
      // configuração, categorias
      configuracoes: await medir((d) => telaDeConfiguracoes(C.ctx, d)),
      configuracoesSemConfig: await medir(async (d) => telaDeConfiguracoes((await novoTenant(app.db)).ctx, d)),
    }).toEqual({
      lista: { transacoes: 1, consultas: 3 + 5 }, // configuração, linhas, totais, mês mais antigo, categorias
      listaDoPaciente: { transacoes: 1, consultas: 3 + 7 },
      novaEntrada: { transacoes: 1, consultas: 3 + 4 },
      novaSaida: { transacoes: 1, consultas: 3 + 2 },
      edicao: { transacoes: 1, consultas: 3 + 3 },
      configuracoes: { transacoes: 1, consultas: 3 + 2 },
      configuracoesSemConfig: { transacoes: 1, consultas: 3 + 1 },
    });
  });

  it('só a sessão nutri: paciente e worker recebem o erro antes de abrir a transação', async () => {
    const C = await cenario();
    for (const ctx of [ctxPaciente(C.tenantId, C.p), worker(C)]) {
      expect(
        await medir(async (d) => {
          await expect(telaDeLancamentos(ctx, C.tenant, {}, d)).rejects.toThrow('financeiro: só a sessão nutri');
          await expect(formularioNovo(ctx, 'entrada', undefined, d)).rejects.toThrow('financeiro: só a sessão nutri');
          await expect(telaDeEdicao(ctx, C.tenant, C.p, d)).rejects.toThrow('financeiro: só a sessão nutri');
          await expect(telaDeConfiguracoes(ctx, d)).rejects.toThrow('financeiro: só a sessão nutri');
        }),
      ).toEqual({ transacoes: 0, consultas: 0 });
    }
  });
});

describe('RNF-301: as páginas dos lançamentos e das Configurações leem só pela função da tela', () => {
  const AVULSAS = /\b(lerConfiguracoes|listarCategorias|listarLancamentos|abrirLancamento|pacienteDoFinanceiro|pacientesParaLancamento)\b/;
  it.each([
    ['src/app/painel/financeiro/lancamentos/page.tsx', 'telaDeLancamentos'],
    ['src/app/painel/financeiro/lancamentos/novo/page.tsx', 'formularioNovo'],
    ['src/app/painel/financeiro/lancamentos/[id]/page.tsx', 'telaDeEdicao'],
    ['src/app/painel/financeiro/configuracoes/page.tsx', 'telaDeConfiguracoes'],
  ])('%s chama só %s', (arquivo, funcao) => {
    const fonte = readFileSync(arquivo, 'utf8');
    expect(fonte).not.toMatch(AVULSAS);
    expect(fonte.match(new RegExp(`await ${funcao}\\(`, 'g'))).toHaveLength(1);
    expect(fonte).not.toContain('Promise.all');
  });
});
