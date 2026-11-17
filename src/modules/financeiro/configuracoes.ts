import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { DbError, fkViolation, uniqueViolation } from '@/db/errors';
import { finCategorias, finConfiguracoes, finLancamentos, TIPOS_DE_LANCAMENTO, type FinCategoriaRow, type TipoLancamento } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { dataValida, hojeNoFuso } from '@/modules/pacientes/datas';
import { recordAudit } from '@/modules/plataforma/audit';
import { CATEGORIAS_INICIAIS, MSG_FINANCEIRO, NOME_CATEGORIA_MAX, SALDO_MAX_CENTAVOS, VALOR_MAX_CENTAVOS } from './constantes';
import { paraCentavos } from './dinheiro';
import { CategoriaNaoEncontradaError, exigirNutri, FinanceiroError, FinanceiroNaoConfiguradoError } from './erros';

export type Configuracao = { saldoInicialCentavos: number; saldoInicialEm: string; valorConsultaCentavos: number | null };
type Deps = { db?: Db; agora?: Date };

/** RN-325 / F-D25: a menor data do saldo (o CHECK `fin_configuracoes_saldo_data` também). */
export const DATA_MINIMA = '2000-01-01';
const E = MSG_FINANCEIRO.errosConfig;
const EC = MSG_FINANCEIRO.errosCategoria;

/** Texto do formulário sem os espaços das pontas; o que não é texto vira vazio. */
export const textoDoCampo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** Caracteres como o `char_length` do Postgres conta (pontos de código, não unidades UTF-16). */
export const caracteres = (s: string): number => [...s].length;

/** A configuração do consultório na transação de quem chama (lançamentos, resumo, cobrança), ou null se nunca configurou. */
export async function configuracaoNaTransacao(tx: Tx): Promise<Configuracao | null> {
  const [c] = await tx
    .select({
      saldoInicialCentavos: finConfiguracoes.saldoInicialCentavos,
      saldoInicialEm: finConfiguracoes.saldoInicialEm,
      valorConsultaCentavos: finConfiguracoes.valorConsultaCentavos,
    })
    .from(finConfiguracoes);
  return c ?? null;
}

/** RN-301 / RN-302: só lê — nunca grava nem semeia. */
export async function lerConfiguracoes(ctx: TenantContext, deps: Deps = {}): Promise<Configuracao | null> {
  exigirNutri(ctx);
  return withTenant(ctx, configuracaoNaTransacao, deps.db ?? getDb());
}

function validarConfiguracao(input: unknown, hoje: string): Configuracao {
  const i = (input ?? {}) as Record<string, unknown>;
  const erros: Record<string, string> = {};
  const data = textoDoCampo(i.saldoInicialEm);
  if (!data) erros.saldoInicialEm = E.informeDataSaldo;
  else if (!dataValida(data) || data < DATA_MINIMA) erros.saldoInicialEm = MSG_FINANCEIRO.erros.dataInvalida;
  else if (data > hoje) erros.saldoInicialEm = E.saldoFuturo;

  const saldo = paraCentavos(textoDoCampo(i.saldoInicial));
  if (!saldo.ok) erros.saldoInicial = saldo.erro === 'vazio' ? E.informeValorSaldo : E.valorInvalido;
  else if (Math.abs(saldo.centavos) > SALDO_MAX_CENTAVOS) erros.saldoInicial = E.saldoFaixa;

  // RN-324: opcional — vazio apaga o valor (as consultas deixam de gerar cobrança, F-D21)
  const textoConsulta = textoDoCampo(i.valorConsulta);
  const consulta = textoConsulta ? paraCentavos(textoConsulta) : null;
  if (consulta && !consulta.ok) erros.valorConsulta = E.valorInvalido;
  else if (consulta?.ok && (consulta.centavos < 1 || consulta.centavos > VALOR_MAX_CENTAVOS)) erros.valorConsulta = E.valorConsultaFaixa;

  if (Object.keys(erros).length || !saldo.ok) throw new FinanceiroError(erros);
  return { saldoInicialCentavos: saldo.centavos, saldoInicialEm: data, valorConsultaCentavos: consulta?.ok ? consulta.centavos : null };
}

