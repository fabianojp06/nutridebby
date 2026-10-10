import { and, asc, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { anamneses, anamnesisTemplates, iaGeracoesModelos, type AnamneseRow, type AnamnesisTemplateRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { MSG_MODELO_IA } from '@/modules/plano-alimentar/constantes';
import { auditRead } from '@/modules/plataforma/audit';
import { modeloPadrao } from './anamnese-padrao';
import { MSG_ANAMNESE, validarModelo, validarRespostas, type Pergunta } from './anamnese-tipos';
import { carregarPacienteParaEscrita, idValido } from './base';
import { hojeNoFuso } from './datas';

/** Erros por pergunta (id), por campo do modelo (`nome`, `pergunta_<n>`) ou `geral`. */
export class AnamneseError extends Error {
  override name = 'AnamneseError';
  constructor(readonly erros: Record<string, string>) {
    super('Anamnese inválida');
  }
}

/** `sugestaoIa`: modelo sugerido pela IA ainda não aprovado ("Sugestão da IA — revise", US-123); `aprovadoEm` em ISO. */
export type ModeloResumo = { id: string; nome: string; padrao: boolean; perguntas: number; sugestaoIa: boolean; aprovadoEm: string | null };

/** RN-125: usável com pacientes = feito pela nutricionista (sem origem IA) ou sugerido e já aprovado. */
const usavel = or(isNull(anamnesisTemplates.iaGeracaoId), isNotNull(anamnesisTemplates.aprovadoEm));

const resumo = (m: AnamnesisTemplateRow): ModeloResumo => ({
  id: m.id,
  nome: m.nome,
  padrao: m.padrao,
  perguntas: m.schema.perguntas.length,
  sugestaoIa: m.iaGeracaoId !== null && m.aprovadoEm === null,
  aprovadoEm: m.aprovadoEm?.toISOString() ?? null,
});

/** Cria o "Anamnese geral" se o tenant nunca teve um padrão. Corrida: o índice único parcial decide. */
export async function garantirModeloPadrao(tx: Tx, tenantId: string): Promise<void> {
  const m = modeloPadrao();
  await tx.insert(anamnesisTemplates).values({ tenantId, nome: m.nome, schema: m.schema, padrao: true }).onConflictDoNothing();
}

/** Todos os modelos ativos (tela "Modelos de anamnese"), com a marca da sugestão da IA. */
export async function listarModelos(ctx: TenantContext, db: Db = getDb()): Promise<ModeloResumo[]> {
  return listar(ctx, false, db);
}

/** US-123 "Modelo não aprovado não é usado": as escolhas do prontuário (sugestão da IA só depois de aprovada). */
export async function listarModelosUsaveis(ctx: TenantContext, db: Db = getDb()): Promise<ModeloResumo[]> {
  return listar(ctx, true, db);
}

async function listar(ctx: TenantContext, soUsaveis: boolean, db: Db): Promise<ModeloResumo[]> {
  return withTenant(
    ctx,
    async (tx) => {
      await garantirModeloPadrao(tx, ctx.tenantId);
      const ativo = isNull(anamnesisTemplates.arquivadoEm);
      const r = await tx
        .select()
        .from(anamnesisTemplates)
        .where(soUsaveis ? and(ativo, usavel) : ativo)
        .orderBy(desc(anamnesisTemplates.padrao), asc(anamnesisTemplates.nome));
      return r.map(resumo);
    },
    db,
  );
}

export async function buscarModelo(ctx: TenantContext, id: string, db: Db = getDb()): Promise<AnamnesisTemplateRow | null> {
  if (!idValido(id)) return null;
  const [m] = await withTenant(ctx, (tx) => tx.select().from(anamnesisTemplates).where(and(eq(anamnesisTemplates.id, id), isNull(anamnesisTemplates.arquivadoEm))), db);
  return m ?? null;
}

/** US-123: o modelo para preencher a anamnese de um paciente — o sugerido pela IA ainda não aprovado fica de fora (404). */
export async function buscarModeloUsavel(ctx: TenantContext, id: string, db: Db = getDb()): Promise<AnamnesisTemplateRow | null> {
  if (!idValido(id)) return null;
  const [m] = await withTenant(ctx, (tx) => tx.select().from(anamnesisTemplates).where(and(eq(anamnesisTemplates.id, id), isNull(anamnesisTemplates.arquivadoEm), usavel)), db);
  return m ?? null;
}

/**
 * US-123 (desvio 12): itens descartados do pacote de onde veio o modelo sugerido (a equipe lê a geração, staff_only).
 * Sem geração (modelo feito à mão) → 0.
 */
export async function itensDescartadosDoModelo(ctx: TenantContext, m: Pick<AnamnesisTemplateRow, 'iaGeracaoId'>, db: Db = getDb()): Promise<number> {
  if (!m.iaGeracaoId) return 0;
  const geracaoId = m.iaGeracaoId;
  const [g] = await withTenant(ctx, (tx) => tx.select({ n: iaGeracoesModelos.itensDescartados }).from(iaGeracoesModelos).where(eq(iaGeracoesModelos.id, geracaoId)), db);
  return g?.n ?? 0;
}

/** US-123 "Aprovar" (anamnese): quem aprovou é a usuária da sessão (gatilho app_modelo_ia_origem); modelo travado; já aprovado → nada muda. */
export async function aprovarModeloAnamnese(ctx: TenantContext, id: string, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  if (!idValido(id) || !ctx.actorUserId) throw new AnamneseError({ geral: MSG_ANAMNESE.modeloNaoEncontrado });
  const aprovadoPor = ctx.actorUserId;
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const [m] = await tx
        .select({ origem: anamnesisTemplates.iaGeracaoId, aprovadoEm: anamnesisTemplates.aprovadoEm })
        .from(anamnesisTemplates)
        .where(and(eq(anamnesisTemplates.id, id), isNull(anamnesisTemplates.arquivadoEm)))
        .for('update');
      if (!m?.origem) throw new AnamneseError({ geral: MSG_ANAMNESE.modeloNaoEncontrado });
      if (m.aprovadoEm) return;
      await tx.update(anamnesisTemplates).set({ aprovadoEm: agora, aprovadoPor, updatedAt: agora }).where(eq(anamnesisTemplates.id, id));
    },
    deps.db ?? getDb(),
  );
}

