import { and, count, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mealPlans, meals } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { MSG_PLANO } from './constantes';
import { PlanoError, PlanoNaoEncontradoError } from './erros';
import { copiarConteudo, proximaVersao } from './rascunho';

type Deps = { db?: Db };

function titulo(v: unknown): string {
  const t = normalizarTexto(v);
  if (!t || t.length > 120) throw new PlanoError({ titulo: MSG_PLANO.titulo });
  return t;
}

export async function criarModelo(ctx: TenantContext, tituloEntrada: unknown, deps: Deps = {}): Promise<{ id: string }> {
  const t = titulo(tituloEntrada);
  const [m] = await withTenant(ctx, (tx) => tx.insert(mealPlans).values({ tenantId: ctx.tenantId, isTemplate: true, titulo: t }).returning({ id: mealPlans.id }), deps.db ?? getDb());
  return m;
}

export async function listarModelos(ctx: TenantContext, db: Db = getDb()) {
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: mealPlans.id, titulo: mealPlans.titulo, atualizadoEm: mealPlans.updatedAt, refeicoes: count(meals.id) })
        .from(mealPlans)
        .leftJoin(meals, eq(meals.planId, mealPlans.id))
        .where(eq(mealPlans.isTemplate, true))
        .groupBy(mealPlans.id)
        .orderBy(desc(mealPlans.updatedAt));
      return r.map((x) => ({ ...x, atualizadoEm: x.atualizadoEm.toISOString() }));
    },
    db,
  );
}

/** US-024 "Salvar plano como modelo": copia refeições e itens para um modelo novo (sem paciente). */
export async function salvarComoModelo(ctx: TenantContext, planId: string, tituloEntrada: unknown, deps: Deps = {}): Promise<{ id: string }> {
  const t = titulo(tituloEntrada);
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId));
      if (!p) throw new PlanoNaoEncontradoError();
      if (p.patientId) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: p.patientId }); // copiar lê o plano do paciente
      const [m] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, isTemplate: true, titulo: t, metaKcal: p.metaKcal, orientacoes: p.orientacoes, origemPlanId: p.id })
        .returning({ id: mealPlans.id });
      await copiarConteudo(tx, p.id, { id: m.id, patientId: null, tenantId: ctx.tenantId });
      return m;
    },
    deps.db ?? getDb(),
  );
}

/** US-024 "Criar a partir de modelo": rascunho novo do paciente (D11: só se ele não tiver rascunho). */
export async function criarDeModelo(ctx: TenantContext, modeloId: string, patientId: string, deps: Deps = {}): Promise<{ id: string }> {
  if (!idValido(modeloId)) throw new PlanoNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const [m] = await tx.select().from(mealPlans).where(and(eq(mealPlans.id, modeloId), eq(mealPlans.isTemplate, true)));
      if (!m) throw new PlanoNaoEncontradoError();
      const [existe] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'rascunho')));
      if (existe) throw new PlanoError({ geral: MSG_PLANO.rascunhoExiste });
      const [p] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, patientId, titulo: m.titulo, metaKcal: m.metaKcal, orientacoes: m.orientacoes, origemPlanId: m.id, versao: await proximaVersao(tx, patientId) })
        .returning({ id: mealPlans.id });
      await copiarConteudo(tx, m.id, { id: p.id, patientId, tenantId: ctx.tenantId });
      return p;
    },
    deps.db ?? getDb(),
  );
}

export async function excluirModelo(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new PlanoNaoEncontradoError();
  const r = await withTenant(ctx, (tx) => tx.delete(mealPlans).where(and(eq(mealPlans.id, id), eq(mealPlans.isTemplate, true))).returning({ id: mealPlans.id }), deps.db ?? getDb());
  if (!r.length) throw new PlanoNaoEncontradoError();
}
