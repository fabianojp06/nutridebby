import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { DbError } from '@/db/errors';
import { appointments, finCategorias, finLancamentos, patients, type FinLancamentoRow, type TipoLancamento } from '@/db/schema';
import { FORMAS_DE_PAGAMENTO, type FormaPagamento } from '@/db/schema/financeiro-formas';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { dataValida, hojeNoFuso } from '@/modules/pacientes/datas';
import { auditRead } from '@/modules/plataforma/audit';
import { caracteres, configuracaoNaTransacao, DATA_MINIMA, textoDoCampo } from './configuracoes';
import { DESCRICAO_MAX, MOTIVO_MAX, MSG_FINANCEIRO, VALOR_MAX_CENTAVOS } from './constantes';
import { centavos, paraCentavos } from './dinheiro';
import { exigirNutri, FinanceiroError, FinanceiroNaoConfiguradoError, LancamentoNaoEncontradoError } from './erros';
import { intervaloDoMes, mesDe } from './meses';
import { dataDeReferencia, situacaoDoLancamento } from './situacao';
import type { FiltrosLista, LancamentoNaTela, TotaisDaLista } from './tipos';

type Deps = { db?: Db; agora?: Date };
/**
 * `daConsulta` (a seção "Cobrança" da tela da consulta, US-303): o lançamento tem de ser a cobrança desta consulta
 * (`appointment_id`, no tenant da sessão); outro id → `LancamentoNaoEncontradoError`, sem alterar nada. O id do lançamento
 * vem do formulário; a consulta, do `bind` da action.
 */
type DepsDaAlteracao = Deps & { daConsulta?: string };
const M = MSG_FINANCEIRO.erros;
/** RN-306: com paciente e sem mês, a lista para nos 200 mais recentes. */
export const LIMITE_SEM_MES = 200;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Os campos do formulário do lançamento já conferidos (RN-304), em centavos e 'AAAA-MM-DD'. */
type Campos = {
  valorCentavos: number;
  categoriaId: string;
  vencimento: string;
  pagoEm: string | null;
  formaPagamento: FormaPagamento | null;
  descricao: string | null;
};

const futuro = (tipo: TipoLancamento) => (tipo === 'entrada' ? M.recebimentoFuturo : M.pagamentoFuturo);
const formaValida = (v: unknown): FormaPagamento | null => FORMAS_DE_PAGAMENTO.find((f) => f === v) ?? null;

/** Data do recebimento/pagamento (RN-304): de 01/01/2000 até hoje no fuso. Vazia → null; erro em `erros.pagoEm`. */
function validarPagoEm(tipo: TipoLancamento, texto: string, hoje: string, erros: Record<string, string>): string | null {
  if (!texto) return null;
  if (!dataValida(texto) || texto < DATA_MINIMA) erros.pagoEm = M.dataInvalida;
  else if (texto > hoje) erros.pagoEm = futuro(tipo);
  return texto;
}

/**
 * RN-304 inteira: valor de R$ 0,01 a R$ 1.000.000,00; vencimento de 01/01/2000 até 31/12 do ano de hoje + 5; data do
 * recebimento/pagamento opcional (vazia = ainda não aconteceu), até hoje; forma obrigatória com essa data (sem a data, a
 * forma é descartada); descrição opcional de 1 a 200 caracteres. A categoria só tem o formato conferido aqui (a do
 * mesmo tipo e ativa é conferida no banco). Todos os erros de uma vez.
 */
