import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { prescricaoItensSalvos, prescricaoModelos, type ItemSalvoRow, type ModeloPrescricaoRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { salvarRascunhoReceita } from './documentos';
import { DocumentoError } from './erros';
import { ITENS_SALVOS_MAX, MODELOS_PRESCRICAO_MAX, MSG_MODELOS, NOME_DO_ITEM_MAX, TIPOS_DO_GRUPO, type GrupoDeItens } from './modelos-textos';
import { MSG_PRESCRICAO, validarItem, validarItensDoModelo, type ConteudoReceita, type ItemPrescricao } from './prescricao';

/**
 * Plano 22 (T10a, US-379, RN-393, RN-394; EP-D29, EP-D30): itens salvos e modelos de prescrição do consultório no banco.
 * Só a sessão `nutri` (as tabelas são `staff_only`: numa sessão de paciente a leitura voltaria vazia em silêncio, por isso o
 * assert vem antes da transação). O item passa pelo **mesmo** Zod do item da receita (`validarItem`) e o modelo por
 * `validarItensDoModelo` (1 a 20 itens; sem justificativa de uso), com a habilitação do consultório. Os tetos (300 itens
 * salvos, 100 modelos) e a unicidade do nome são conferidos sob a trava transacional da biblioteca do consultório
 * (`pg_advisory_xact_lock`, como o catálogo de exames, M6); o `UNIQUE (tenant_id, lower(nome))` é a barreira do banco.
 * "Carregar modelo" grava pelo mesmo caminho do "Salvar" da receita (`salvarRascunhoReceita`: todas as conferências, tudo
 * ou nada). Nomes e itens nunca vão a log nem à mensagem técnica do erro (regra 3): só as mensagens da §6.2, nos campos.
 */

export { ITENS_SALVOS_MAX, MODELOS_PRESCRICAO_MAX, MSG_MODELOS, TIPOS_DO_GRUPO, type GrupoDeItens };
export type { ItemSalvoRow, ModeloPrescricaoRow };

const E = MSG_MODELOS.erros;

function exigirNutri(ctx: TenantContext): void {
  if (ctx.role !== 'nutri') throw new Error('prescricao: só a sessão nutri');
}

/** M6: a trava da biblioteca do consultório (o teto e a unicidade só valem com as gravações em fila). */
const travar = (tx: Tx, biblioteca: 'prescricao_itens_salvos' | 'prescricao_modelos', tenantId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${biblioteca}:${tenantId}`}, 0))`);

const umaLinha = (s: string) => s.replace(/\u0000/g, '').trim().replace(/\s+/g, ' ');
function lerNome(input: unknown, erros: Record<string, string>): string {
  const nome = typeof input === 'string' ? umaLinha(input) : '';
  if (!nome || nome.length > NOME_DO_ITEM_MAX) erros.nome = E.nome;
  return nome;
}
const habilitada = (tenant: Pick<TenantRow, 'fitoterapiaRegistro'>) => !!tenant.fitoterapiaRegistro;

/** Junta os erros do Zod de prescrição (DocumentoError) aos do nome, com o prefixo das chaves do formulário. */
function juntar(erros: Record<string, string>, e: unknown, prefixo = ''): void {
  if (!(e instanceof DocumentoError)) throw e;
  for (const [k, v] of Object.entries(e.erros)) erros[`${prefixo}${k}`] ??= v;
}

/** Nome repetido, sem diferença de maiúsculas, entre as linhas do consultório (fora a que está sendo editada). */
const repetido = (todos: { id: string; nome: string }[], nome: string, fora: string | null) => todos.some((t) => t.id !== fora && t.nome.toLowerCase() === nome.toLowerCase());

// ——— Itens salvos (RN-393) ———

const ordemItens = asc(sql`lower(${prescricaoItensSalvos.nome})`);

/** "Suplementos" ou "Fitoterápicos" (RN-393), por nome. */
export async function listarItensSalvos(ctx: TenantContext, grupo: GrupoDeItens, deps: { db?: Db } = {}): Promise<{ id: string; nome: string; tipo: string; item: ItemPrescricao }[]> {
  exigirNutri(ctx);
  const tipos = TIPOS_DO_GRUPO[grupo] ?? TIPOS_DO_GRUPO.suplementos;
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: prescricaoItensSalvos.id, nome: prescricaoItensSalvos.nome, tipo: prescricaoItensSalvos.tipo, item: prescricaoItensSalvos.item })
        .from(prescricaoItensSalvos)
        .where(inArray(prescricaoItensSalvos.tipo, [...tipos]))
        .orderBy(ordemItens),
    deps.db ?? getDb(),
  );
}

