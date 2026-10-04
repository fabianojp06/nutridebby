import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contents, foods, mealItems, mealPlans, meals } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { medidasDeVarios } from '@/modules/alimentos/medidas';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import type { PlanoCompleto, PlanoDoCliente, ReceitaDaRefeicao, StatusPlano } from './tipos';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/**
 * Plano inteiro na transação. Rascunho/modelo: valores atuais dos alimentos + medidas para trocar (só se o chamador
 * for mostrar o editor: `comMedidas: false` na publicação e na exportação, que não as usam).
 * Publicado/arquivado: a cópia congelada na publicação (D10), sem medidas para trocar.
 */
export async function lerPlanoNaTransacao(tx: Tx, planId: string, opts: { auditar?: boolean; comMedidas?: boolean } = {}): Promise<PlanoCompleto | null> {
  if (!idValido(planId)) return null;
  const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId));
  if (!p) return null;
  const rs = await tx.select().from(meals).where(eq(meals.planId, p.id)).orderBy(asc(meals.ordem));
  const its = await tx
    .select({ i: mealItems, f: { nome: foods.nome, tenantId: foods.tenantId, kcal: foods.kcal, proteinaG: foods.proteinaG, carboidratoG: foods.carboidratoG, lipidioG: foods.lipidioG, fibraG: foods.fibraG } })
    .from(mealItems)
    .innerJoin(foods, eq(foods.id, mealItems.foodId))
    .where(and(eq(mealItems.planId, p.id)))
    .orderBy(asc(mealItems.ordem));
  // US-054: título e situação da receita sugerida. Na sessão de paciente a RLS só devolve a publicada (e, fora da
  // audiência, só porque planoDoPaciente ligou liberarReceitasDoPlano nesta transação) — a despublicada fica fora do
  // mapa e a refeição sai sem `disponivel` (o portal esconde o cartão)
  const idsReceita = [...new Set(rs.flatMap((r) => (r.recipeContentId ? [r.recipeContentId] : [])))];
  const receitas = new Map(
    idsReceita.length
      ? (await tx.select({ id: contents.id, titulo: contents.titulo, status: contents.status }).from(contents).where(inArray(contents.id, idsReceita))).map((c) => [c.id, c])
      : [],
  );
  const receitaDa = (id: string | null): { receita?: ReceitaDaRefeicao } => {
    if (!id) return {};
    const c = receitas.get(id);
    return { receita: c ? { id, titulo: c.titulo, disponivel: c.status === 'publicado' } : { id, titulo: '', disponivel: false } };
  };
  const editavel = p.status === 'rascunho';
  const medidas = editavel && opts.comMedidas !== false ? await medidasDeVarios(tx, its.map((x) => x.i.foodId)) : new Map();
  if (opts.auditar !== false && p.patientId) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: p.patientId });
  return {
    id: p.id,
    patientId: p.patientId,
    isTemplate: p.isTemplate,
    titulo: p.titulo,
    metaKcal: p.metaKcal,
    energyCalcId: p.energyCalcId,
    status: p.status as StatusPlano,
    versao: p.versao,
    revisao: p.revisao,
    publicadoEm: p.publicadoEm?.toISOString() ?? null,
    mostrarCalorias: p.mostrarCalorias,
    orientacoes: p.orientacoes,
    pdfStatus: p.pdfStatus as PlanoCompleto['pdfStatus'],
    pdfPath: p.pdfPath,
    refeicoes: rs.map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: hhmm(r.horario),
      observacao: r.observacao,
      ...receitaDa(r.recipeContentId),
      itens: its
        .filter((x) => x.i.mealId === r.id)
        .map(({ i, f }) => {
          const congelado = !editavel && i.nutrientes;
          const v = congelado ? i.nutrientes! : { ...f, origem: f.tenantId === null ? ('TACO' as const) : ('Meu alimento' as const) };
          return {
            id: i.id,
            foodId: i.foodId,
            nome: v.nome,
            origem: v.origem,
            porCem: { kcal: v.kcal, proteinaG: v.proteinaG, carboidratoG: v.carboidratoG, lipidioG: v.lipidioG, fibraG: v.fibraG },
            medidas: medidas.get(i.foodId) ?? [],
            quantidadeG: i.quantidadeG,
            medida: i.medida ?? null,
            medidaCaseiraTxt: i.medidaCaseiraTxt,
            substituiItemId: i.substituiItemId,
          };
        }),
    })),
  };
}

/** Plano para o cliente (props do editor, JSON da API): sem o caminho interno do arquivo do PDF. */
export function paraCliente(p: PlanoCompleto): PlanoDoCliente {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pdfPath, ...resto } = p;
  return resto;
}

/** Leitura auditada (RNF-08) de um plano do tenant; modelo não tem paciente e não gera leitura auditada. */
export async function carregarPlano(ctx: TenantContext, planId: string, db: Db = getDb()): Promise<PlanoCompleto | null> {
  if (!idValido(planId)) return null;
  return withTenant(ctx, (tx) => lerPlanoNaTransacao(tx, planId), db);
}

/**
 * Só o estado da geração do PDF de um plano do paciente (polling do "Seu PDF está sendo preparado", US-026).
 * Sem auditoria: não devolve dado de saúde (nem o caminho do arquivo). Plano de outro paciente ou de outro tenant
 * (RLS) → undefined.
 */
export async function statusDoPdf(ctx: TenantContext, planId: string, patientId: string, db: Db = getDb()): Promise<PlanoCompleto['pdfStatus'] | undefined> {
  if (!idValido(planId) || !idValido(patientId)) return undefined;
  const [p] = await withTenant(ctx, (tx) => tx.select({ pdfStatus: mealPlans.pdfStatus }).from(mealPlans).where(and(eq(mealPlans.id, planId), eq(mealPlans.patientId, patientId))), db);
  return p ? (p.pdfStatus as PlanoCompleto['pdfStatus']) : undefined;
}

/**
 * Só a revisão do plano (D7): o editor confere ao abrir se a página não veio do cache do "Voltar" do navegador (ou
 * se outra aba gravou depois). Sem auditoria: não devolve dado de saúde. `patientId` nulo = modelo. Plano de outro
 * paciente, de outro tenant (RLS), modelo pedido como plano de paciente ou o contrário → undefined.
 */
export async function revisaoDoPlano(ctx: TenantContext, planId: string, patientId: string | null, db: Db = getDb()): Promise<number | undefined> {
  if (!idValido(planId) || (patientId !== null && !idValido(patientId))) return undefined;
  const doDono = patientId === null ? isNull(mealPlans.patientId) : eq(mealPlans.patientId, patientId);
  const [p] = await withTenant(ctx, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(and(eq(mealPlans.id, planId), doDono)), db);
  return p?.revisao;
}

/** Versões do plano do paciente (mais nova primeiro) — tela "Plano alimentar" do prontuário. */
export async function listarPlanosDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()) {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: mealPlans.id, versao: mealPlans.versao, status: mealPlans.status, titulo: mealPlans.titulo, publicadoEm: mealPlans.publicadoEm, pdfStatus: mealPlans.pdfStatus })
        .from(mealPlans)
        .where(eq(mealPlans.patientId, patientId))
        .orderBy(desc(mealPlans.versao));
      if (r.length) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: null, patientId });
      return r.map((x) => ({ ...x, status: x.status as StatusPlano, pdfStatus: x.pdfStatus as PlanoCompleto['pdfStatus'], publicadoEm: x.publicadoEm?.toISOString() ?? null }));
    },
    db,
  );
}