function validarCampos(tipo: TipoLancamento, input: Record<string, unknown>, hoje: string): Campos {
  const erros: Record<string, string> = {};
  const valorCentavos = validarValor(input.valor, erros);

  const categoriaId = textoDoCampo(input.categoriaId);
  if (!idValido(categoriaId)) erros.categoriaId = M.escolhaCategoria;

  const vencimento = textoDoCampo(input.vencimento);
  const vencimentoMax = `${Number(hoje.slice(0, 4)) + 5}-12-31`;
  if (!vencimento) erros.vencimento = M.informeVencimento;
  else if (!dataValida(vencimento) || vencimento < DATA_MINIMA || vencimento > vencimentoMax) erros.vencimento = M.dataInvalida;

  const pagoEm = validarPagoEm(tipo, textoDoCampo(input.pagoEm), hoje, erros);
  const forma = pagoEm ? formaValida(textoDoCampo(input.forma)) : null;
  if (pagoEm && !forma) erros.forma = M.escolhaForma;

  const descricao = textoDoCampo(input.descricao) || null;
  if (descricao && caracteres(descricao) > DESCRICAO_MAX) erros.descricao = M.descricaoLonga;

  if (Object.keys(erros).length || valorCentavos === null) throw new FinanceiroError(erros);
  return { valorCentavos, categoriaId, vencimento, pagoEm, formaPagamento: forma, descricao };
}

/** RN-304: o valor de R$ 0,01 a R$ 1.000.000,00, em centavos; o erro em `erros.valor` (e null). */
export function validarValor(texto: unknown, erros: Record<string, string>): number | null {
  const valor = paraCentavos(textoDoCampo(texto));
  if (!valor.ok) erros.valor = valor.erro === 'vazio' ? M.informeValor : M.valorInvalido;
  else if (valor.centavos < 1 || valor.centavos > VALOR_MAX_CENTAVOS) erros.valor = M.valorFaixa;
  return valor.ok && !erros.valor ? valor.centavos : null;
}

/** Categoria ativa do tipo do lançamento (as arquivadas somem dos formulários, RN-303); a atual vale mesmo arquivada. */
async function conferirCategoria(tx: Tx, tipo: TipoLancamento, categoriaId: string, atual?: string): Promise<void> {
  if (categoriaId === atual) return;
  const [c] = await tx
    .select({ id: finCategorias.id })
    .from(finCategorias)
    .where(and(eq(finCategorias.id, categoriaId), eq(finCategorias.tipo, tipo), isNull(finCategorias.arquivadaEm)));
  if (!c) throw new FinanceiroError({ categoriaId: M.escolhaCategoria });
}

const antesDoSaldo = (pagoEm: string | null, saldoInicialEm: string) => pagoEm !== null && pagoEm < saldoInicialEm;

/**
 * Um 42501 do gatilho fin_lancamentos_regras que escapou das conferências do módulo (corrida que as travas não cobrem):
 * relê a situação numa transação nova e devolve a mensagem certa. O erro já vem limpo do withTenant (DbError, sem valores).
 */
async function traduzirRecusaDoGatilho(e: unknown, ctx: TenantContext, db: Db, mensagem: (tx: Tx) => Promise<string | null>): Promise<never> {
  if (!(e instanceof DbError) || e.code !== '42501') throw e;
  const geral = await withTenant(ctx, mensagem, db);
  if (!geral) throw e;
  throw new FinanceiroError(geral === M.bloqueadoNovo ? { pacienteId: geral } : { geral });
}

async function pacienteBloqueadoOuAnonimizado(tx: Tx, patientId: string): Promise<{ bloqueado: boolean; anonimizado: boolean } | null> {
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId));
  return p ? { bloqueado: p.status === 'bloqueado', anonimizado: !!p.anonimizadoEm } : null;
}

/**
 * US-301. RN-317: com paciente, `FOR KEY SHARE` no paciente e a conferência de `status`/`anonimizado_em` **sob a trava**,
 * antes do INSERT — um bloqueio que confirma no meio é esperado e lido na versão nova (a FK só esperaria e não conferiria
 * a situação). Nunca `carregarPacienteParaEscrita` (FOR UPDATE, e recusaria só o bloqueado sem a mensagem do Financeiro).
 */