/** A tela de edição do item salvo (T10b). `null` se não existe (ou é de outro consultório). */
export async function abrirItemSalvo(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<ItemSalvoRow | null> {
  exigirNutri(ctx);
  if (!idValido(id)) return null;
  const [i] = await withTenant(ctx, (tx) => tx.select().from(prescricaoItensSalvos).where(eq(prescricaoItensSalvos.id, id)), deps.db ?? getDb());
  return i ?? null;
}

/**
 * US-379 "Item salvo." — cria (`id` nulo) ou altera e devolve o id. O item pelo mesmo Zod do item da receita e a
 * habilitação do consultório (`validarItem`, R22-09); as chaves dos erros do item levam o prefixo `item.` (as do
 * `CamposDoItem` com `prefixo="item"`). Lança `DocumentoError` com `nome`, `item.<campo>` ou `geral`.
 */
export async function salvarItemSalvo(
  ctx: TenantContext,
  tenant: Pick<TenantRow, 'fitoterapiaRegistro'>,
  id: string | null,
  input: { nome: unknown; item: unknown },
  deps: { db?: Db } = {},
): Promise<string> {
  exigirNutri(ctx);
  if (id !== null && !idValido(id)) throw new DocumentoError({ geral: E.itemNaoEncontrado });
  const erros: Record<string, string> = {};
  const nome = lerNome(input.nome, erros);
  let item: ItemPrescricao | undefined;
  try {
    item = validarItem(input.item, { habilitada: habilitada(tenant) });
  } catch (e) {
    juntar(erros, e, 'item.');
  }
  if (Object.keys(erros).length || !item) throw new DocumentoError(erros);
  const linha = { nome, tipo: item.tipo, item };
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        await travar(tx, 'prescricao_itens_salvos', ctx.tenantId);
        const todos = await tx.select({ id: prescricaoItensSalvos.id, nome: prescricaoItensSalvos.nome }).from(prescricaoItensSalvos);
        if (id !== null && !todos.some((t) => t.id === id)) throw new DocumentoError({ geral: E.itemNaoEncontrado });
        if (repetido(todos, nome, id)) throw new DocumentoError({ nome: E.itemRepetido });
        if (id !== null) {
          await tx.update(prescricaoItensSalvos).set({ ...linha, updatedAt: new Date() }).where(eq(prescricaoItensSalvos.id, id));
          return id;
        }
        if (todos.length >= ITENS_SALVOS_MAX) throw new DocumentoError({ geral: E.itensCheio });
        const [novo] = await tx.insert(prescricaoItensSalvos).values({ tenantId: ctx.tenantId, ...linha }).returning({ id: prescricaoItensSalvos.id });
        return novo.id;
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    // a barreira do banco (o índice do nome): a mesma mensagem
    if (uniqueViolation(e) === 'prescricao_itens_salvos_nome_unico') throw new DocumentoError({ nome: E.itemRepetido });
    throw e;
  }
}

/** "Item excluído." — as receitas que copiaram o item não mudam (sem FK, RN-393). */
export async function excluirItemSalvo(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<boolean> {
  exigirNutri(ctx);
  if (!idValido(id)) return false;
  const apagados = await withTenant(ctx, (tx) => tx.delete(prescricaoItensSalvos).where(eq(prescricaoItensSalvos.id, id)).returning({ id: prescricaoItensSalvos.id }), deps.db ?? getDb());
  return apagados.length > 0;
}

// ——— Modelos de prescrição (RN-394) ———

const ordemModelos = asc(sql`lower(${prescricaoModelos.nome})`);

/** A lista e o diálogo "Carregar modelo": nome e quantos itens. */
export async function listarModelosPrescricao(ctx: TenantContext, deps: { db?: Db } = {}): Promise<{ id: string; nome: string; itens: number }[]> {
  exigirNutri(ctx);
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: prescricaoModelos.id, nome: prescricaoModelos.nome, itens: sql<number>`jsonb_array_length(${prescricaoModelos.itens})::int` })
        .from(prescricaoModelos)
        .orderBy(ordemModelos),
    deps.db ?? getDb(),
  );
}