/** Cria (`id` nulo) ou altera um modelo ativo. Anamneses já preenchidas não mudam (snapshot). */
export async function salvarModelo(ctx: TenantContext, id: string | null, input: { nome: unknown; perguntas: unknown }, db: Db = getDb()): Promise<string> {
  const v = validarModelo(input);
  if (!v.ok) throw new AnamneseError(v.erros);
  return withTenant(
    ctx,
    async (tx) => {
      if (!id) {
        const [m] = await tx.insert(anamnesisTemplates).values({ tenantId: ctx.tenantId, nome: v.nome, schema: { perguntas: v.perguntas } }).returning({ id: anamnesisTemplates.id });
        return m.id;
      }
      const [m] = idValido(id)
        ? await tx
            .update(anamnesisTemplates)
            .set({ nome: v.nome, schema: { perguntas: v.perguntas }, updatedAt: new Date() })
            .where(and(eq(anamnesisTemplates.id, id), isNull(anamnesisTemplates.arquivadoEm)))
            .returning({ id: anamnesisTemplates.id })
        : [];
      if (!m) throw new AnamneseError({ geral: MSG_ANAMNESE.modeloNaoEncontrado });
      return m.id;
    },
    db,
  );
}

export async function arquivarModelo(ctx: TenantContext, id: string, db: Db = getDb()): Promise<void> {
  if (!idValido(id)) return;
  await withTenant(ctx, (tx) => tx.update(anamnesisTemplates).set({ arquivadoEm: new Date() }).where(eq(anamnesisTemplates.id, id)), db);
}