export async function criarLancamento(
  ctx: TenantContext,
  tenant: { fuso: string },
  input: unknown,
  deps: Deps = {},
): Promise<{ id: string; antesDoSaldo: boolean; mes: string }> {
  exigirNutri(ctx);
  const i = (input ?? {}) as Record<string, unknown>;
  const tipo = i.tipo === 'entrada' || i.tipo === 'saida' ? i.tipo : null;
  if (!tipo) throw new Error('financeiro: tipo de lançamento inválido');
  const pacienteTexto = textoDoCampo(i.pacienteId);
  // F-D24: saída não tem paciente — o formulário dela nem tem o campo; chegar aqui é envio forjado
  if (pacienteTexto && tipo === 'saida') throw new Error('financeiro: saída não tem paciente');
  if (pacienteTexto && !idValido(pacienteTexto)) throw new PacienteNaoEncontradoError();
  const patientId = pacienteTexto || null;
  const agora = deps.agora ?? new Date();
  const c = validarCampos(tipo, i, hojeNoFuso(tenant.fuso, agora));
  const db = deps.db ?? getDb();
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const config = await configuracaoNaTransacao(tx);
        if (!config) throw new FinanceiroNaoConfiguradoError();
        if (patientId) {
          const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId)).for('key share');
          if (!p) throw new PacienteNaoEncontradoError();
          if (p.status === 'bloqueado' || p.anonimizadoEm) throw new FinanceiroError({ pacienteId: M.bloqueadoNovo });
        }
        await conferirCategoria(tx, tipo, c.categoriaId);
        // criado_por: o gatilho grava a usuária da sessão (app_current_user), seja qual for o valor daqui
        const [l] = await tx
          .insert(finLancamentos)
          .values({ tenantId: ctx.tenantId, tipo, ...c, patientId, criadoPor: ctx.actorUserId!, createdAt: agora, updatedAt: agora })
          .returning({ id: finLancamentos.id });
        return { id: l.id, antesDoSaldo: antesDoSaldo(c.pagoEm, config.saldoInicialEm), mes: mesDe(dataDeReferencia(c)) };
      },
      db,
    );
  } catch (e) {
    return traduzirRecusaDoGatilho(e, ctx, db, async (tx) => {
      const p = patientId ? await pacienteBloqueadoOuAnonimizado(tx, patientId) : null;
      return p && (p.bloqueado || p.anonimizado) ? M.bloqueadoNovo : null;
    });
  }
}

type Travado = { l: FinLancamentoRow; bloqueado: boolean };

/**
 * RN-317: paciente (se houver) `FOR KEY SHARE` → lançamento `FOR UPDATE` — a ordem do gatilho, que também lê o paciente
 * com `FOR KEY SHARE` no UPDATE; travar na ordem inversa dá deadlock com a anonimização (paciente `FOR UPDATE` → lançamentos).
 * O `patient_id` é fixo (gatilho), então a leitura sem trava que o descobre não muda depois. Cancelado ou anonimizado
 * (o lançamento ou o paciente) → a mensagem da spec.
 */
async function travarLancamento(tx: Tx, tenantId: string, id: string, daConsulta?: string): Promise<Travado> {
  if (!idValido(id)) throw new LancamentoNaoEncontradoError();
  const deOutraConsulta = (r: { tenantId: string; appointmentId: string | null }) =>
    r.tenantId !== tenantId || (daConsulta !== undefined && r.appointmentId !== daConsulta);
  const [antes] = await tx
    .select({ tenantId: finLancamentos.tenantId, patientId: finLancamentos.patientId, appointmentId: finLancamentos.appointmentId })
    .from(finLancamentos)
    .where(and(eq(finLancamentos.tenantId, tenantId), eq(finLancamentos.id, id)));
  // `appointment_id` é fixo (gatilho): conferido antes de qualquer trava, e de novo na linha travada (defesa)
  if (!antes || deOutraConsulta(antes)) throw new LancamentoNaoEncontradoError();
  const [p] = antes.patientId
    ? await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, antes.patientId)).for('key share')
    : [];
  const [l] = await tx.select().from(finLancamentos).where(and(eq(finLancamentos.tenantId, tenantId), eq(finLancamentos.id, id))).for('update');
  if (!l || deOutraConsulta(l)) throw new LancamentoNaoEncontradoError();
  if (l.anonimizadoEm || p?.anonimizadoEm) throw new FinanceiroError({ geral: M.anonimizado });
  if (l.canceladoEm) throw new FinanceiroError({ geral: M.cancelado });
  return { l, bloqueado: p?.status === 'bloqueado' };
}

