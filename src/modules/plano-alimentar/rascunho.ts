import { and, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { energyCalcs, foods, mealItems, mealPlans, meals, type MedidaDoItem } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { gramasDaMedida, QTD_MEDIDA_MAX, textoMedida } from '@/modules/alimentos/medidas-constantes';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { lerDecimal, arredondar } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { lerQuantidade } from './calculo';
import { MAX_ITENS, MAX_REFEICOES, MAX_TEXTO, META_MAX, META_MIN, MSG_PLANO } from './constantes';
import { ConflitoRevisaoError, PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';

type Deps = { db?: Db; now?: Date };

/** Próxima versão do paciente (publicadas, arquivadas e rascunho contam). */
export async function proximaVersao(tx: Tx, patientId: string): Promise<number> {
  const [r] = await tx.select({ v: max(mealPlans.versao) }).from(mealPlans).where(eq(mealPlans.patientId, patientId));
  return (r?.v ?? 0) + 1;
}

/** D11: um rascunho por paciente — se já existe, devolve o existente. */
export async function criarRascunho(ctx: TenantContext, patientId: string, deps: Deps = {}): Promise<{ id: string; criado: boolean }> {
  return withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const [existe] = await tx
        .select({ id: mealPlans.id })
        .from(mealPlans)
        .where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'rascunho')));
      if (existe) return { id: existe.id, criado: false };
      const [p] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, patientId, titulo: 'Plano alimentar', versao: await proximaVersao(tx, patientId) })
        .returning({ id: mealPlans.id });
      return { id: p.id, criado: true };
    },
    deps.db ?? getDb(),
  );
}

type ItemValido = { id: string; mealId: string; foodId: string; quantidadeG: number; medida: MedidaDoItem | null; medidaCaseiraTxt: string | null; substituiItemId: string | null; ordem: number };
type RefeicaoValida = { id: string; nome: string; horario: string | null; observacao: string; ordem: number };
type Validado = { revisao: number; titulo: string; metaKcal: number | null; energyCalcId: string | null; mostrarCalorias: boolean; orientacoes: string; refeicoes: RefeicaoValida[]; itens: ItemValido[] };

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;
const medidaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  plural: z.string().trim().min(1).max(60),
  gramas: z.number().min(0.1).max(5000),
  qtd: z.number().gt(0).max(QTD_MEDIDA_MAX),
});

