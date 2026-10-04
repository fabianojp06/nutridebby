import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contents, foods, recipeIngredients, recipes } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arredondar, lerDecimal } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { idValido } from '@/modules/pacientes/base';
import { lerQuantidade } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { INGREDIENTES_MAX, MEDIDA_TXT_MAX, MODO_PREPARO_MAX, MSG_CONTEUDO, MSG_RECEITA, RENDIMENTO_MAX } from './constantes';
import { ConteudoError, ConteudoNaoEncontradoError } from './erros';

export type EntradaReceita = { rendimento?: unknown; porcao?: unknown; tempo?: unknown; modo?: unknown; ingredientes?: unknown };
export type ReceitaLida = {
  rendimentoG: number;
  porcaoG: number;
  tempoMin: number | null;
  modoPreparo: string;
  ingredientes: { foodId: string; nome: string; origem: 'TACO' | 'Meu alimento'; porCem: Nutrientes100; quantidadeG: number; medidaCaseiraTxt: string | null }[];
};
export type ReceitaParaPlano = { id: string; titulo: string };
type Valida = { rendimentoG: number; porcaoG: number; tempoMin: number | null; modoPreparo: string; ingredientes: { foodId: string; quantidadeG: number; medidaCaseiraTxt: string | null }[] };

/**
 * Rendimento e porção: arredonda para 1 casa ANTES de conferir — "0,04" vira 0,0, que o CHECK do banco (> 0) recusaria
 * com 500; aqui vira a mensagem do campo. Mínimo 0,1 g (a menor quantidade que a coluna numeric(7,1) guarda).
 */
const gramas = (v: unknown): number | null => {
  const n = lerDecimal(v);
  if (n === null || Number.isNaN(n)) return null;
  const g = arredondar(n, 1);
  return g < 0.1 || g > RENDIMENTO_MAX ? null : g;
};

/** R6: NUL (`\0`) num texto recebido (modo de preparo, medida caseira…) — o Postgres o recusa em `text` (SQLSTATE 22021, um 500). */
const temNul = (e: EntradaReceita): boolean => {
  const its = Array.isArray(e.ingredientes) ? (e.ingredientes as unknown[]) : [];
  const deIngredientes = its.flatMap((b) => (b && typeof b === 'object' ? Object.values(b as Record<string, unknown>) : [b]));
  return [e.rendimento, e.porcao, e.tempo, e.modo, ...deIngredientes].some((v) => typeof v === 'string' && v.includes('\0'));
};

/** Validação completa antes do banco; erros por campo (`ingrediente:<posição>:<campo>` para os ingredientes). */
export function validarReceita(e: EntradaReceita): Valida {
  if (temNul(e)) throw new ConteudoError({ geral: MSG_CONTEUDO.formulario });
  const erros: Record<string, string> = {};
  const rendimentoG = gramas(e.rendimento);
  if (rendimentoG === null) erros.rendimento = MSG_RECEITA.rendimento;
  const porcaoG = gramas(e.porcao);
  if (porcaoG === null) erros.porcao = MSG_RECEITA.porcao;
  else if (rendimentoG !== null && porcaoG > rendimentoG) erros.porcao = MSG_RECEITA.porcaoMaior;
  const t = lerDecimal(e.tempo);
  const tempoMin = t !== null && Number.isInteger(t) && t >= 1 && t <= 1440 ? t : null;
  if (t !== null && tempoMin === null) erros.tempo = MSG_RECEITA.tempo;
  const modoPreparo = typeof e.modo === 'string' ? e.modo.replace(/\r\n?/g, '\n').trim() : '';
  if (modoPreparo.length > MODO_PREPARO_MAX) erros.modo = MSG_RECEITA.modo;
  const brutos = Array.isArray(e.ingredientes) ? (e.ingredientes as unknown[]) : [];
  if (!brutos.length) erros.ingredientes = MSG_RECEITA.ingredientes;
  if (brutos.length > INGREDIENTES_MAX) erros.ingredientes = MSG_RECEITA.ingredientesMax;
  const ingredientes: Valida['ingredientes'] = [];
  if (brutos.length <= INGREDIENTES_MAX)
    brutos.forEach((b, k) => {
      const o = (b ?? {}) as Record<string, unknown>;
      if (!idValido(o.foodId)) {
        erros[`ingrediente:${k}:alimento`] = MSG_PLANO.alimento;
        return;
      }
      const g = lerQuantidade(o.quantidadeG);
      if (g === null) erros[`ingrediente:${k}:quantidade`] = MSG_PLANO.quantidade;
      const medida = normalizarTexto(o.medida);
      if (medida.length > MEDIDA_TXT_MAX) erros[`ingrediente:${k}:medida`] = MSG_RECEITA.medida;
      ingredientes.push({ foodId: o.foodId, quantidadeG: g === null ? 0 : arredondar(g, 2), medidaCaseiraTxt: medida || null });
    });
  if (Object.keys(erros).length) throw new ConteudoError(erros);
  return { rendimentoG: rendimentoG!, porcaoG: porcaoG!, tempoMin, modoPreparo, ingredientes };
}