/** A mensagem de um 42501 do gatilho num lançamento que já existia (corrida com o cancelamento, o bloqueio ou a anonimização). */
const recusaDoLancamento = (id: string) => async (tx: Tx) => {
  const [l] = await tx.select().from(finLancamentos).where(eq(finLancamentos.id, id));
  if (!l) return null;
  const p = l.patientId ? await pacienteBloqueadoOuAnonimizado(tx, l.patientId) : null;
  if (l.anonimizadoEm || p?.anonimizado) return M.anonimizado;
  if (l.canceladoEm) return M.cancelado;
  return p?.bloqueado ? M.bloqueadoAlterar : null;
};

/** Escrita num lançamento existente: travas, conferências e a tradução do 42501 que escapar. */
async function alterarLancamento<T>(ctx: TenantContext, id: string, deps: DepsDaAlteracao, fn: (tx: Tx, t: Travado) => Promise<T>): Promise<T> {
  exigirNutri(ctx);
  const db = deps.db ?? getDb();
  try {
    return await withTenant(ctx, async (tx) => fn(tx, await travarLancamento(tx, ctx.tenantId, id, deps.daConsulta)), db);
  } catch (e) {
    return traduzirRecusaDoGatilho(e, ctx, db, recusaDoLancamento(id));
  }
}

/**
 * US-302 / RN-308. Tipo, paciente e consulta do formulário são ignorados (fixos). Paciente bloqueado (RN-315): só a data
 * do recebimento e a forma, o valor para menor ou igual e o cancelamento — categoria, vencimento ou descrição diferentes,
 * ou valor maior, → a mensagem da spec (o gatilho recusa o mesmo).
 */
export async function editarLancamento(
  ctx: TenantContext,
  tenant: { fuso: string },
  id: string,
  input: unknown,
  deps: Deps = {},
): Promise<{ antesDoSaldo: boolean; mes: string }> {
  const agora = deps.agora ?? new Date();
  return alterarLancamento(ctx, id, deps, async (tx, { l, bloqueado }) => {
    const c = validarCampos(l.tipo, (input ?? {}) as Record<string, unknown>, hojeNoFuso(tenant.fuso, agora));
    if (
      bloqueado &&
      (c.valorCentavos > l.valorCentavos || c.categoriaId !== l.categoriaId || c.vencimento !== l.vencimento || c.descricao !== l.descricao)
    ) {
      throw new FinanceiroError({ geral: M.bloqueadoAlterar });
    }
    await conferirCategoria(tx, l.tipo, c.categoriaId, l.categoriaId);
    const config = await configuracaoNaTransacao(tx);
    await tx.update(finLancamentos).set({ ...c, updatedAt: agora }).where(eq(finLancamentos.id, l.id));
    return { antesDoSaldo: !!config && antesDoSaldo(c.pagoEm, config.saldoInicialEm), mes: mesDe(dataDeReferencia(c)) };
  });
}

/**
 * "Salvar valor" da seção "Cobrança" da consulta (US-303): só o valor (RN-304), com as travas e as recusas de
 * `editarLancamento`. Paciente bloqueado (RN-315): só para menor ou igual.
 */
export async function ajustarValor(ctx: TenantContext, id: string, valor: unknown, deps: DepsDaAlteracao = {}): Promise<void> {
  const erros: Record<string, string> = {};
  const valorCentavos = validarValor(valor, erros);
  if (valorCentavos === null) throw new FinanceiroError(erros);
  const agora = deps.agora ?? new Date();
  await alterarLancamento(ctx, id, deps, async (tx, { l, bloqueado }) => {
    if (bloqueado && valorCentavos > l.valorCentavos) throw new FinanceiroError({ geral: M.bloqueadoAlterar });
    await tx.update(finLancamentos).set({ valorCentavos, updatedAt: agora }).where(eq(finLancamentos.id, l.id));
  });
}