/** Validação completa antes de tocar no banco: erro por campo (chaves `item:<id>:…`), nunca gravação parcial. */
function validar(entrada: unknown): Validado {
  const o = (entrada ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object' || !Array.isArray(o.refeicoes) || !Number.isInteger(o.revisao)) throw new PlanoError({ geral: MSG_PLANO.invalido });
  const erros: Record<string, string> = {};
  const titulo = normalizarTexto(o.titulo);
  if (!titulo || titulo.length > 120) erros.titulo = MSG_PLANO.titulo;
  const metaN = lerDecimal(o.metaKcal);
  if (metaN !== null && (Number.isNaN(metaN) || metaN < META_MIN || metaN > META_MAX)) erros.metaKcal = MSG_PLANO.meta;
  const orientacoes = typeof o.orientacoes === 'string' ? o.orientacoes.trim() : '';
  if (orientacoes.length > MAX_TEXTO) erros.orientacoes = MSG_PLANO.texto;
  const refeicoesEntrada = o.refeicoes as Record<string, unknown>[];
  const totalItens = refeicoesEntrada.reduce((n, r) => n + (Array.isArray(r?.itens) ? r.itens.length : 0), 0);
  if (refeicoesEntrada.length > MAX_REFEICOES || totalItens > MAX_ITENS) throw new PlanoError({ geral: MSG_PLANO.limite });

  const ids = new Set<string>();
  const novoId = (id: unknown): id is string => idValido(id) && !ids.has(id) && Boolean(ids.add(id));
  const refeicoes: RefeicaoValida[] = [];
  const itens: ItemValido[] = [];
  refeicoesEntrada.forEach((r, ordem) => {
    if (!novoId(r?.id)) throw new PlanoError({ geral: MSG_PLANO.invalido });
    const chave = `refeicao:${r.id}`;
    const nome = normalizarTexto(r.nome);
    if (!nome || nome.length > 60) erros[`${chave}:nome`] = MSG_PLANO.refeicaoNome;
    const horario = typeof r.horario === 'string' ? r.horario.trim() : '';
    if (horario && !HORARIO.test(horario)) erros[`${chave}:horario`] = MSG_PLANO.horario;
    const observacao = typeof r.observacao === 'string' ? r.observacao.trim() : '';
    if (observacao.length > MAX_TEXTO) erros[`${chave}:observacao`] = MSG_PLANO.texto;
    refeicoes.push({ id: r.id as string, nome, horario: horario || null, observacao, ordem });
    const lista = (Array.isArray(r.itens) ? r.itens : []) as Record<string, unknown>[];
    const principais = new Set(lista.filter((i) => i?.substituiItemId === null || i?.substituiItemId === undefined).map((i) => i?.id));
    lista.forEach((i, ordemItem) => {
      if (!novoId(i?.id)) throw new PlanoError({ geral: MSG_PLANO.invalido });
      const ci = `item:${i.id}`;
      if (!idValido(i.foodId)) erros[`${ci}:foodId`] = MSG_PLANO.alimento;
      let medida: MedidaDoItem | null = null;
      let gramas: number | null;
      if (i.medida !== null && i.medida !== undefined) {
        const m = medidaSchema.safeParse(i.medida);
        if (!m.success) {
          erros[`${ci}:medida`] = MSG_PLANO.quantidade;
          gramas = null;
        } else {
          medida = m.data;
          gramas = lerQuantidade(gramasDaMedida(m.data.qtd, m.data.gramas));
        }
      } else {
        // a coluna é numeric(7,2): com 3 ou mais casas, o valor gravado nunca bateria com o enviado (UPDATE e audit_log a cada salvamento)
        const g = lerQuantidade(i.quantidadeG);
        gramas = g === null ? null : arredondar(g, 2);
      }
      if (gramas === null && !erros[`${ci}:medida`]) erros[`${ci}:quantidadeG`] = MSG_PLANO.quantidade;
      const sub = i.substituiItemId ?? null;
      if (sub !== null && (sub === i.id || !principais.has(sub))) erros[`${ci}:substituiItemId`] = MSG_PLANO.substituicao;
      itens.push({
        id: i.id as string,
        mealId: r.id as string,
        foodId: i.foodId as string,
        quantidadeG: gramas ?? 0,
        medida,
        medidaCaseiraTxt: medida ? textoMedida(medida.qtd, medida) : null,
        substituiItemId: sub as string | null,
        ordem: ordemItem,
      });
    });
  });
  if (Object.keys(erros).length) throw new PlanoError(erros);
  return {
    revisao: o.revisao as number,
    titulo,
    metaKcal: metaN === null ? null : arredondar(metaN, 0),
    energyCalcId: idValido(o.energyCalcId) ? o.energyCalcId : null,
    mostrarCalorias: o.mostrarCalorias === true,
    orientacoes,
    refeicoes,
    itens,
  };
}

/** Comparação estável: o jsonb devolve as chaves em outra ordem que o objeto validado. */
const canonico = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico((v as Record<string, unknown>)[k])])) : v;
const iguais = (a: unknown, b: unknown) => JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));

/**
 * D7: aplica só a diferença entre o que o editor mandou e o banco (o gatilho de auditoria registra só o que mudou).
 * Ordem de travas igual à da publicação: paciente → plano.
 */
