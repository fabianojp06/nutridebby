import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql, type Column, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { finCategorias, finLancamentos, patientCadastro, patients, type TipoLancamento } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { auditRead } from '@/modules/plataforma/audit';
import { configuracaoNaTransacao, type Configuracao } from './configuracoes';
import { MSG_FINANCEIRO } from './constantes';
import { centavos } from './dinheiro';
import { exigirNutri } from './erros';
import { naTela, selecionarNaTela, situacaoDoPaciente } from './lancamentos';
import { intervaloDoMes, mesDe, mesesDoAno, ultimos12Meses } from './meses';
import { cadastroDoPaciente, nomeDeExibicao } from './nome';
import { dataDeReferencia, ROTULO_SITUACAO, situacaoDoLancamento } from './situacao';
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
export type PendenciasDoPaciente = { paciente: NonNullable<LancamentoNaTela['paciente']>; linhas: LancamentoNaTela[] };

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
      nome: nomeDeExibicao, // Plano 18 (RN-266): o nome social primeiro
      total: somaTudo,
      quantidade: sql<number>`count(*)::int`,
      maisAntiga,
      emAtraso: sql<boolean>`bool_or(${L.vencimento} < ${hoje})`,
    })
    .from(L)
    .innerJoin(patients, and(eq(patients.tenantId, L.tenantId), eq(patients.id, L.patientId)))
    .leftJoin(patientCadastro, cadastroDoPaciente)
    .where(and(eq(L.tenantId, tenantId), pendenteDoPaciente))
    .groupBy(patients.id, patients.nome, patientCadastro.nomeSocial)
    .orderBy(asc(maisAntiga), asc(nomeDeExibicao), asc(patients.id));
  return linhas.map((p) => ({ paciente: { id: p.id, nome: p.nome ?? '' }, total: centavos(p.total), quantidade: p.quantidade, maisAntiga: p.maisAntiga, emAtraso: p.emAtraso }));
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
      const [p] = await tx
        .select({ id: patients.id, nome: nomeDeExibicao, status: patients.status, anonimizadoEm: patients.anonimizadoEm })
        .from(patients)
        .leftJoin(patientCadastro, cadastroDoPaciente)
        .where(eq(patients.id, patientId));
      if (!p) return null;
      const linhas = await selecionarNaTela(tx)
        .where(and(eq(L.tenantId, ctx.tenantId), eq(L.patientId, patientId), pendenteDoPaciente))
        .orderBy(asc(L.vencimento), asc(L.createdAt), asc(L.id));
      if (linhas.length) await auditRead(tx, { entidade: 'financeiro', entidadeId: null, patientId });
      return { paciente: situacaoDoPaciente(p.id, p.nome, p.status, p.anonimizadoEm), linhas: linhas.map((r) => naTela(r, hoje)) };
    },
    deps.db ?? getDb(),
  );
}

/** Um item da seção "Financeiro" do Início da ficha: o formato do `ItemDaSecao` do Plano 18 (sem `noApp`). */
export type ItemFinanceiroDaFicha = { id: string; rotulo: string; data: string; situacao: string; href: string };
export type ResumoFinanceiroDoPaciente = { total: number; ultimos: ItemFinanceiroDaFicha[]; podeAdicionar: boolean };

/** RN-277 do Plano 18: no máximo 3 itens por seção. */
const NA_FICHA = 3;

/**
 * Seção "Financeiro" do Início da ficha (US-308, RN-329), na transação do Início (`secoesDoInicio`, sessão `nutri`), numa
 * consulta: a partir do paciente (RLS), o total dos lançamentos dele — todas as situações, cancelados inclusive — e os 3
 * mais recentes pela data de referência (RN-306), na ordem da lista filtrada por paciente. Cada item só com "Entrada —
 * {categoria}", a data de referência e a situação (RN-305, "hoje" no fuso); nunca valor nem descrição. `podeAdicionar`:
 * nem bloqueado nem anonimizado (RN-315; paciente fora do consultório também não). Sem `auditRead`: o "ler" (RN-318) é o de
 * `inicio.ts`, pela `leitura` da seção. Recebe só `tx` e não confere o papel: só é chamada dentro de `secoesDoInicio`
 * (`src/modules/ficha/inicio.ts`), que recusa a sessão que não é `nutri` antes da transação — como os outros `*NaTransacao`
 * (regra 1 do CLAUDE.md: as tabelas `fin_*` são `staff_only`).
 */