/**
 * "Marcar como recebido/pago" (US-302): data até hoje no fuso e forma obrigatória. Vale também com o paciente bloqueado.
 * Devolve o tipo, para a tela dizer "Recebimento registrado." ou "Pagamento registrado." sem confiar no formulário.
 */
export async function marcarRecebido(
  ctx: TenantContext,
  tenant: { fuso: string },
  id: string,
  input: { pagoEm: string; forma: string },
  deps: DepsDaAlteracao = {},
): Promise<{ mes: string; tipo: TipoLancamento }> {
  const agora = deps.agora ?? new Date();
  return alterarLancamento(ctx, id, deps, async (tx, { l }) => {
    const erros: Record<string, string> = {};
    const pagoEm = validarPagoEm(l.tipo, textoDoCampo(input.pagoEm), hojeNoFuso(tenant.fuso, agora), erros);
    if (!pagoEm && !erros.pagoEm) erros.pagoEm = M.dataInvalida;
    const forma = formaValida(textoDoCampo(input.forma));
    if (!forma) erros.forma = M.escolhaForma;
    if (Object.keys(erros).length || !pagoEm) throw new FinanceiroError(erros);
    await tx.update(finLancamentos).set({ pagoEm, formaPagamento: forma, updatedAt: agora }).where(eq(finLancamentos.id, l.id));
    return { mes: mesDe(pagoEm), tipo: l.tipo };
  });
}

/** "Desfazer recebimento/pagamento" (US-302): a data e a forma ficam vazias; a situação volta pelo vencimento. */
export async function desfazerRecebimento(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  const agora = deps.agora ?? new Date();
  await alterarLancamento(ctx, id, deps, async (tx, { l }) => {
    await tx.update(finLancamentos).set({ pagoEm: null, formaPagamento: null, updatedAt: agora }).where(eq(finLancamentos.id, l.id));
  });
}

/** RN-309: motivo de 1 a 200 caracteres, sem volta. `cancelado_em`/`cancelado_por` vêm do gatilho (a sessão e o relógio). */
export async function cancelarLancamento(ctx: TenantContext, id: string, motivo: string, deps: DepsDaAlteracao = {}): Promise<void> {
  exigirNutri(ctx);
  const m = textoDoCampo(motivo);
  if (!m) throw new FinanceiroError({ motivo: M.informeMotivo });
  if (caracteres(m) > MOTIVO_MAX) throw new FinanceiroError({ motivo: M.motivoLongo });
  const agora = deps.agora ?? new Date();
  await alterarLancamento(ctx, id, deps, async (tx, { l }) => {
    await tx
      .update(finLancamentos)
      .set({ canceladoEm: agora, canceladoPor: ctx.actorUserId!, motivoCancelamento: m, updatedAt: agora })
      .where(eq(finLancamentos.id, l.id));
  });
}

/** Data de referência (RN-306): o pagamento, ou o vencimento em aberto. */
const referencia = sql<string>`coalesce(${finLancamentos.pagoEm}, ${finLancamentos.vencimento})`;

/**
 * O dia de referência (RN-306) mais antigo do consultório, cancelados inclusive ('AAAA-MM-DD', ou null sem lançamentos):
 * o `<select>` de "Mês" da lista e o de "Ano" de Relatórios. O mesmo que `min(coalesce(pago_em, vencimento))`, em três
 * partes com `tenant_id` explícito para os índices parciais servirem (o `min` de um índice para na primeira linha): os
 * pagos ativos por `fin_lancamentos_pago_idx`, os em aberto ativos por `fin_lancamentos_aberto_idx`, e os cancelados (sem
 * índice parcial próprio) pelo índice do consultório.
 */