export async function salvarRascunho(ctx: TenantContext, planId: string, entrada: unknown, deps: Deps = {}): Promise<{ revisao: number }> {
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  const v = validar(entrada);
  const now = deps.now ?? new Date();
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const [antes] = await tx.select({ patientId: mealPlans.patientId }).from(mealPlans).where(eq(mealPlans.id, planId));
        if (!antes) throw new PlanoNaoEncontradoError();
        if (antes.patientId) await carregarPacienteParaEscrita(tx, antes.patientId);
        const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId)).for('update');
        if (!p) throw new PlanoNaoEncontradoError(); // descartado entre a leitura e a trava
        if (p.status !== 'rascunho') throw new PlanoNaoEditavelError();
        if (p.revisao !== v.revisao) throw new ConflitoRevisaoError();

        if (v.energyCalcId) {
          // o cálculo precisa ser do mesmo paciente (modelo não tem paciente nem cálculo)
          const [c] = p.patientId
            ? await tx.select({ id: energyCalcs.id }).from(energyCalcs).where(and(eq(energyCalcs.id, v.energyCalcId), eq(energyCalcs.patientId, p.patientId)))
            : [];
          if (!c) throw new PlanoError({ metaKcal: MSG_PLANO.calculo });
        }

        const foodIds = [...new Set(v.itens.map((i) => i.foodId))];
        const visiveis = new Set(foodIds.length ? (await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, foodIds))).map((f) => f.id) : []);
        const invisiveis = Object.fromEntries(v.itens.filter((i) => !visiveis.has(i.foodId)).map((i) => [`item:${i.id}:foodId`, MSG_PLANO.alimento]));
        if (Object.keys(invisiveis).length) throw new PlanoError(invisiveis);

        const refeicoesAtuais = new Map((await tx.select().from(meals).where(eq(meals.planId, planId))).map((r) => [r.id, r]));
        const itensAtuais = new Map((await tx.select().from(mealItems).where(eq(mealItems.planId, planId))).map((i) => [i.id, i]));
        const novasRefeicoes = new Set(v.refeicoes.map((r) => r.id));
        const novosItens = new Map(v.itens.map((i) => [i.id, i]));

        // 1. Remoções: itens que saíram ou mudaram de refeição (voltam no passo 3) e refeições que saíram
        const sair = [...itensAtuais.values()].filter((i) => !novosItens.has(i.id) || novosItens.get(i.id)!.mealId !== i.mealId).map((i) => i.id);
        if (sair.length) await tx.delete(mealItems).where(and(eq(mealItems.planId, planId), inArray(mealItems.id, sair)));
        // A FK meal_items_principal_fk apaga em cascata as substituições do principal que saiu, mesmo as que o editor
        // manteve (ex.: substituição promovida a principal): elas deixam de existir e são regravadas no passo 3.
        const sairSet = new Set(sair);
        for (const i of [...itensAtuais.values()]) if (sairSet.has(i.id) || (i.substituiItemId !== null && sairSet.has(i.substituiItemId))) itensAtuais.delete(i.id);
        const refeicoesSair = [...refeicoesAtuais.keys()].filter((id) => !novasRefeicoes.has(id));
        if (refeicoesSair.length) await tx.delete(meals).where(and(eq(meals.planId, planId), inArray(meals.id, refeicoesSair)));

        // 2. Refeições novas e alteradas
        for (const r of v.refeicoes) {
          const atual = refeicoesAtuais.get(r.id);
          const dados = { nome: r.nome, horario: r.horario, observacao: r.observacao, ordem: r.ordem };
          if (!atual) await tx.insert(meals).values({ id: r.id, tenantId: ctx.tenantId, patientId: p.patientId, planId, ...dados });
          else if (!iguais({ nome: atual.nome, horario: atual.horario?.slice(0, 5) ?? null, observacao: atual.observacao, ordem: atual.ordem }, dados))
            await tx.update(meals).set({ ...dados, updatedAt: now }).where(eq(meals.id, r.id));
        }

        // 3. Itens: principais antes das substituições (FK meal_items_principal_fk)
        const ordenados = [...v.itens.filter((i) => i.substituiItemId === null), ...v.itens.filter((i) => i.substituiItemId !== null)];
        for (const i of ordenados) {
          const atual = itensAtuais.get(i.id);
          const dados = { foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida, medidaCaseiraTxt: i.medidaCaseiraTxt, substituiItemId: i.substituiItemId, ordem: i.ordem };
          if (!atual) await tx.insert(mealItems).values({ id: i.id, tenantId: ctx.tenantId, patientId: p.patientId, planId, mealId: i.mealId, ...dados });
          else if (!iguais({ foodId: atual.foodId, quantidadeG: atual.quantidadeG, medida: atual.medida ?? null, medidaCaseiraTxt: atual.medidaCaseiraTxt, substituiItemId: atual.substituiItemId, ordem: atual.ordem }, dados))
            await tx.update(mealItems).set({ ...dados, updatedAt: now }).where(eq(mealItems.id, i.id));
        }

        const [r] = await tx
          .update(mealPlans)
          .set({
            titulo: v.titulo,
            metaKcal: v.metaKcal,
            energyCalcId: v.energyCalcId,
            mostrarCalorias: v.mostrarCalorias,
            orientacoes: v.orientacoes,
            revisao: p.revisao + 1,
            updatedAt: now,
          })
          .where(eq(mealPlans.id, planId))
          .returning({ revisao: mealPlans.revisao });
        return { revisao: r.revisao };
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    // id de refeição/item que já é de outro plano: só acontece com duas abas ou corpo adulterado
    if (uniqueViolation(e) === 'meals_pkey' || uniqueViolation(e) === 'meal_items_pkey') throw new ConflitoRevisaoError();
    throw e;
  }
}