export async function resumoFinanceiroDoPaciente(tx: Tx, patientId: string, fuso: string): Promise<ResumoFinanceiroDoPaciente> {
  const hoje = hojeNoFuso(fuso);
  const linhas = await tx
    .select({
      status: patients.status,
      anonimizadoEm: patients.anonimizadoEm,
      id: L.id,
      tipo: L.tipo,
      vencimento: L.vencimento,
      pagoEm: L.pagoEm,
      canceladoEm: L.canceladoEm,
      categoria: finCategorias.nome,
      // a janela conta antes do LIMIT; sem lançamento, a linha do paciente com L nulo conta 0
      total: sql<number>`count(${L.id}) over ()`.mapWith(Number),
    })
    .from(patients)
    // pelo fin_lancamentos_paciente_idx (tenant_id, patient_id, vencimento)
    .leftJoin(L, and(eq(L.tenantId, patients.tenantId), eq(L.patientId, patients.id)))
    .leftJoin(finCategorias, and(eq(finCategorias.tenantId, L.tenantId), eq(finCategorias.id, L.categoriaId)))
    .where(eq(patients.id, patientId))
    .orderBy(desc(sql`coalesce(${L.pagoEm}, ${L.vencimento})`), desc(L.createdAt), desc(L.id))
    .limit(NA_FICHA);
  const p = linhas[0];
  if (!p) return { total: 0, ultimos: [], podeAdicionar: false };
  const ultimos = linhas.flatMap((l) =>
    l.id && l.tipo && l.vencimento && l.categoria !== null
      ? [
          {
            id: l.id,
            rotulo: `${MSG_FINANCEIRO.csv.tipos[l.tipo]} — ${l.categoria}`,
            data: dataDeReferencia({ vencimento: l.vencimento, pagoEm: l.pagoEm }),
            situacao: ROTULO_SITUACAO[situacaoDoLancamento({ tipo: l.tipo, vencimento: l.vencimento, pagoEm: l.pagoEm, canceladoEm: l.canceladoEm }, hoje)],
            href: `/painel/financeiro/lancamentos/${l.id}`,
          },
        ]
      : [],
  );
  return { total: p.total, ultimos, podeAdicionar: p.status !== 'bloqueado' && p.anonimizadoEm === null };
}

/**
 * Plano 26 (RN-491, RE-D68): os agregados que os Relatórios leem do Financeiro — nenhuma consulta a `fin_*` fora deste
 * módulo. Funções "na transação de quem chama" (como `dozeMesesNaTransacao`): quem chama já conferiu o papel e a seção
 * (`exigirSecao` dos Relatórios) antes de abrir a transação. Período = meses inteiros 'AAAA-MM' (`de` a `ate`, `meses` na
 * ordem). Só recebidos e pagos, não cancelados, pelo dia do pagamento (RN-305/RN-306), pelo `fin_lancamentos_pago_idx`;
 * em aberto e previstos não entram (o Resumo mostra). Sem `auditRead`: agregado (RN-493). O filtro de local (US-416 do
 * Plano 23) chega na T11a, com `localId`.
 */
export type PeriodoDeMeses = { de: string; ate: string; meses: readonly string[] };
export type RecebidoEPagoDoMes = { mes: string; recebido: number; pago: number };
export type ValorPorCategoria = { categoria: string; valor: number };
export type ReceitaDoPaciente = { patientId: string; nomeExibido: string; nomeRegistro: string; valor: number };

const recebidosEPagosNoPeriodo = (tenantId: string, p: PeriodoDeMeses) =>
  and(eq(L.tenantId, tenantId), ativo, pago, entre(L.pagoEm, intervaloDoMes(p.de).de, intervaloDoMes(p.ate).ate));