/** US-012: valida as respostas contra o modelo atual e grava uma cópia dele (snapshot). Nenhum erro = nada salvo. */
export async function preencherAnamnese(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  templateId: string,
  bruto: Record<string, unknown>,
  deps: { db?: Db; now?: Date } = {},
): Promise<string> {
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const [m] = idValido(templateId)
        ? await tx.select().from(anamnesisTemplates).where(and(eq(anamnesisTemplates.id, templateId), isNull(anamnesisTemplates.arquivadoEm)))
        : [];
      if (!m) throw new AnamneseError({ geral: MSG_ANAMNESE.modeloNaoEncontrado });
      if (m.iaGeracaoId && !m.aprovadoEm) throw new AnamneseError({ geral: MSG_MODELO_IA.aprove }); // RN-125
      const v = validarRespostas(m.schema.perguntas, bruto);
      if (!v.ok) throw new AnamneseError(v.erros);
      const [a] = await tx
        .insert(anamneses)
        .values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          templateId: m.id,
          templateSnapshot: { nome: m.nome, perguntas: m.schema.perguntas },
          respostas: v.respostas,
          data: hojeNoFuso(tenant.fuso, now),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: anamneses.id });
      return a.id;
    },
    deps.db ?? getDb(),
  );
}

/** Corrige as respostas de uma anamnese — validadas contra o snapshot dela, nunca contra o modelo atual. */
export async function atualizarAnamnese(ctx: TenantContext, patientId: string, anamneseId: string, bruto: Record<string, unknown>, db: Db = getDb()): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const [a] = idValido(anamneseId) ? await tx.select().from(anamneses).where(and(eq(anamneses.id, anamneseId), eq(anamneses.patientId, patientId))) : [];
      if (!a) throw new AnamneseError({ geral: 'Anamnese não encontrada.' });
      const v = validarRespostas(a.templateSnapshot.perguntas, bruto);
      if (!v.ok) throw new AnamneseError(v.erros);
      await tx.update(anamneses).set({ respostas: v.respostas, updatedAt: new Date() }).where(eq(anamneses.id, a.id));
    },
    db,
  );
}

export async function listarAnamneses(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<{ id: string; data: string; nomeModelo: string }[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(anamneses).where(eq(anamneses.patientId, patientId)).orderBy(desc(anamneses.data), desc(anamneses.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'anamnese', entidadeId: null, patientId });
      return r.map((a) => ({ id: a.id, data: a.data, nomeModelo: a.templateSnapshot.nome }));
    },
    db,
  );
}

/**
 * Só as perguntas do snapshot, para ler o formulário ao salvar uma edição: o modelo não é dado do
 * paciente e não devolve nenhuma resposta, então não soma um "Visualizou" falso no histórico (US-007).
 */
export async function perguntasDaAnamnese(ctx: TenantContext, patientId: string, anamneseId: string, db: Db = getDb()): Promise<Pergunta[] | null> {
  if (!idValido(anamneseId) || !idValido(patientId)) return null;
  const [a] = await withTenant(
    ctx,
    (tx) => tx.select({ snapshot: anamneses.templateSnapshot }).from(anamneses).where(and(eq(anamneses.id, anamneseId), eq(anamneses.patientId, patientId))),
    db,
  );
  return a ? a.snapshot.perguntas : null;
}

export async function buscarAnamnese(ctx: TenantContext, patientId: string, anamneseId: string, db: Db = getDb()): Promise<AnamneseRow | null> {
  if (!idValido(anamneseId) || !idValido(patientId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [a] = await tx.select().from(anamneses).where(and(eq(anamneses.id, anamneseId), eq(anamneses.patientId, patientId)));
      if (!a) return null;
      await auditRead(tx, { entidade: 'anamnese', entidadeId: a.id, patientId });
      return a;
    },
    db,
  );
}