/**
 * Copia refeições e itens (ids novos) de um plano para outro: modelos (Tarefa 9) e "Editar" (Tarefa 10).
 * A origem fica travada FOR SHARE antes das leituras (um salvamento automático em curso, FOR UPDATE, termina antes:
 * refeições e itens saem da mesma versão). Paciente e tenant das linhas novas vêm do plano de destino no banco.
 * Quem trava o paciente o faz antes de chamar (paciente → tenant → plano, como no salvamento e na publicação).
 */
export async function copiarConteudo(tx: Tx, origemId: string, destinoId: string): Promise<void> {
  const [origem] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(eq(mealPlans.id, origemId)).for('share');
  const [destino] = await tx.select({ id: mealPlans.id, patientId: mealPlans.patientId, tenantId: mealPlans.tenantId }).from(mealPlans).where(eq(mealPlans.id, destinoId));
  if (!origem || !destino) throw new PlanoNaoEncontradoError();
  const rs = await tx.select().from(meals).where(eq(meals.planId, origemId));
  const its = await tx.select().from(mealItems).where(eq(mealItems.planId, origemId));
  const novoIdRefeicao = new Map(rs.map((r) => [r.id, crypto.randomUUID()]));
  const novoIdItem = new Map(its.map((i) => [i.id, crypto.randomUUID()]));
  if (rs.length)
    await tx.insert(meals).values(
      rs.map((r) => ({ id: novoIdRefeicao.get(r.id)!, tenantId: destino.tenantId, patientId: destino.patientId, planId: destino.id, nome: r.nome, horario: r.horario, ordem: r.ordem, observacao: r.observacao })),
    );
  const linha = (i: (typeof its)[number]) => ({
    id: novoIdItem.get(i.id)!,
    tenantId: destino.tenantId,
    patientId: destino.patientId,
    planId: destino.id,
    mealId: novoIdRefeicao.get(i.mealId)!,
    foodId: i.foodId,
    quantidadeG: i.quantidadeG,
    medida: i.medida,
    medidaCaseiraTxt: i.medidaCaseiraTxt,
    substituiItemId: i.substituiItemId ? novoIdItem.get(i.substituiItemId)! : null,
    ordem: i.ordem,
    nutrientes: null, // D10: a cópia volta a usar os valores atuais dos alimentos
  });
  const principais = its.filter((i) => !i.substituiItemId).map(linha);
  const subs = its.filter((i) => i.substituiItemId).map(linha);
  if (principais.length) await tx.insert(mealItems).values(principais);
  if (subs.length) await tx.insert(mealItems).values(subs);
}

export async function descartarRascunho(ctx: TenantContext, planId: string, deps: Deps = {}): Promise<void> {
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(mealPlans).where(and(eq(mealPlans.id, planId), eq(mealPlans.status, 'rascunho'), eq(mealPlans.isTemplate, false)));
      if (!p) throw new PlanoNaoEncontradoError();
      await carregarPacienteParaEscrita(tx, p.patientId!);
      await tx.delete(mealPlans).where(and(eq(mealPlans.id, planId), eq(mealPlans.status, 'rascunho')));
    },
    deps.db ?? getDb(),
  );
}
