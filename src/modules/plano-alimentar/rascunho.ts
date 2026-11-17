import { and, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { deadlockDetectado, fkViolation, uniqueViolation } from '@/db/errors';
import {
  contents, energyCalcs, foods, mealItems, mealPlans, meals, planoConteudos, planoListasSubstituicao, referenciasNutrientes, type MacrosPrescritos, type MealPlanRow, type MedidaDoItem,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { gramasDaMedida, QTD_MEDIDA_MAX, textoMedida } from '@/modules/alimentos/medidas-constantes';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { lerDecimal, arredondar } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import type { ItemIa, RefeicaoIa } from '@/modules/ia/plano-ia';
import { lerQuantidade } from './calculo';
import { MAX_ENVIOS_INCERTOS, MAX_ITENS, MAX_REFEICOES, MAX_TEXTO, META_MAX, META_MIN, MSG_DIAS, MSG_PLANO, MSG_TEXTO_LIVRE } from './constantes';
import { TODOS_OS_DIAS, type DiaDaSemana } from './dias';
import { ConflitoRevisaoError, PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';
import type { ModoPlano } from './tipos';

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
      return { id: await criarRascunhoTx(tx, ctx.tenantId, patientId), criado: true };
    },
    deps.db ?? getDb(),
  );
}

/**
 * RN-122 (Plano 14B): o rascunho novo do paciente, dentro da transação de quem chama (que já travou o paciente e conferiu
 * que não há rascunho — D11). `iaOrigemEm` = a marca "Criado com apoio de IA" ("Usar como rascunho"), que vira o selo
 * quando publicado (RN-117).
 */
export async function criarRascunhoTx(
  tx: Tx,
  tenantId: string,
  patientId: string,
  o: { titulo?: string; metaKcal?: number | null; orientacoes?: string; iaOrigemEm?: Date | null } = {},
): Promise<string> {
  const [p] = await tx
    .insert(mealPlans)
    .values({
      tenantId, patientId, titulo: o.titulo ?? 'Plano alimentar', metaKcal: o.metaKcal ?? null, orientacoes: o.orientacoes ?? '', iaOrigemEm: o.iaOrigemEm ?? null,
      modo: 'calculado', // RN-243: o rascunho da IA ("Usar como rascunho") é sempre com alimentos e quantidades
      versao: await proximaVersao(tx, patientId),
    })
    .returning({ id: mealPlans.id });
  return p.id;
}

type ItemValido = { id: string; mealId: string; foodId: string; quantidadeG: number; medida: MedidaDoItem | null; medidaCaseiraTxt: string | null; substituiItemId: string | null; ordem: number };
/** Plano 19: `diasSemana`/`descricaoLivre` ausentes (`undefined`) = ficam como estão no banco (editor de antes do Plano 19). */
type RefeicaoValida = {
  id: string;
  nome: string;
  horario: string | null;
  observacao: string;
  ordem: number;
  recipeContentId: string | null;
  diasSemana: DiaDaSemana[] | undefined;
  descricaoLivre: string | null | undefined;
};
type Validado = {
  revisao: number;
  envio: string;
  enviosIncertos: string[];
  titulo: string;
  metaKcal: number | null;
  energyCalcId: string | null;
  mostrarCalorias: boolean;
  orientacoes: string;
  /** Ausentes = ficam como estão (o modo e a distribuição gravados). */
  modo: ModoPlano | undefined;
  macrosPrescritos: MacrosPrescritos | null | undefined;
  refeicoes: RefeicaoValida[];
  itens: ItemValido[];
};

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;
/** D7: chave de idempotência de cada PUT (uuid do cliente) e as dos envios sem resposta confirmada. */
const chavesSchema = z.object({ envio: z.uuid(), enviosIncertos: z.array(z.uuid()).max(MAX_ENVIOS_INCERTOS).optional() });
const medidaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  plural: z.string().trim().min(1).max(60),
  gramas: z.number().min(0.1).max(5000),
  qtd: z.number().gt(0).max(QTD_MEDIDA_MAX),
});