export async function diaMaisAntigoNaTransacao(tx: Tx, tenantId: string): Promise<string | null> {
  const L = finLancamentos;
  const doTenant = sql`${L.tenantId} = ${tenantId}`;
  const r = await tx.execute<{ dia: string | null }>(sql`select least(
    (select min(${L.pagoEm}) from ${L} where ${doTenant} and ${L.canceladoEm} is null and ${L.pagoEm} is not null),
    (select min(${L.vencimento}) from ${L} where ${doTenant} and ${L.canceladoEm} is null and ${L.pagoEm} is null),
    (select min(coalesce(${L.pagoEm}, ${L.vencimento})) from ${L} where ${doTenant} and ${L.canceladoEm} is not null)
  )::text as dia`);
  return r.rows[0]?.dia ?? null;
}

/** As colunas de `LancamentoNaTela`, com categoria, paciente e consulta — uma consulta só, sem N+1 (também o Resumo, T4). */
export function selecionarNaTela(tx: Tx) {
  return tx
    .select({
      l: finLancamentos,
      categoriaNome: finCategorias.nome,
      pacienteNome: patients.nome,
      pacienteStatus: patients.status,
      consultaInicio: appointments.inicio,
    })
    .from(finLancamentos)
    .innerJoin(finCategorias, and(eq(finCategorias.tenantId, finLancamentos.tenantId), eq(finCategorias.id, finLancamentos.categoriaId)))
    .leftJoin(patients, and(eq(patients.tenantId, finLancamentos.tenantId), eq(patients.id, finLancamentos.patientId)))
    .leftJoin(appointments, and(eq(appointments.tenantId, finLancamentos.tenantId), eq(appointments.id, finLancamentos.appointmentId)));
}
type LinhaSelecionada = Awaited<ReturnType<typeof selecionarNaTela>>[number];

export function naTela(r: LinhaSelecionada, hoje: string): LancamentoNaTela {
  const { l } = r;
  return {
    id: l.id,
    tipo: l.tipo,
    categoria: { id: l.categoriaId, nome: r.categoriaNome },
    valorCentavos: l.valorCentavos,
    vencimento: l.vencimento,
    pagoEm: l.pagoEm,
    forma: l.formaPagamento,
    descricao: l.descricao,
    paciente: l.patientId ? { id: l.patientId, nome: r.pacienteNome ?? '', bloqueado: r.pacienteStatus === 'bloqueado' } : null,
    consulta: l.appointmentId && r.consultaInicio ? { id: l.appointmentId, inicio: r.consultaInicio } : null,
    situacao: situacaoDoLancamento(l, hoje),
    canceladoEm: l.canceladoEm,
    motivoCancelamento: l.motivoCancelamento,
    anonimizado: !!l.anonimizadoEm,
  };
}

/** RN-305: o filtro "Situação" (recebido e pago num valor só). */
function filtroDeSituacao(s: FiltrosLista['situacao'], hoje: string): SQL | undefined {
  const aberto = and(isNull(finLancamentos.canceladoEm), isNull(finLancamentos.pagoEm));
  switch (s) {
    case 'previsto':
      return and(aberto, sql`${finLancamentos.vencimento} >= ${hoje}`);
    case 'em_atraso':
      return and(aberto, sql`${finLancamentos.vencimento} < ${hoje}`);
    case 'recebido_ou_pago':
      return and(isNull(finLancamentos.canceladoEm), isNotNull(finLancamentos.pagoEm));
    case 'cancelado':
      return isNotNull(finLancamentos.canceladoEm);
    default:
      return undefined;
  }
}

/** Do mês atual até o mês `ate` (inclusive), mais recentes primeiro; só o atual se `ate` não for anterior. */
function mesesAte(atual: string, ate: string | null): string[] {
  const indice = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const fim = ate && ate < atual ? indice(ate) : indice(atual);
  const out: string[] = [];
  for (let i = indice(atual); i >= fim; i--) out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  return out;
}

