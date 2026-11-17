import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql, type Column, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { finCategorias, finLancamentos, patients, type TipoLancamento } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { auditRead } from '@/modules/plataforma/audit';
import { configuracaoNaTransacao, type Configuracao } from './configuracoes';
import { exigirNutri } from './erros';
import { naTela, selecionarNaTela } from './lancamentos';
import { intervaloDoMes, mesDe, mesesDoAno, ultimos12Meses } from './meses';
import type { FluxoDoAno, LancamentoNaTela, LinhaFluxo } from './tipos';

/**
 * Agregados do Financeiro (Plano 20, T4): Resumo (US-305), fluxo de caixa do ano e 12 meses (US-306) e pagamentos pendentes
 * (US-304). RNF-301: uma transação por função, um número fixo de consultas (sem N+1), somas no SQL (`sum … filter`, em
 * `bigint`, de volta como texto). Cancelados nunca entram nos totais (RN-306). "Hoje" é sempre o do fuso do consultório.
 */
type Deps = { db?: Db; agora?: Date };
type Tenant = { fuso: string };

export type ResumoDoMes = {
  configurado: boolean;
  saldoAtual: number | null;
  saldoDesde: string | null;
  semValorConsulta: boolean;
  entradas: { recebido: number; aReceber: number; atrasoAnterior: number };
  saidas: { pago: number; aPagar: number; atrasoAnterior: number };
  pendentes: { pacientes: number; total: number };
  ultimos: LancamentoNaTela[];
};
export type EntradasESaidasDoMes = { mes: string; entradas: number; saidas: number; resultado: number };
export type PagamentoPendente = { paciente: { id: string; nome: string }; total: number; quantidade: number; maisAntiga: string; emAtraso: boolean };
export type PendenciasDoPaciente = { paciente: { id: string; nome: string; bloqueado: boolean }; linhas: LancamentoNaTela[] };

/** "Últimos lançamentos" do Resumo. */
export const ULTIMOS = 10;

const L = finLancamentos;
const ativo = isNull(L.canceladoEm);
const entrada = sql`${L.tipo} = 'entrada'`;
const saida = sql`${L.tipo} = 'saida'`;
const pago = isNotNull(L.pagoEm);
const aberto = isNull(L.pagoEm);
/** Valor com sinal: entrada soma, saída subtrai. */
const movimento = sql`case when ${entrada} then ${L.valorCentavos}::bigint else -${L.valorCentavos}::bigint end`;
const somaSe = (valor: SQL, condicao: SQL | undefined) => sql<string>`coalesce(sum(${valor}) filter (where ${condicao}), 0)::text`;
const soma = (condicao: SQL | undefined) => somaSe(sql`${L.valorCentavos}::bigint`, condicao);
const somaTudo = sql<string>`coalesce(sum(${L.valorCentavos}::bigint), 0)::text`;
const somaMovimento = sql<string>`coalesce(sum(${movimento}), 0)::text`;
const entre = (coluna: Column, de: string, ate: string) => sql`${coluna} between ${de} and ${ate}`;
const mesDoPagamento = sql<string | null>`to_char(${L.pagoEm}, 'YYYY-MM')`;
/** RN-311: entradas com paciente, não canceladas e sem recebimento (previstas ou em atraso). */
const pendenteDoPaciente = and(entrada, isNotNull(L.patientId), ativo, aberto);

/** RNF-304: o `bigint` volta como texto e só vira `number` se couber sem perda. */
function centavos(texto: string | number | null | undefined): number {
  const n = Number(texto ?? 0);
  if (!Number.isSafeInteger(n)) throw new RangeError('financeiro: soma fora do inteiro seguro');
  return n;
}

/**
 * US-305 / RN-307. Saldo atual = saldo do caixa + recebidos − pagos, não cancelados, com pagamento no dia do saldo ou
 * depois. Cartões do mês de hoje pela data de referência (RN-306): recebido/pago pelo dia do pagamento no mês; a receber/
 * a pagar em aberto com vencimento no mês; atraso de meses anteriores em aberto com vencimento antes do dia 1º. Pagamentos
 * pendentes como a RN-311. Últimos: os 10 lançados por último (cancelados incluídos, como na lista). Sem `auditRead` (RN-318).
 */