/** A tela de edição do modelo (T10b). `null` se não existe (ou é de outro consultório). */
export async function abrirModeloPrescricao(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<ModeloPrescricaoRow | null> {
  exigirNutri(ctx);
  if (!idValido(id)) return null;
  const [m] = await withTenant(ctx, (tx) => tx.select().from(prescricaoModelos).where(eq(prescricaoModelos.id, id)), deps.db ?? getDb());
  return m ?? null;
}

/**
 * US-379 "Modelo salvo." — cria (`id` nulo) ou altera e devolve o id. Itens e orientações por `validarItensDoModelo`
 * (R22-09; 1 a 20 itens, orientações até 2000 em marcação), com a habilitação do consultório; **sem** justificativa de
 * uso (qualquer outra chave do `input` é ignorada, RN-394). Lança `DocumentoError` com `nome`, `itens…`, `orientacoes` ou `geral`.
 */
export async function salvarModeloPrescricao(
  ctx: TenantContext,
  tenant: Pick<TenantRow, 'fitoterapiaRegistro'>,
  id: string | null,
  input: { nome: unknown; itens: unknown; orientacoes?: unknown },
  deps: { db?: Db } = {},
): Promise<string> {
  exigirNutri(ctx);
  if (id !== null && !idValido(id)) throw new DocumentoError({ geral: E.modeloNaoEncontrado });
  const erros: Record<string, string> = {};
  const nome = lerNome(input.nome, erros);
  let v: ReturnType<typeof validarItensDoModelo> | undefined;
  try {
    v = validarItensDoModelo({ itens: input.itens, orientacoes: input.orientacoes }, { habilitada: habilitada(tenant) });
  } catch (e) {
    juntar(erros, e);
  }
  if (Object.keys(erros).length || !v) throw new DocumentoError(erros);
  const linha = { nome, itens: v.itens, orientacoes: v.orientacoes };
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        await travar(tx, 'prescricao_modelos', ctx.tenantId);
        const todos = await tx.select({ id: prescricaoModelos.id, nome: prescricaoModelos.nome }).from(prescricaoModelos);
        if (id !== null && !todos.some((t) => t.id === id)) throw new DocumentoError({ geral: E.modeloNaoEncontrado });
        if (repetido(todos, nome, id)) throw new DocumentoError({ nome: E.modeloRepetido });
        if (id !== null) {
          await tx.update(prescricaoModelos).set({ ...linha, updatedAt: new Date() }).where(eq(prescricaoModelos.id, id));
          return id;
        }
        if (todos.length >= MODELOS_PRESCRICAO_MAX) throw new DocumentoError({ geral: E.modelosCheio });
        const [novo] = await tx.insert(prescricaoModelos).values({ tenantId: ctx.tenantId, ...linha }).returning({ id: prescricaoModelos.id });
        return novo.id;
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'prescricao_modelos_nome_unico') throw new DocumentoError({ nome: E.modeloRepetido });
    throw e;
  }
}

/** "Modelo excluído." — as receitas já emitidas não mudam (cópia, RN-394). */
export async function excluirModeloPrescricao(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<boolean> {
  exigirNutri(ctx);
  if (!idValido(id)) return false;
  const apagados = await withTenant(ctx, (tx) => tx.delete(prescricaoModelos).where(eq(prescricaoModelos.id, id)).returning({ id: prescricaoModelos.id }), deps.db ?? getDb());
  return apagados.length > 0;
}

/**
 * RN-394, EP-D30 "Carregar modelo": junta o `conteudo` **da tela** (o digitado e ainda não salvo) com os itens do modelo —
 * `acrescentar` (os da tela e depois os do modelo; mais de 20 → `passaDe20` e nada muda) ou `substituir` — e as orientações
 * do modelo só se as da tela estiverem vazias; grava pelo **mesmo caminho** do "Salvar" da receita (`salvarRascunhoReceita`:
 * o Zod, os 20 itens, a habilitação **atual** do consultório — R-377 —, o paciente e o documento travados; tudo ou nada),
 * com a justificativa digitada (o modelo não a traz), e devolve o conteúdo gravado (o cliente remonta o formulário por `key`).
 */
export async function carregarModeloNaReceita(
  ctx: TenantContext,
  tenant: TenantRow,
  patientId: string,
  docId: string,
  input: { conteudo: unknown; justificativa: unknown; modeloId: string; modo: 'acrescentar' | 'substituir' },
  deps: { db?: Db } = {},
): Promise<ConteudoReceita> {
  exigirNutri(ctx);
  if (input.modo !== 'acrescentar' && input.modo !== 'substituir') throw new DocumentoError({ modo: MSG_PRESCRICAO.opcao });
  if (!idValido(input.modeloId)) throw new DocumentoError({ geral: E.modeloNaoEncontrado });
  const db = deps.db ?? getDb();
  const [modelo] = await withTenant(
    ctx,
    (tx) => tx.select({ itens: prescricaoModelos.itens, orientacoes: prescricaoModelos.orientacoes }).from(prescricaoModelos).where(eq(prescricaoModelos.id, input.modeloId)),
    db,
  );
  if (!modelo) throw new DocumentoError({ geral: E.modeloNaoEncontrado });
  const tela = (input.conteudo ?? {}) as { itens?: unknown; orientacoes?: unknown };
  const daTela = Array.isArray(tela.itens) ? tela.itens : [];
  if (input.modo === 'acrescentar' && daTela.length + modelo.itens.length > 20) throw new DocumentoError({ itens: MSG_MODELOS.passaDe20 });
  const orientacoesDaTela = typeof tela.orientacoes === 'string' ? tela.orientacoes : '';
  const conteudo = {
    itens: input.modo === 'substituir' ? modelo.itens : [...daTela, ...modelo.itens],
    orientacoes: orientacoesDaTela.trim() ? orientacoesDaTela : modelo.orientacoes,
  };
  return salvarRascunhoReceita(ctx, tenant, patientId, docId, { conteudo, justificativa: input.justificativa }, { db });
}
