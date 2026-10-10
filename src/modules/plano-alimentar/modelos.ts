import { and, count, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mealPlans, meals } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { MSG_MODELO_IA, MSG_PLANO } from './constantes';
import { PlanoError, PlanoNaoEncontradoError } from './erros';
import { copiarConteudo, proximaVersao } from './rascunho';

type Deps = { db?: Db };

/** RN-125: usável = feito pela nutricionista (sem origem IA) ou sugerido e já aprovado. */
const usavel = or(isNull(mealPlans.iaGeracaoId), isNotNull(mealPlans.aprovadoEm));

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

/** Todos os modelos do consultório (tela "Modelos de plano"), com a marca da sugestão da IA ainda não aprovada (US-123). */
export async function listarModelos(ctx: TenantContext, db: Db = getDb()) {
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: mealPlans.id, titulo: mealPlans.titulo, atualizadoEm: mealPlans.updatedAt, refeicoes: count(meals.id), iaGeracaoId: mealPlans.iaGeracaoId, aprovadoEm: mealPlans.aprovadoEm })
        .from(mealPlans)
        .leftJoin(meals, eq(meals.planId, mealPlans.id))
        .where(eq(mealPlans.isTemplate, true))
        .groupBy(mealPlans.id)
        .orderBy(desc(mealPlans.updatedAt));
      return r.map(({ iaGeracaoId, aprovadoEm, ...x }) => ({
        ...x,
        atualizadoEm: x.atualizadoEm.toISOString(),
        sugestaoIa: iaGeracaoId !== null && aprovadoEm === null,
        aprovadoEm: aprovadoEm?.toISOString() ?? null,
      }));
    },
    db,
  );
}

/** US-123 "Modelo não aprovado não é usado": a lista do "Criar a partir de modelo". */
export async function listarModelosUsaveis(ctx: TenantContext, db: Db = getDb()) {
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: mealPlans.id, titulo: mealPlans.titulo, atualizadoEm: mealPlans.updatedAt, refeicoes: count(meals.id) })
        .from(mealPlans)
        .leftJoin(meals, eq(meals.planId, mealPlans.id))
        .where(and(eq(mealPlans.isTemplate, true), usavel))
        .groupBy(mealPlans.id)
        .orderBy(desc(mealPlans.updatedAt));
      return r.map((x) => ({ ...x, atualizadoEm: x.atualizadoEm.toISOString() }));
    },
    db,
  );
}

/**
 * US-123 "Aprovar": quem aprovou é a usuária da sessão (o gatilho app_modelo_ia_origem confere); modelo travado
 * (FOR UPDATE); já aprovado → nada muda. Só modelo de origem IA: o resto (modelo à mão, plano de paciente) → não encontrado.
 */
export async function aprovarModeloPlano(ctx: TenantContext, id: string, deps: Deps & { agora?: Date } = {}): Promise<void> {
  if (!idValido(id) || !ctx.actorUserId) throw new PlanoNaoEncontradoError();
  const aprovadoPor = ctx.actorUserId;
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const [m] = await tx
        .select({ origem: mealPlans.iaGeracaoId, aprovadoEm: mealPlans.aprovadoEm })
        .from(mealPlans)
        .where(and(eq(mealPlans.id, id), eq(mealPlans.isTemplate, true)))
        .for('update');
      if (!m?.origem) throw new PlanoNaoEncontradoError();
      if (m.aprovadoEm) return;
      await tx.update(mealPlans).set({ aprovadoEm: agora, aprovadoPor, updatedAt: agora }).where(eq(mealPlans.id, id));
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-024 "Salvar plano como modelo": copia refeições e itens para um modelo novo (sem paciente).
 * Plano de paciente bloqueado ou anonimizado (US-018) não vira modelo: o prontuário dele é só para consulta.
 * Travas na ordem do salvamento e da publicação: paciente → plano.
 */
export async function salvarComoModelo(ctx: TenantContext, planId: string, tituloEntrada: unknown, deps: Deps = {}): Promise<{ id: string }> {
  const t = titulo(tituloEntrada);
  if (!idValido(planId)) throw new PlanoNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      const [antes] = await tx.select({ patientId: mealPlans.patientId }).from(mealPlans).where(eq(mealPlans.id, planId));
      if (!antes) throw new PlanoNaoEncontradoError();
      if (antes.patientId) await carregarPacienteParaEscrita(tx, antes.patientId); // bloqueado/anonimizado → PacienteBloqueadoError
      // FOR SHARE: cabeçalho, refeições e itens da mesma versão (o salvamento em curso termina antes)
      const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId)).for('share');
      if (!p) throw new PlanoNaoEncontradoError(); // descartado entre a leitura e a trava
      if (p.iaGeracaoId && !p.aprovadoEm) throw new PlanoError({ geral: MSG_MODELO_IA.aprove }); // RN-125: copiar a sugestão não aprovada viraria modelo à mão
      if (p.patientId) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: p.patientId }); // copiar lê o plano do paciente
      const [m] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, isTemplate: true, titulo: t, metaKcal: p.metaKcal, orientacoes: p.orientacoes, origemPlanId: p.id })
        .returning({ id: mealPlans.id });
      await copiarConteudo(tx, p.id, m.id);
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
      await carregarPacienteParaEscrita(tx, patientId); // paciente → modelo (FOR SHARE: a edição do modelo em curso termina antes)
      const [m] = await tx.select().from(mealPlans).where(and(eq(mealPlans.id, modeloId), eq(mealPlans.isTemplate, true))).for('share');
      if (!m) throw new PlanoNaoEncontradoError();
      if (m.iaGeracaoId && !m.aprovadoEm) throw new PlanoError({ geral: MSG_MODELO_IA.aprove }); // RN-125: sugestão da IA só depois de aprovada
      const [existe] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'rascunho')));
      if (existe) throw new PlanoError({ geral: MSG_PLANO.rascunhoExiste });
      const [p] = await tx
        .insert(mealPlans)
        .values({ tenantId: ctx.tenantId, patientId, titulo: m.titulo, metaKcal: m.metaKcal, orientacoes: m.orientacoes, origemPlanId: m.id, versao: await proximaVersao(tx, patientId) })
        .returning({ id: mealPlans.id });
      await copiarConteudo(tx, m.id, p.id);
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