/** US-484: "Recebido" (entradas) e "Pago" (saídas) por mês do pagamento, uma linha por mês do período (zero sem movimento). */
export async function recebidoEPagoPorMes(tx: Tx, tenantId: string, p: PeriodoDeMeses): Promise<RecebidoEPagoDoMes[]> {
  const porMes = await tx
    .select({ mes: mesDoPagamento, recebido: soma(entrada), pago: soma(saida) })
    .from(L)
    .where(recebidosEPagosNoPeriodo(tenantId, p))
    .groupBy(mesDoPagamento);
  const doMes = new Map(porMes.map((m) => [m.mes, m]));
  return p.meses.map((mes) => ({ mes, recebido: centavos(doMes.get(mes)?.recebido), pago: centavos(doMes.get(mes)?.pago) }));
}

/**
 * US-484 "Por categoria": soma por categoria no período, entradas e saídas em blocos separados, só as categorias com
 * movimento (arquivadas também, se tiveram), na ordem das Configurações ("Consultas" primeiro, depois pelo nome).
 */
export async function porCategoriaNoPeriodo(tx: Tx, tenantId: string, p: PeriodoDeMeses): Promise<{ entradas: ValorPorCategoria[]; saidas: ValorPorCategoria[] }> {
  const linhas = await tx
    .select({ tipo: finCategorias.tipo, categoria: finCategorias.nome, valor: somaTudo })
    .from(L)
    .innerJoin(finCategorias, and(eq(finCategorias.tenantId, L.tenantId), eq(finCategorias.id, L.categoriaId)))
    .where(recebidosEPagosNoPeriodo(tenantId, p))
    .groupBy(finCategorias.id, finCategorias.tipo, finCategorias.nome, finCategorias.chave)
    .orderBy(asc(finCategorias.tipo), sql`${finCategorias.chave} is null`, sql`lower(${finCategorias.nome})`, asc(finCategorias.id));
  const doTipo = (tipo: TipoLancamento) => linhas.filter((l) => l.tipo === tipo).map((l) => ({ categoria: l.categoria, valor: centavos(l.valor) }));
  return { entradas: doTipo('entrada'), saidas: doTipo('saida') };
}

/**
 * US-485 "Maior receita" (RN-492): soma das entradas recebidas no período, não canceladas, com paciente `ativo` ou
 * `arquivado` e não anonimizado; as `limite` maiores, empate pelo nome exibido sem diferença de acento e maiúsculas
 * (`app_unaccent(lower(…))`, RE-D68), depois pelo id. Na tela, o nome exibido (nome social primeiro, RN-266 do Plano 18);
 * no CSV e na impressão, o de registro. Sem `auditRead` (lista nominal na tela, RN-493; quem exporta grava o `exportar`).
 */
export async function receitaPorPaciente(tx: Tx, tenantId: string, p: PeriodoDeMeses, o: { limite: number }): Promise<ReceitaDoPaciente[]> {
  const total = sql`sum(${L.valorCentavos}::bigint)`;
  const linhas = await tx
    .select({ patientId: patients.id, nomeExibido: nomeDeExibicao, nomeRegistro: patients.nome, valor: somaTudo })
    .from(L)
    .innerJoin(patients, and(eq(patients.tenantId, L.tenantId), eq(patients.id, L.patientId)))
    .leftJoin(patientCadastro, cadastroDoPaciente)
    .where(and(recebidosEPagosNoPeriodo(tenantId, p), entrada, sql`${patients.status} in ('ativo', 'arquivado')`, isNull(patients.anonimizadoEm)))
    .groupBy(patients.id, patients.nome, patientCadastro.nomeSocial)
    .orderBy(sql`${total} desc`, sql`app_unaccent(lower(${nomeDeExibicao}))`, asc(patients.id))
    .limit(o.limite);
  return linhas.map((l) => ({ patientId: l.patientId, nomeExibido: l.nomeExibido ?? l.nomeRegistro, nomeRegistro: l.nomeRegistro, valor: centavos(l.valor) }));
}
