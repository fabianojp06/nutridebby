import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import {
  anamneses,
  anamnesisTemplates,
  type AnamneseRow,
  type AnamnesisTemplateRow,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
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

export type ModeloResumo = { id: string; nome: string; padrao: boolean; perguntas: number };

/** Cria o "Anamnese geral" se o tenant nunca teve um padrão. Corrida: o índice único parcial decide. */
export async function garantirModeloPadrao(tx: Tx, tenantId: string): Promise<void> {
  const m = modeloPadrao();
  await tx
    .insert(anamnesisTemplates)
    .values({ tenantId, nome: m.nome, schema: m.schema, padrao: true })
    .onConflictDoNothing();
}

export async function listarModelos(ctx: TenantContext, db: Db = getDb()): Promise<ModeloResumo[]> {
  return withTenant(
    ctx,
    async (tx) => {
      await garantirModeloPadrao(tx, ctx.tenantId);
      const r = await tx
        .select()
        .from(anamnesisTemplates)
        .where(isNull(anamnesisTemplates.arquivadoEm))
        .orderBy(desc(anamnesisTemplates.padrao), asc(anamnesisTemplates.nome));
      return r.map((m) => ({
        id: m.id,
        nome: m.nome,
        padrao: m.padrao,
        perguntas: m.schema.perguntas.length,
      }));
    },
    db,
  );
}

export async function buscarModelo(
  ctx: TenantContext,
  id: string,
  db: Db = getDb(),
): Promise<AnamnesisTemplateRow | null> {
  if (!idValido(id)) return null;
  const [m] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select()
        .from(anamnesisTemplates)
        .where(and(eq(anamnesisTemplates.id, id), isNull(anamnesisTemplates.arquivadoEm))),
    db,
  );
  return m ?? null;
}

/** Cria (`id` nulo) ou altera um modelo ativo. Anamneses já preenchidas não mudam (snapshot). */
export async function salvarModelo(
  ctx: TenantContext,
  id: string | null,
  input: { nome: unknown; perguntas: unknown },
  db: Db = getDb(),
): Promise<string> {
  const v = validarModelo(input);
  if (!v.ok) throw new AnamneseError(v.erros);
  return withTenant(
    ctx,
    async (tx) => {
      if (!id) {
        const [m] = await tx
          .insert(anamnesisTemplates)
          .values({ tenantId: ctx.tenantId, nome: v.nome, schema: { perguntas: v.perguntas } })
          .returning({ id: anamnesisTemplates.id });
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

export async function arquivarModelo(
  ctx: TenantContext,
  id: string,
  db: Db = getDb(),
): Promise<void> {
  if (!idValido(id)) return;
  await withTenant(
    ctx,
    (tx) =>
      tx
        .update(anamnesisTemplates)
        .set({ arquivadoEm: new Date() })
        .where(eq(anamnesisTemplates.id, id)),
    db,
  );
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
        ? await tx
            .select()
            .from(anamnesisTemplates)
            .where(
              and(eq(anamnesisTemplates.id, templateId), isNull(anamnesisTemplates.arquivadoEm)),
            )
        : [];
      if (!m) throw new AnamneseError({ geral: MSG_ANAMNESE.modeloNaoEncontrado });
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
export async function atualizarAnamnese(
  ctx: TenantContext,
  patientId: string,
  anamneseId: string,
  bruto: Record<string, unknown>,
  db: Db = getDb(),
): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const [a] = idValido(anamneseId)
        ? await tx
            .select()
            .from(anamneses)
            .where(and(eq(anamneses.id, anamneseId), eq(anamneses.patientId, patientId)))
        : [];
      if (!a) throw new AnamneseError({ geral: 'Anamnese não encontrada.' });
      const v = validarRespostas(a.templateSnapshot.perguntas, bruto);
      if (!v.ok) throw new AnamneseError(v.erros);
      await tx
        .update(anamneses)
        .set({ respostas: v.respostas, updatedAt: new Date() })
        .where(eq(anamneses.id, a.id));
    },
    db,
  );
}

export async function listarAnamneses(
  ctx: TenantContext,
  patientId: string,
  db: Db = getDb(),
): Promise<{ id: string; data: string; nomeModelo: string }[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select()
        .from(anamneses)
        .where(eq(anamneses.patientId, patientId))
        .orderBy(desc(anamneses.data), desc(anamneses.createdAt));
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
export async function perguntasDaAnamnese(
  ctx: TenantContext,
  patientId: string,
  anamneseId: string,
  db: Db = getDb(),
): Promise<Pergunta[] | null> {
  if (!idValido(anamneseId) || !idValido(patientId)) return null;
  const [a] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ snapshot: anamneses.templateSnapshot })
        .from(anamneses)
        .where(and(eq(anamneses.id, anamneseId), eq(anamneses.patientId, patientId))),
    db,
  );
  return a ? a.snapshot.perguntas : null;
}

export async function buscarAnamnese(
  ctx: TenantContext,
  patientId: string,
  anamneseId: string,
  db: Db = getDb(),
): Promise<AnamneseRow | null> {
  if (!idValido(anamneseId) || !idValido(patientId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [a] = await tx
        .select()
        .from(anamneses)
        .where(and(eq(anamneses.id, anamneseId), eq(anamneses.patientId, patientId)));
      if (!a) return null;
      await auditRead(tx, { entidade: 'anamnese', entidadeId: a.id, patientId });
      return a;
    },
    db,
  );
}