/**
 * US-302 / RN-306: a lista pela data de referência. Sem `mes`, o mês atual no fuso; com `pacienteId` e sem `mes`, todos os
 * meses, até 200 linhas (`maisDe200`). Totais do filtro inteiro, sem os cancelados (somas em bigint no SQL). `meses`: do
 * mês atual até o do lançamento mais antigo do consultório (o `<select>` da RN-306). Valores inválidos nos filtros (vindos
 * da URL) são ignorados. RN-318: com filtro de paciente e linha devolvida, **um** `ler` (entidade `financeiro`, sem
 * `entidadeId`) — nunca um por lançamento, que encheria o Histórico do paciente.
 */
export async function listarLancamentos(
  ctx: TenantContext,
  tenant: { fuso: string },
  filtros: FiltrosLista,
  deps: Deps = {},
): Promise<ListaDeLancamentos> {
  exigirNutri(ctx);
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(ctx, (tx) => listaNaTransacao(tx, ctx.tenantId, hoje, filtros), deps.db ?? getDb());
}

export type ListaDeLancamentos = { linhas: LancamentoNaTela[]; totais: TotaisDaLista; maisDe200: boolean; meses: string[] };

/** `listarLancamentos` na transação de quem chama (a tela da lista, RNF-301), com o mesmo `ler` da RN-318. */
export async function listaNaTransacao(tx: Tx, tenantId: string, hoje: string, filtros: FiltrosLista): Promise<ListaDeLancamentos> {
  const pacienteId = idValido(filtros.pacienteId) ? filtros.pacienteId : null;
  const mes = filtros.mes && MES.test(filtros.mes) ? filtros.mes : pacienteId ? null : mesDe(hoje);
  const periodo = mes ? intervaloDoMes(mes) : null;
  const filtro = and(
    eq(finLancamentos.tenantId, tenantId),
    periodo ? sql`${referencia} between ${periodo.de} and ${periodo.ate}` : undefined,
    filtros.tipo === 'entrada' || filtros.tipo === 'saida' ? eq(finLancamentos.tipo, filtros.tipo) : undefined,
    idValido(filtros.categoriaId) ? eq(finLancamentos.categoriaId, filtros.categoriaId) : undefined,
    formaValida(filtros.forma) ? eq(finLancamentos.formaPagamento, filtros.forma!) : undefined,
    pacienteId ? eq(finLancamentos.patientId, pacienteId) : undefined,
    filtroDeSituacao(filtros.situacao, hoje),
  );
  const limite = mes ? null : LIMITE_SEM_MES;
  const consulta = selecionarNaTela(tx).where(filtro).orderBy(desc(referencia), desc(finLancamentos.createdAt), desc(finLancamentos.id));
  const linhas = await (limite ? consulta.limit(limite + 1) : consulta);
  const [t] = await tx
    .select({
      recebido: sql<string>`coalesce(sum(${finLancamentos.valorCentavos}::bigint) filter (where ${finLancamentos.tipo} = 'entrada' and ${finLancamentos.pagoEm} is not null), 0)::text`,
      aReceber: sql<string>`coalesce(sum(${finLancamentos.valorCentavos}::bigint) filter (where ${finLancamentos.tipo} = 'entrada' and ${finLancamentos.pagoEm} is null), 0)::text`,
      pago: sql<string>`coalesce(sum(${finLancamentos.valorCentavos}::bigint) filter (where ${finLancamentos.tipo} = 'saida' and ${finLancamentos.pagoEm} is not null), 0)::text`,
      aPagar: sql<string>`coalesce(sum(${finLancamentos.valorCentavos}::bigint) filter (where ${finLancamentos.tipo} = 'saida' and ${finLancamentos.pagoEm} is null), 0)::text`,
    })
    .from(finLancamentos)
    .where(and(filtro, isNull(finLancamentos.canceladoEm)));
  const antigo = await diaMaisAntigoNaTransacao(tx, tenantId);
  const maisDe200 = limite !== null && linhas.length > limite;
  const visiveis = maisDe200 ? linhas.slice(0, limite) : linhas;
  if (pacienteId && visiveis.length) await auditRead(tx, { entidade: 'financeiro', entidadeId: null, patientId: pacienteId });
  return {
    linhas: visiveis.map((r) => naTela(r, hoje)),
    totais: { entradas: { recebido: centavos(t.recebido), aReceber: centavos(t.aReceber) }, saidas: { pago: centavos(t.pago), aPagar: centavos(t.aPagar) } },
    maisDe200,
    meses: mesesAte(mesDe(hoje), antigo ? mesDe(antigo) : null),
  };
}