/**
 * US-300. Trava a linha do consultório (`FOR UPDATE`, RN-317). Sem linha: `INSERT … ON CONFLICT DO NOTHING RETURNING` —
 * só quem inseriu semeia as categorias (RN-302, F-D25), também com `ON CONFLICT DO NOTHING`; quem perdeu a corrida
 * (o INSERT esperou o outro confirmar) grava por cima, como uma segunda gravação. Toda gravação: `alterar` de
 * `financeiro_configuracoes`, sem paciente (RN-320).
 */
export async function salvarConfiguracoes(ctx: TenantContext, tenant: { fuso: string }, input: unknown, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  const agora = deps.agora ?? new Date();
  const c = validarConfiguracao(input, hojeNoFuso(tenant.fuso, agora));
  await withTenant(
    ctx,
    async (tx) => {
      const [atual] = await tx.select({ tenantId: finConfiguracoes.tenantId }).from(finConfiguracoes).where(eq(finConfiguracoes.tenantId, ctx.tenantId)).for('update');
      const inseriu =
        !atual &&
        (await tx
          .insert(finConfiguracoes)
          .values({ tenantId: ctx.tenantId, ...c, createdAt: agora, updatedAt: agora })
          .onConflictDoNothing()
          .returning({ tenantId: finConfiguracoes.tenantId })).length > 0;
      if (inseriu) {
        await tx
          .insert(finCategorias)
          .values(CATEGORIAS_INICIAIS.map((k) => ({ tenantId: ctx.tenantId, tipo: k.tipo, nome: k.nome, chave: k.chave, createdAt: agora, updatedAt: agora })))
          .onConflictDoNothing();
      } else {
        await tx.update(finConfiguracoes).set({ ...c, updatedAt: agora }).where(eq(finConfiguracoes.tenantId, ctx.tenantId));
      }
      await recordAudit(tx, { acao: 'alterar', entidade: 'financeiro_configuracoes', entidadeId: ctx.tenantId, patientId: null });
    },
    deps.db ?? getDb(),
  );
}

/** RN-303: todas as categorias do consultório (arquivadas também, para a tela das Configurações), por tipo e nome. */
export async function listarCategorias(ctx: TenantContext, deps: Deps = {}): Promise<FinCategoriaRow[]> {
  exigirNutri(ctx);
  return withTenant(ctx, categoriasNaTransacao, deps.db ?? getDb());
}

/** As categorias de `listarCategorias` na transação de quem chama (as telas dos lançamentos, RNF-301). */
export function categoriasNaTransacao(tx: Tx): Promise<FinCategoriaRow[]> {
  return tx.select().from(finCategorias).orderBy(asc(finCategorias.tipo), sql`${finCategorias.chave} is null`, sql`lower(${finCategorias.nome})`);
}

function validarNome(nome: unknown): string {
  const n = textoDoCampo(nome);
  if (caracteres(n) < 1 || caracteres(n) > NOME_CATEGORIA_MAX) throw new FinanceiroError({ nome: EC.nomeTamanho });
  return n;
}

/** 23505 no índice do nome (outra gravação ganhou a corrida) → o erro do campo; o resto sobe como está. */
function comoNomeRepetido(e: unknown): never {
  if (uniqueViolation(e) === 'fin_categorias_nome_unique') throw new FinanceiroError({ nome: EC.nomeRepetido });
  throw e;
}

async function categoriaTravada(tx: Tx, id: string): Promise<FinCategoriaRow> {
  if (!idValido(id)) throw new CategoriaNaoEncontradaError();
  const [c] = await tx.select().from(finCategorias).where(eq(finCategorias.id, id)).for('update');
  if (!c) throw new CategoriaNaoEncontradaError();
  return c;
}