const MODOS: readonly ModoPlano[] = ['calculado', 'livre'];

/**
 * RN-244: proteína, carboidrato e lipídio em % do VET, inteiros de 0 a 100 que somam 100. Os três vazios = sem
 * distribuição (null); `undefined` = não veio (fica a gravada); fora do formato = `false`.
 */
function lerMacros(m: unknown): MacrosPrescritos | null | undefined | false {
  if (m === undefined || m === null) return m;
  if (typeof m !== 'object' || Array.isArray(m)) return false;
  const o = m as Record<string, unknown>;
  const v = [o.proteina, o.carboidrato, o.lipidio].map(lerDecimal);
  if (v.every((x) => x === null)) return null;
  if (v.some((x) => x === null || !Number.isInteger(x) || x < 0 || x > 100) || v.reduce<number>((a, x) => a + x!, 0) !== 100) return false;
  return { proteina: v[0]!, carboidrato: v[1]!, lipidio: v[2]! };
}

/** RN-246: 0 (domingo) a 6, sem repetir; devolvidos em ordem (o CHECK `meals_dias_validos` exige). Fora do formato → null. */
function lerDias(d: unknown): DiaDaSemana[] | null {
  if (!Array.isArray(d) || d.some((x) => !Number.isInteger(x) || x < 0 || x > 6) || new Set(d).size !== d.length) return null;
  return [...(d as DiaDaSemana[])].sort((a, b) => a - b);
}