export async function resumoDoMes(ctx: TenantContext, tenant: Tenant, deps: Deps = {}): Promise<ResumoDoMes> {
  exigirNutri(ctx);
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  const { de, ate } = intervaloDoMes(mesDe(hoje));
  return withTenant(
    ctx,
    async (tx) => {
      const config = await configuracaoNaTransacao(tx);
      // RNF-301: o WHERE só deixa passar o que algum `filter` usa — pagos desde o saldo ou o dia 1º (o que vier antes) e os
      // em aberto —, no formato dos índices parciais (pago_idx com faixa de pago_em, aberto_idx): BitmapOr no consultório,
      // nunca a tabela de todos os consultórios
      const pagosDesde = config && config.saldoInicialEm < de ? config.saldoInicialEm : de;
      const [a] = await tx
        .select({
          // sem configuração não há saldo: a data do saldo vira uma condição sempre falsa
          saldo: somaSe(movimento, and(pago, config ? sql`${L.pagoEm} >= ${config.saldoInicialEm}` : sql`false`)),
          recebido: soma(and(entrada, entre(L.pagoEm, de, ate))),
          aReceber: soma(and(entrada, aberto, entre(L.vencimento, de, ate))),
          atrasoEntradas: soma(and(entrada, aberto, sql`${L.vencimento} < ${de}`)),
          pago: soma(and(saida, entre(L.pagoEm, de, ate))),
          aPagar: soma(and(saida, aberto, entre(L.vencimento, de, ate))),
          atrasoSaidas: soma(and(saida, aberto, sql`${L.vencimento} < ${de}`)),
          pendentesPacientes: sql<number>`count(distinct ${L.patientId}) filter (where ${pendenteDoPaciente})::int`,
          pendentesTotal: soma(pendenteDoPaciente),
        })
        .from(L)
        .where(and(eq(L.tenantId, ctx.tenantId), ativo, or(and(pago, gte(L.pagoEm, pagosDesde)), aberto)));
      // pelo fin_lancamentos_criado_idx (tenant_id, created_at, id), de trás para a frente
      const ultimos = await selecionarNaTela(tx).where(eq(L.tenantId, ctx.tenantId)).orderBy(desc(L.createdAt), desc(L.id)).limit(ULTIMOS);
      return {
        configurado: config !== null,
        saldoAtual: config ? config.saldoInicialCentavos + centavos(a.saldo) : null,
        saldoDesde: config?.saldoInicialEm ?? null,
        semValorConsulta: config !== null && config.valorConsultaCentavos === null,
        entradas: { recebido: centavos(a.recebido), aReceber: centavos(a.aReceber), atrasoAnterior: centavos(a.atrasoEntradas) },
        saidas: { pago: centavos(a.pago), aPagar: centavos(a.aPagar), atrasoAnterior: centavos(a.atrasoSaidas) },
        pendentes: { pacientes: a.pendentesPacientes, total: centavos(a.pendentesTotal) },
        ultimos: ultimos.map((r) => naTela(r, hoje)),
      };
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-306. Só recebidos e pagos, não cancelados, pelo mês do pagamento. Uma linha por categoria do tipo — as arquivadas só
 * se tiveram movimento no ano —, na ordem das Configurações ("Consultas" primeiro, depois pelo nome). Saldo (RN-307, F-D29):
 * nulo antes do mês do saldo do caixa; no mês do saldo, início nulo e fim = saldo + movimentos desde a data do saldo (o que
 * foi pago antes dela fica nas linhas, não no saldo); depois, início = fim anterior e fim = início + resultado.
 */
export async function fluxoDeCaixaDoAno(ctx: TenantContext, tenant: Tenant, ano: number, deps: Deps = {}): Promise<FluxoDoAno> {
  exigirNutri(ctx);
  conferirAno(ano);
  return withTenant(ctx, async (tx) => fluxoNaTransacao(tx, ctx.tenantId, ano, await configuracaoNaTransacao(tx)), deps.db ?? getDb());
}

/** RangeError fora de 2000 a 2100 (a rota e a tela conferem antes). */
function conferirAno(ano: number): void {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new RangeError('financeiro: ano fora da faixa');
}

/** `fluxoDeCaixaDoAno` na transação de quem chama (a tela de Relatórios e o CSV do fluxo, RNF-301), com a configuração já lida. */
export async function fluxoNaTransacao(tx: Tx, tenantId: string, ano: number, config: Configuracao | null): Promise<FluxoDoAno> {
  conferirAno(ano);
  const meses = mesesDoAno(ano);
  const de = `${ano}-01-01`;
  const ate = `${ano}-12-31`;
  // left join: a categoria sem movimento no ano volta numa linha só, com mês nulo
  const celulas = await tx
    .select({
      id: finCategorias.id,
      tipo: finCategorias.tipo,
      nome: finCategorias.nome,
      arquivada: sql<boolean>`${finCategorias.arquivadaEm} is not null`,
      mes: mesDoPagamento,
      valor: somaTudo,
    })
    .from(finCategorias)
    .leftJoin(
      L,
      and(eq(L.tenantId, finCategorias.tenantId), eq(L.categoriaId, finCategorias.id), ativo, pago, entre(L.pagoEm, de, ate)),
    )
    .where(eq(finCategorias.tenantId, tenantId))
    .groupBy(finCategorias.id, mesDoPagamento)
    .orderBy(asc(finCategorias.tipo), sql`${finCategorias.chave} is null`, sql`lower(${finCategorias.nome})`, asc(finCategorias.id));

  const linhas = new Map<string, LinhaFluxo & { tipo: TipoLancamento; arquivada: boolean; comMovimento: boolean }>();
  for (const c of celulas) {
    const linha = linhas.get(c.id) ?? { categoria: c.nome, valores: Array(12).fill(0), tipo: c.tipo, arquivada: c.arquivada, comMovimento: false };
    linhas.set(c.id, linha);
    if (c.mes) {
      linha.valores[meses.indexOf(c.mes)] = centavos(c.valor);
      linha.comMovimento = true;
    }
  }
  const visiveis = [...linhas.values()].filter((l) => !l.arquivada || l.comMovimento);
  const doTipo = (tipo: TipoLancamento) => visiveis.filter((l) => l.tipo === tipo).map(({ categoria, valores }) => ({ categoria, valores }));
  const categoriasEntrada = doTipo('entrada');
  const categoriasSaida = doTipo('saida');
  const somaPorMes = (ls: LinhaFluxo[]) => meses.map((_, i) => ls.reduce((s, l) => s + l.valores[i], 0));
  const totalEntradas = somaPorMes(categoriasEntrada);
  const totalSaidas = somaPorMes(categoriasSaida);
  const resultado = totalEntradas.map((e, i) => e - totalSaidas[i]);

  const saldoInicio: (number | null)[] = Array(12).fill(null);
  const saldoFim: (number | null)[] = Array(12).fill(null);
  if (config && config.saldoInicialEm <= ate) {
    const mesDoSaldo = mesDe(config.saldoInicialEm);
    const noAno = mesDoSaldo >= meses[0];
    const fimDoMesDoSaldo = intervaloDoMes(mesDoSaldo).ate;
    // antes do ano (saldo de um ano anterior) ou do mês do saldo até o fim dele (saldo neste ano); tudo no WHERE, para a
    // faixa de pago_em ir pelo fin_lancamentos_pago_idx (RNF-301)
    const [s] = await tx
      .select({ movimento: somaMovimento })
      .from(L)
      .where(
        and(eq(L.tenantId, tenantId), ativo, pago, gte(L.pagoEm, config.saldoInicialEm), noAno ? lte(L.pagoEm, fimDoMesDoSaldo) : lt(L.pagoEm, de)),
      );
    const base = config.saldoInicialCentavos + centavos(s.movimento);
    // saldo de um ano anterior: `base` é o início de janeiro; neste ano: `base` é o fim do mês do saldo
    let anterior: number | null = noAno ? null : base;
    meses.forEach((mes, i) => {
      if (mes < mesDoSaldo) return;
      if (mes === mesDoSaldo) saldoFim[i] = base;
      else {
        saldoInicio[i] = anterior;
        saldoFim[i] = anterior! + resultado[i];
      }
      anterior = saldoFim[i];
    });
  }
  return {
    ano,
    meses,
    categoriasEntrada,
    categoriasSaida,
    totalEntradas,
    totalSaidas,
    resultado,
    saldoInicio,
    saldoFim,
    saldoDesde: config?.saldoInicialEm ?? null,
  };
}

/** US-306 "Entradas e saídas nos últimos 12 meses": recebidos e pagos, não cancelados, do mês de hoje e dos 11 anteriores. */
export async function entradasESaidas12Meses(ctx: TenantContext, tenant: Tenant, deps: Deps = {}): Promise<EntradasESaidasDoMes[]> {
  exigirNutri(ctx);
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(ctx, (tx) => dozeMesesNaTransacao(tx, ctx.tenantId, hoje), deps.db ?? getDb());
}

/** `entradasESaidas12Meses` na transação de quem chama (a tela de Relatórios, RNF-301). */
export async function dozeMesesNaTransacao(tx: Tx, tenantId: string, hoje: string): Promise<EntradasESaidasDoMes[]> {
  const meses = ultimos12Meses(hoje);
  const de = `${meses[0]}-01`;
  const { ate } = intervaloDoMes(meses[11]);
  const porMes = await tx
    .select({ mes: mesDoPagamento, entradas: soma(entrada), saidas: soma(saida) })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), ativo, pago, entre(L.pagoEm, de, ate)))
    .groupBy(mesDoPagamento);
  const doMes = new Map(porMes.map((m) => [m.mes, m]));
  return meses.map((mes) => {
    const m = doMes.get(mes);
    const entradas = centavos(m?.entradas);
    const saidas = centavos(m?.saidas);
    return { mes, entradas, saidas, resultado: entradas - saidas };
  });
}