/** Nome único por consultório e tipo, sem diferença de maiúsculas (índice `fin_categorias_nome_unique`). */
async function nomeEmUso(tx: Tx, tipo: TipoLancamento, nome: string, ignorar?: string): Promise<boolean> {
  const [x] = await tx
    .select({ id: finCategorias.id })
    .from(finCategorias)
    .where(and(eq(finCategorias.tipo, tipo), sql`lower(${finCategorias.nome}) = lower(${nome})`, ignorar ? sql`${finCategorias.id} <> ${ignorar}` : undefined))
    .limit(1);
  return !!x;
}

/**
 * Categoria nova (RN-303). Só depois da primeira configuração: antes, uma "Consultas" criada à mão bateria no nome da
 * semente, e a cobrança automática ficaria sem a categoria dela.
 */
export async function criarCategoria(ctx: TenantContext, input: unknown, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  const i = (input ?? {}) as Record<string, unknown>;
  const tipo = TIPOS_DE_LANCAMENTO.find((t) => t === i.tipo);
  if (!tipo) throw new Error('financeiro: tipo de categoria inválido');
  const nome = validarNome(i.nome);
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      if (!(await configuracaoNaTransacao(tx))) throw new FinanceiroNaoConfiguradoError();
      if (await nomeEmUso(tx, tipo, nome)) throw new FinanceiroError({ nome: EC.nomeRepetido });
      await tx.insert(finCategorias).values({ tenantId: ctx.tenantId, tipo, nome, createdAt: agora, updatedAt: agora });
    },
    deps.db ?? getDb(),
  ).catch(comoNomeRepetido);
}

/** "Consultas" também pode mudar de nome (RN-303). */
export async function renomearCategoria(ctx: TenantContext, id: string, nome: unknown, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  const novo = validarNome(nome);
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const c = await categoriaTravada(tx, id);
      if (await nomeEmUso(tx, c.tipo, novo, c.id)) throw new FinanceiroError({ nome: EC.nomeRepetido });
      await tx.update(finCategorias).set({ nome: novo, updatedAt: agora }).where(eq(finCategorias.id, c.id));
    },
    deps.db ?? getDb(),
  ).catch(comoNomeRepetido);
}

/** Arquivada some dos formulários e fica nos lançamentos e relatórios; "Consultas" nunca (CHECK do banco também). */
export async function arquivarCategoria(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const c = await categoriaTravada(tx, id);
      if (c.chave) throw new FinanceiroError({ geral: EC.consultasFixa });
      if (!c.arquivadaEm) await tx.update(finCategorias).set({ arquivadaEm: agora, updatedAt: agora }).where(eq(finCategorias.id, c.id));
    },
    deps.db ?? getDb(),
  );
}

export async function reativarCategoria(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const c = await categoriaTravada(tx, id);
      if (c.arquivadaEm) await tx.update(finCategorias).set({ arquivadaEm: null, updatedAt: agora }).where(eq(finCategorias.id, c.id));
    },
    deps.db ?? getDb(),
  );
}

/**
 * Só categoria sem lançamento e sem chave (RN-303). Um lançamento gravado no meio (a FK dele espera a trava desta linha)
 * faz o DELETE falhar pela FK `NO ACTION`: vira a mesma mensagem.
 */
export async function excluirCategoria(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  exigirNutri(ctx);
  await withTenant(
    ctx,
    async (tx) => {
      const c = await categoriaTravada(tx, id);
      if (c.chave) throw new FinanceiroError({ geral: EC.consultasFixa });
      const [uso] = await tx.select({ id: finLancamentos.id }).from(finLancamentos).where(eq(finLancamentos.categoriaId, c.id)).limit(1);
      if (uso) throw new FinanceiroError({ geral: EC.comLancamentos });
      await tx.delete(finCategorias).where(eq(finCategorias.id, c.id));
    },
    deps.db ?? getDb(),
  ).catch((e: unknown) => {
    if (e instanceof DbError && fkViolation(e) === 'fin_lancamentos_categoria_fk') throw new FinanceiroError({ geral: EC.comLancamentos });
    throw e;
  });
}