/** Validação completa antes de tocar no banco: erro por campo (chaves `item:<id>:…`), nunca gravação parcial. */
function validar(entrada: unknown): Validado {
  const o = (entrada ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object' || !Array.isArray(o.refeicoes) || !Number.isInteger(o.revisao)) throw new PlanoError({ geral: MSG_PLANO.invalido });
  const chaves = chavesSchema.safeParse({ envio: o.envio, enviosIncertos: o.enviosIncertos });
  if (!chaves.success) throw new PlanoError({ geral: MSG_PLANO.invalido });
  const erros: Record<string, string> = {};
  const titulo = normalizarTexto(o.titulo);
  if (!titulo || titulo.length > 120) erros.titulo = MSG_PLANO.titulo;
  const metaN = lerDecimal(o.metaKcal);
  if (metaN !== null && (Number.isNaN(metaN) || metaN < META_MIN || metaN > META_MAX)) erros.metaKcal = MSG_PLANO.meta;
  const orientacoes = typeof o.orientacoes === 'string' ? o.orientacoes.trim() : '';
  if (orientacoes.length > MAX_TEXTO) erros.orientacoes = MSG_PLANO.texto;
  if (o.modo !== undefined && !MODOS.includes(o.modo as ModoPlano)) throw new PlanoError({ geral: MSG_PLANO.invalido });
  const macrosPrescritos = lerMacros(o.macrosPrescritos);
  if (macrosPrescritos === false) erros.macrosPrescritos = MSG_TEXTO_LIVRE.macros;
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
    const receita = r.recipeContentId ?? null;
    if (receita !== null && !idValido(receita)) erros[`${chave}:receita`] = MSG_PLANO.receita;
    let diasSemana: DiaDaSemana[] | undefined;
    if (r.diasSemana !== undefined) {
      const dias = lerDias(r.diasSemana);
      if (!dias) throw new PlanoError({ geral: MSG_PLANO.invalido });
      // antes do CHECK meals_dias_validos: o erro fica no campo, e nada é gravado
      if (!dias.length) erros[`${chave}:dias`] = MSG_DIAS.nenhum;
      diasSemana = dias;
    }
    let descricaoLivre: string | null | undefined;
    if (r.descricaoLivre !== undefined) {
      if (r.descricaoLivre !== null && typeof r.descricaoLivre !== 'string') throw new PlanoError({ geral: MSG_PLANO.invalido });
      const texto = typeof r.descricaoLivre === 'string' ? r.descricaoLivre.trim() : '';
      if (texto.length > MAX_TEXTO) erros[`${chave}:descricaoLivre`] = MSG_PLANO.texto;
      descricaoLivre = texto || null; // RN-243: o rascunho aceita a refeição sem texto; a publicação, não
    }
    refeicoes.push({ id: r.id as string, nome, horario: horario || null, observacao, ordem, recipeContentId: idValido(receita) ? receita : null, diasSemana, descricaoLivre });
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
    envio: chaves.data.envio,
    enviosIncertos: chaves.data.enviosIncertos ?? [],
    titulo,
    metaKcal: metaN === null ? null : arredondar(metaN, 0),
    energyCalcId: idValido(o.energyCalcId) ? o.energyCalcId : null,
    mostrarCalorias: o.mostrarCalorias === true,
    orientacoes,
    modo: o.modo as ModoPlano | undefined,
    macrosPrescritos: macrosPrescritos === false ? undefined : macrosPrescritos,
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
 * Trava otimista com repetição segura: vale a revisão atual, ou uma revisão anterior se o envio gravado por último
 * está em `enviosIncertos` (envios desta tela cuja resposta se perdeu). O corpo é o rascunho inteiro e a gravação é
 * por diferença, então reaplicar inclui as edições novas sem desfazer nada das tentativas anteriores.
 */
export async function salvarRascunho(ctx: TenantContext, planId: string, entrada: unknown, deps: Deps = {}): Promise<{ revisao: number }> {
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  const v = validar(entrada);
  const now = deps.now ?? new Date();
  let comSugestaoNova: string[] = [];
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
        // Por que o aceite com revisão antiga é seguro: todo envio desta tela leva a mesma revisão N (nenhuma resposta
        // chegou). Se outra aba gravasse depois de N, `ultimo_envio` seria o dela, fora da lista, e nenhum envio desta
        // tela passaria mais (todos com N < revisão). Logo, `ultimo_envio` na lista ⇒ todo commit desde N é desta tela.
        const repeticao = p.revisao > v.revisao && p.ultimoEnvio !== null && v.enviosIncertos.includes(p.ultimoEnvio);
        if (p.revisao !== v.revisao && !repeticao) throw new ConflitoRevisaoError();
        // RN-243: no modo livre a refeição tem texto, não alimentos; no calculado, nem texto nem distribuição prescrita
        const modo = v.modo ?? (p.modo as ModoPlano);
        if (modo === 'livre' && v.itens.length) throw new PlanoError({ geral: MSG_PLANO.invalido });
        const macrosPrescritos = modo === 'livre' ? (v.macrosPrescritos !== undefined ? v.macrosPrescritos : (p.macrosPrescritos ?? null)) : null;

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
        // US-054 (D13): sugestão NOVA (ou trocada) só de receita publicada do tenant; a que já estava fica mesmo se a
        // receita foi despublicada depois ("Receita indisponível"), senão o salvamento automático travaria
        const sugestaoNova = (r: RefeicaoValida) => r.recipeContentId !== null && r.recipeContentId !== (refeicoesAtuais.get(r.id)?.recipeContentId ?? null);
        const anexadas = [...new Set(v.refeicoes.flatMap((r) => (sugestaoNova(r) ? [r.recipeContentId!] : [])))];
        if (anexadas.length) {
          comSugestaoNova = v.refeicoes.filter(sugestaoNova).map((r) => r.id);
          // FOR SHARE: uma exclusão ou despublicação em curso termina antes (a leitura espera e reconfere a linha nova);
          // as que chegarem depois esperam este COMMIT — sem 23503 na FK do INSERT nem sugestão de receita fora do ar
          const ok = new Set(
            (
              await tx
                .select({ id: contents.id })
                .from(contents)
                .where(and(inArray(contents.id, anexadas), eq(contents.tipo, 'receita'), eq(contents.status, 'publicado')))
                .for('share')
            ).map((c) => c.id),
          );
          // só a refeição que anexou (ou trocou): a que manteve a mesma sugestão não é marcada
          const ruins = Object.fromEntries(v.refeicoes.filter((r) => sugestaoNova(r) && !ok.has(r.recipeContentId!)).map((r) => [`refeicao:${r.id}:receita`, MSG_PLANO.receita]));
          if (Object.keys(ruins).length) throw new PlanoError(ruins);
        }
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

        // 2. Refeições novas (um INSERT só — D04-2) e alteradas
        const refeicoesNovas: (typeof meals.$inferInsert)[] = [];
        for (const r of v.refeicoes) {
          const atual = refeicoesAtuais.get(r.id);
          const dados = {
            nome: r.nome, horario: r.horario, observacao: r.observacao, ordem: r.ordem, recipeContentId: r.recipeContentId,
            diasSemana: r.diasSemana ?? (atual?.diasSemana as DiaDaSemana[] | undefined) ?? [...TODOS_OS_DIAS],
            descricaoLivre: modo === 'livre' ? (r.descricaoLivre !== undefined ? r.descricaoLivre : (atual?.descricaoLivre ?? null)) : null,
          };
          if (!atual) refeicoesNovas.push({ id: r.id, tenantId: ctx.tenantId, patientId: p.patientId, planId, ...dados });
          else if (
            !iguais(
              { nome: atual.nome, horario: atual.horario?.slice(0, 5) ?? null, observacao: atual.observacao, ordem: atual.ordem, recipeContentId: atual.recipeContentId, diasSemana: atual.diasSemana, descricaoLivre: atual.descricaoLivre },
              dados,
            )
          )
            await tx.update(meals).set({ ...dados, updatedAt: now }).where(eq(meals.id, r.id));
        }
        if (refeicoesNovas.length) await tx.insert(meals).values(refeicoesNovas);

        // 3. Itens: principais antes das substituições (FK meal_items_principal_fk) — um INSERT por grupo (D04-2); os
        //    alterados, um UPDATE cada (o gatilho de auditoria registra só o que mudou)
        for (const grupo of [v.itens.filter((i) => i.substituiItemId === null), v.itens.filter((i) => i.substituiItemId !== null)]) {
          const novos: (typeof mealItems.$inferInsert)[] = [];
          for (const i of grupo) {
            const atual = itensAtuais.get(i.id);
            const dados = { foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida, medidaCaseiraTxt: i.medidaCaseiraTxt, substituiItemId: i.substituiItemId, ordem: i.ordem };
            if (!atual) novos.push({ id: i.id, tenantId: ctx.tenantId, patientId: p.patientId, planId, mealId: i.mealId, ...dados });
            else if (!iguais({ foodId: atual.foodId, quantidadeG: atual.quantidadeG, medida: atual.medida ?? null, medidaCaseiraTxt: atual.medidaCaseiraTxt, substituiItemId: atual.substituiItemId, ordem: atual.ordem }, dados))
              await tx.update(mealItems).set({ ...dados, updatedAt: now }).where(eq(mealItems.id, i.id));
          }
          if (novos.length) await tx.insert(mealItems).values(novos);
        }

        const [r] = await tx
          .update(mealPlans)
          .set({
            titulo: v.titulo,
            metaKcal: v.metaKcal,
            energyCalcId: v.energyCalcId,
            mostrarCalorias: v.mostrarCalorias,
            orientacoes: v.orientacoes,
            modo,
            macrosPrescritos,
            revisao: p.revisao + 1,
            ultimoEnvio: v.envio,
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
    // defesa: a receita saiu entre a conferência e o INSERT (a trava acima evita) → o erro da refeição, não um 500
    if (fkViolation(e) === 'meals_receita_fk' && comSugestaoNova.length)
      throw new PlanoError(Object.fromEntries(comSugestaoNova.map((id) => [`refeicao:${id}:receita`, MSG_PLANO.receita])));
    // a transação foi desfeita (nada gravado, revisão intacta): o editor pede para recarregar, sem 500
    if (deadlockDetectado(e)) throw new PlanoError({ geral: MSG_PLANO.invalido });
    throw e;
  }
}

/**
 * RN-256: o que as cópias do plano ("Editar", "Salvar como modelo", "Criar a partir de modelo") levam do cabeçalho além do
 * que cada uma já levava; `referencia_congelada` não (é da publicação). O perfil é o do rascunho ou modelo; de um
 * publicado ou arquivado (sem `referencia_id`, RN-238), o da cópia congelada, se o perfil ainda existe e é visível (RLS
 * da sessão). FOR KEY SHARE: uma exclusão do perfil em curso termina antes (e a linha não aparece) ou espera este COMMIT
 * (e então solta o ponteiro da cópia nova, ON DELETE SET NULL) — sem 23503 na FK do INSERT.
 */
export async function cabecalhoDaCopia(tx: Tx, p: MealPlanRow) {
  let referenciaId = p.referenciaId;
  const congelada = p.referenciaCongelada?.id;
  if (!referenciaId && idValido(congelada)) {
    const [r] = await tx.select({ id: referenciasNutrientes.id }).from(referenciasNutrientes).where(eq(referenciasNutrientes.id, congelada)).for('key share');
    referenciaId = r?.id ?? null;
  }
  return { modo: p.modo, nutrientesExibidos: p.nutrientesExibidos, macrosPrescritos: p.macrosPrescritos, mostrarMicrosPdf: p.mostrarMicrosPdf, referenciaId };
}

/**
 * Copia refeições e itens (ids novos) de um plano para outro: modelos (Tarefa 9) e "Editar" (Tarefa 10).
 * A origem fica travada FOR SHARE antes das leituras (um salvamento automático em curso, FOR UPDATE, termina antes:
 * refeições e itens saem da mesma versão). Paciente e tenant das linhas novas vêm do plano de destino no banco.
 * Quem trava o paciente o faz antes de chamar (paciente → tenant → plano, como no salvamento e na publicação).
 * Plano 19 (RN-256): também os dias e o texto livre de cada refeição, as listas de substituição ligadas (a mesma cópia
 * congelada, sem reler a biblioteca) e as receitas e materiais ligados. O cabeçalho (modo, perfil…) é de quem chama.
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
      rs.map((r) => ({
        id: novoIdRefeicao.get(r.id)!, tenantId: destino.tenantId, patientId: destino.patientId, planId: destino.id, nome: r.nome, horario: r.horario, ordem: r.ordem,
        observacao: r.observacao, recipeContentId: r.recipeContentId, diasSemana: r.diasSemana, descricaoLivre: r.descricaoLivre,
      })),
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
  await copiarLigados(tx, origemId, destino);
}

/** RN-252/RN-253: as ligações do plano (listas copiadas e conteúdos), com a mesma ordem e a mesma data da cópia. */
async function copiarLigados(tx: Tx, origemId: string, destino: { id: string; tenantId: string; patientId: string | null }): Promise<void> {
  const listas = await tx.select().from(planoListasSubstituicao).where(eq(planoListasSubstituicao.planId, origemId));
  if (listas.length)
    await tx.insert(planoListasSubstituicao).values(
      listas.map((l) => ({
        tenantId: destino.tenantId, patientId: destino.patientId, planId: destino.id, listaOrigemId: l.listaOrigemId, nome: l.nome, orientacao: l.orientacao,
        conteudo: l.conteudo, copiadaEm: l.copiadaEm, ordem: l.ordem,
      })),
    );
  const ligados = await tx.select().from(planoConteudos).where(eq(planoConteudos.planId, origemId));
  if (!ligados.length) return;
  // FOR SHARE, no molde da receita sugerida em salvarRascunho: uma exclusão do conteúdo em curso termina antes (a
  // leitura espera e não acha a linha) e as que chegarem depois esperam este COMMIT — sem 23503 na FK do INSERT. O
  // conteúdo que saiu fica como a exclusão o deixaria (ON DELETE SET NULL): sem `content_id`, com o título copiado.
  const ids = [...new Set(ligados.flatMap((c) => (c.contentId ? [c.contentId] : [])))];
  const existem = new Set(ids.length ? (await tx.select({ id: contents.id }).from(contents).where(inArray(contents.id, ids)).for('share')).map((c) => c.id) : []);
  await tx.insert(planoConteudos).values(
    ligados.map((c) => ({
      tenantId: destino.tenantId, patientId: destino.patientId, planId: destino.id, contentId: c.contentId && existem.has(c.contentId) ? c.contentId : null, titulo: c.titulo, ordem: c.ordem,
    })),
  );
}

/**
 * Plano 14B (RN-122, RN-124): grava refeições e itens sugeridos pela IA (já revalidados por validarPlanoIa) num plano que
 * acabou de nascer (`patientId` nulo = modelo). Confere de novo, na transação, que cada alimento ainda é visível ao tenant:
 * o que sumiu entre a geração e a gravação sai e é contado (`foraDoCatalogo`), com as substituições dele. Refeição sem
 * principal visível não é criada. Um INSERT por grupo (principais antes das substituições, FK meal_items_principal_fk),
 * como no salvamento automático. `substitui` é o índice (0…n-1) do principal na lista de itens da refeição.
 */
export async function gravarConteudoRascunhoTx(tx: Tx, tenantId: string, patientId: string | null, planId: string, refeicoes: RefeicaoIa[]): Promise<{ itens: number; foraDoCatalogo: number }> {
  const ids = [...new Set(refeicoes.flatMap((r) => r.itens.map((i) => i.foodId)))];
  const visiveis = new Set(ids.length ? (await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, ids))).map((f) => f.id) : []);
  let foraDoCatalogo = 0;
  let itensGravados = 0;
  for (const [ordem, r] of refeicoes.entries()) {
    const principaisValidos = r.itens.map((i, idx) => ({ i, idx })).filter(({ i }) => i.substitui === null && visiveis.has(i.foodId));
    if (!principaisValidos.length) {
      foraDoCatalogo += r.itens.length;
      continue;
    }
    const mealId = crypto.randomUUID();
    // RN-246: a refeição sugerida pela IA vale todos os dias (a saída da IA não traz dias)
    await tx.insert(meals).values({ id: mealId, tenantId, patientId, planId, nome: r.nome, horario: r.horario, ordem, observacao: '', diasSemana: [...TODOS_OS_DIAS] });
    const novoId = new Map<number, string>();
    const linha = (i: ItemIa, idx: number, o: number, principal: string | null) => {
      const id = crypto.randomUUID();
      novoId.set(idx, id);
      return {
        id, tenantId, patientId, planId, mealId, foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida,
        medidaCaseiraTxt: i.medida ? textoMedida(i.medida.qtd, i.medida) : null, substituiItemId: principal, ordem: o,
      };
    };
    const principais = principaisValidos.map(({ i, idx }, o) => linha(i, idx, o, null));
    await tx.insert(mealItems).values(principais);
    const subs = r.itens
      .map((i, idx) => ({ i, idx }))
      .filter(({ i }) => i.substitui !== null && visiveis.has(i.foodId) && novoId.has(i.substitui))
      .map(({ i, idx }, o) => linha(i, idx, principais.length + o, novoId.get(i.substitui!)!));
    if (subs.length) await tx.insert(mealItems).values(subs);
    itensGravados += principais.length + subs.length;
    foraDoCatalogo += r.itens.length - principais.length - subs.length;
  }
  return { itens: itensGravados, foraDoCatalogo };
}

/** "Descartar rascunho": só o rascunho do paciente da URL (plano de outro paciente → não encontrado); paciente bloqueado não descarta. */
export async function descartarRascunho(ctx: TenantContext, patientId: string, planId: string, deps: Deps = {}): Promise<void> {
  if (!idValido(planId) || !idValido(patientId)) throw new PlanoNaoEncontradoError();
  await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx
        .select({ id: mealPlans.id })
        .from(mealPlans)
        .where(and(eq(mealPlans.id, planId), eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'rascunho'), eq(mealPlans.isTemplate, false)));
      if (!p) throw new PlanoNaoEncontradoError();
      await carregarPacienteParaEscrita(tx, patientId);
      await tx.delete(mealPlans).where(and(eq(mealPlans.id, planId), eq(mealPlans.status, 'rascunho')));
    },
    deps.db ?? getDb(),
  );
}