/**
 * US-051: grava a receita inteira (os ingredientes são substituídos). Só conteúdo do tipo receita do tenant (RLS);
 * alimento que a RLS não mostra (de outro consultório) → "Alimento não encontrado." no ingrediente.
 */
export async function salvarReceita(ctx: TenantContext, contentId: string, entrada: EntradaReceita, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  if (!idValido(contentId)) throw new ConteudoNaoEncontradoError();
  const v = validarReceita(entrada);
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ tipo: contents.tipo }).from(contents).where(eq(contents.id, contentId)).for('update');
      if (!c || c.tipo !== 'receita') throw new ConteudoNaoEncontradoError();
      const ids = [...new Set(v.ingredientes.map((i) => i.foodId))];
      const visiveis = new Set((await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, ids))).map((f) => f.id));
      const invisiveis = Object.fromEntries(v.ingredientes.flatMap((i, k) => (visiveis.has(i.foodId) ? [] : [[`ingrediente:${k}:alimento`, MSG_PLANO.alimento]])));
      if (Object.keys(invisiveis).length) throw new ConteudoError(invisiveis);
      const dados = { rendimentoTotalG: v.rendimentoG, porcaoG: v.porcaoG, tempoPreparoMin: v.tempoMin, modoPreparoMd: v.modoPreparo, updatedAt: agora };
      await tx.insert(recipes).values({ tenantId: ctx.tenantId, contentId, ...dados }).onConflictDoUpdate({ target: recipes.contentId, set: dados });
      await tx.delete(recipeIngredients).where(eq(recipeIngredients.contentId, contentId));
      await tx.insert(recipeIngredients).values(v.ingredientes.map((i, ordem) => ({ tenantId: ctx.tenantId, contentId, ...i, ordem })));
      await tx.update(contents).set({ updatedAt: agora }).where(eq(contents.id, contentId));
    },
    deps.db ?? getDb(),
  );
}

/** A receita com os valores ATUAIS dos alimentos (D11). Roda com a RLS de quem lê (no portal, só a receita visível). */
export async function lerReceitaNaTransacao(tx: Tx, contentId: string): Promise<ReceitaLida | null> {
  const [r] = await tx.select().from(recipes).where(eq(recipes.contentId, contentId));
  if (!r) return null;
  const its = await tx
    .select({ i: recipeIngredients, f: { nome: foods.nome, tenantId: foods.tenantId, kcal: foods.kcal, proteinaG: foods.proteinaG, carboidratoG: foods.carboidratoG, lipidioG: foods.lipidioG, fibraG: foods.fibraG } })
    .from(recipeIngredients)
    .innerJoin(foods, eq(foods.id, recipeIngredients.foodId))
    .where(eq(recipeIngredients.contentId, contentId))
    .orderBy(asc(recipeIngredients.ordem));
  return {
    rendimentoG: r.rendimentoTotalG,
    porcaoG: r.porcaoG,
    tempoMin: r.tempoPreparoMin,
    modoPreparo: r.modoPreparoMd,
    ingredientes: its.map(({ i, f }) => ({
      foodId: i.foodId,
      nome: f.nome,
      origem: f.tenantId === null ? ('TACO' as const) : ('Meu alimento' as const),
      porCem: { kcal: f.kcal, proteinaG: f.proteinaG, carboidratoG: f.carboidratoG, lipidioG: f.lipidioG, fibraG: f.fibraG },
      quantidadeG: i.quantidadeG,
      medidaCaseiraTxt: i.medidaCaseiraTxt,
    })),
  };
}

export async function carregarReceitaDoPainel(ctx: TenantContext, contentId: string, db: Db = getDb()): Promise<ReceitaLida | null> {
  if (!idValido(contentId)) return null;
  return withTenant(ctx, (tx) => lerReceitaNaTransacao(tx, contentId), db);
}

/** US-054: o seletor "Sugestão de receita" do editor do plano — receitas publicadas, por título. */
export async function listarReceitasPublicadas(ctx: TenantContext, db: Db = getDb()): Promise<ReceitaParaPlano[]> {
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: contents.id, titulo: contents.titulo })
        .from(contents)
        .where(and(eq(contents.tipo, 'receita'), eq(contents.status, 'publicado')))
        .orderBy(asc(contents.titulo), asc(contents.id)),
    db,
  );
}