/** A tela de edição (US-302). RN-318: lançamento com paciente → `ler` com o id do lançamento. */
export async function abrirLancamento(ctx: TenantContext, tenant: { fuso: string }, id: string, deps: Deps = {}): Promise<LancamentoNaTela | null> {
  exigirNutri(ctx);
  if (!idValido(id)) return null;
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(ctx, (tx) => lancamentoNaTransacao(tx, id, hoje), deps.db ?? getDb());
}

/** `abrirLancamento` na transação de quem chama (a tela de edição, RNF-301), com o mesmo `ler` da RN-318. Id já conferido. */
export async function lancamentoNaTransacao(tx: Tx, id: string, hoje: string): Promise<LancamentoNaTela | null> {
  const [r] = await selecionarNaTela(tx).where(eq(finLancamentos.id, id));
  if (!r) return null;
  if (r.l.patientId) await auditRead(tx, { entidade: 'financeiro', entidadeId: r.l.id, patientId: r.l.patientId });
  return naTela(r, hoje);
}

/** F-D28: o seletor "Paciente (opcional)" — ativos e arquivados, sem bloqueados nem anonimizados, por nome. */
export async function pacientesParaLancamento(ctx: TenantContext, deps: Deps = {}): Promise<PacienteParaLancamento[]> {
  exigirNutri(ctx);
  return withTenant(ctx, pacientesNaTransacao, deps.db ?? getDb());
}

export type PacienteParaLancamento = { id: string; nome: string; arquivado: boolean };

/** `pacientesParaLancamento` na transação de quem chama (o formulário novo, RNF-301). */
export async function pacientesNaTransacao(tx: Tx): Promise<PacienteParaLancamento[]> {
  const linhas = await tx
    .select({ id: patients.id, nome: patients.nome, status: patients.status })
    .from(patients)
    .where(and(inArray(patients.status, ['ativo', 'arquivado']), isNull(patients.anonimizadoEm)))
    .orderBy(asc(patients.nome), asc(patients.id));
  return linhas.map((p) => ({ id: p.id, nome: p.nome, arquivado: p.status === 'arquivado' }));
}

/**
 * O paciente de `?paciente=` na lista (chip "Paciente: {nome}") e no formulário novo (aviso do bloqueado, §6.2): só nome e
 * situação, como a lista de pacientes — sem `auditRead` (a leitura do financeiro dele é auditada por `listarLancamentos`).
 * Id inválido ou de outro consultório (RLS) → null. `bloqueado` não inclui o anonimizado (que não ganha aviso).
 */
export async function pacienteDoFinanceiro(ctx: TenantContext, id: string, deps: Deps = {}): Promise<PacienteDoFinanceiro | null> {
  exigirNutri(ctx);
  if (!idValido(id)) return null;
  return withTenant(ctx, (tx) => pacienteNaTransacao(tx, id), deps.db ?? getDb());
}

export type PacienteDoFinanceiro = { id: string; nome: string; bloqueado: boolean; anonimizado: boolean };

/** `pacienteDoFinanceiro` na transação de quem chama (as telas da lista e do formulário novo, RNF-301). Id já conferido. */
export async function pacienteNaTransacao(tx: Tx, id: string): Promise<PacienteDoFinanceiro | null> {
  const [p] = await tx.select({ nome: patients.nome, status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, id));
  if (!p) return null;
  const anonimizado = !!p.anonimizadoEm;
  return { id, nome: p.nome, bloqueado: p.status === 'bloqueado' && !anonimizado, anonimizado };
}