/**
 * US-304 / RN-311: por paciente — total em aberto, quantidade, vencimento mais antigo e "Em atraso" se algum venceu antes
 * de hoje —, da cobrança mais antiga para a mais nova. Sem `auditRead` (RN-318: nome, total e data, como a agenda).
 */
export async function pagamentosPendentes(ctx: TenantContext, tenant: Tenant, deps: Deps = {}): Promise<PagamentoPendente[]> {
  exigirNutri(ctx);
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(ctx, (tx) => pendentesNaTransacao(tx, ctx.tenantId, hoje), deps.db ?? getDb());
}

/** `pagamentosPendentes` na transação de quem chama (a tela "Pagamentos pendentes", RNF-301), também sem `auditRead`. */
export async function pendentesNaTransacao(tx: Tx, tenantId: string, hoje: string): Promise<PagamentoPendente[]> {
  const maisAntiga = sql<string>`min(${L.vencimento})::text`;
  const linhas = await tx
    .select({
      id: patients.id,
      nome: patients.nome,
      total: somaTudo,
      quantidade: sql<number>`count(*)::int`,
      maisAntiga,
      emAtraso: sql<boolean>`bool_or(${L.vencimento} < ${hoje})`,
    })
    .from(L)
    .innerJoin(patients, and(eq(patients.tenantId, L.tenantId), eq(patients.id, L.patientId)))
    .where(and(eq(L.tenantId, tenantId), pendenteDoPaciente))
    .groupBy(patients.id, patients.nome)
    .orderBy(asc(maisAntiga), asc(patients.nome), asc(patients.id));
  return linhas.map((p) => ({ paciente: { id: p.id, nome: p.nome }, total: centavos(p.total), quantidade: p.quantidade, maisAntiga: p.maisAntiga, emAtraso: p.emAtraso }));
}

/**
 * "Pagamentos pendentes de {nome}" (US-304): as cobranças em aberto do paciente, a mais antiga primeiro. `null` se o paciente
 * não existe no consultório; sem pendência, o paciente com a lista vazia (a tela mostra o nome no estado vazio). RN-318:
 * com linha devolvida, **um** `ler` (entidade `financeiro`, sem `entidadeId`) por abertura — nunca um por lançamento.
 */
export async function pendenciasDoPaciente(ctx: TenantContext, tenant: Tenant, patientId: string, deps: Deps = {}): Promise<PendenciasDoPaciente | null> {
  exigirNutri(ctx);
  if (!idValido(patientId)) return null;
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: patients.id, nome: patients.nome, status: patients.status }).from(patients).where(eq(patients.id, patientId));
      if (!p) return null;
      const linhas = await selecionarNaTela(tx)
        .where(and(eq(L.tenantId, ctx.tenantId), eq(L.patientId, patientId), pendenteDoPaciente))
        .orderBy(asc(L.vencimento), asc(L.createdAt), asc(L.id));
      if (linhas.length) await auditRead(tx, { entidade: 'financeiro', entidadeId: null, patientId });
      return { paciente: { id: p.id, nome: p.nome, bloqueado: p.status === 'bloqueado' }, linhas: linhas.map((r) => naTela(r, hoje)) };
    },
    deps.db ?? getDb(),
  );
}
