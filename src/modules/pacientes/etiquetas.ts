import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients, patientTagLinks, patientTags } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido } from './base';

export const MSG_ETIQUETA = { nome: 'Use de 1 a 40 caracteres na etiqueta' } as const;

export class EtiquetaError extends Error {
  override name = 'EtiquetaError';
}

export type Etiqueta = { id: string; nome: string };

export async function listarEtiquetas(ctx: TenantContext, db: Db = getDb()): Promise<(Etiqueta & { pacientes: number })[]> {
  return withTenant(
    ctx,
    (tx) =>
      tx
        // conta só pacientes ativos: o mesmo universo da lista padrão, para o "(3)" do seletor bater com a lista
        .select({ id: patientTags.id, nome: patientTags.nome, pacientes: count(patients.id) })
        .from(patientTags)
        .leftJoin(patientTagLinks, eq(patientTagLinks.tagId, patientTags.id))
        .leftJoin(patients, and(eq(patients.id, patientTagLinks.patientId), eq(patients.status, 'ativo')))
        .groupBy(patientTags.id)
        .orderBy(asc(patientTags.nome)),
    db,
  );
}

/** Etiquetas do paciente (dado de saúde: "diabetes", "gestante") — leitura auditada. Paciente nunca vê (staff_only). */
export async function etiquetasDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Etiqueta[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: patientTags.id, nome: patientTags.nome })
        .from(patientTagLinks)
        .innerJoin(patientTags, eq(patientTags.id, patientTagLinks.tagId))
        .where(eq(patientTagLinks.patientId, patientId))
        .orderBy(asc(patientTags.nome));
      if (r.length) await auditRead(tx, { entidade: 'etiquetas', entidadeId: null, patientId });
      return r;
    },
    db,
  );
}

/**
 * Deixa o paciente com exatamente `etiquetas` (+ a `nova`, criada se não existir — sem diferenciar
 * maiúsculas). Id de etiqueta de outro tenant ou malformado é ignorado: só vale o que a RLS mostra.
 */
export async function salvarEtiquetasDoPaciente(
  ctx: TenantContext,
  patientId: string,
  input: { etiquetas: string[]; nova?: string },
  db: Db = getDb(),
): Promise<void> {
  const nova = normalizarTexto(input.nova);
  if (nova.length > 40) throw new EtiquetaError(MSG_ETIQUETA.nome);
  await withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const pedidas = input.etiquetas.filter(idValido);
      const validas = pedidas.length
        ? (await tx.select({ id: patientTags.id }).from(patientTags).where(inArray(patientTags.id, pedidas))).map((e) => e.id)
        : [];
      const alvo = new Set(validas);
      if (nova) {
        await tx.insert(patientTags).values({ tenantId: ctx.tenantId, nome: nova }).onConflictDoNothing();
        const [e] = await tx.select({ id: patientTags.id }).from(patientTags).where(eq(patientTags.nome, nova));
        alvo.add(e.id);
      }
      const atuais = (await tx.select({ tagId: patientTagLinks.tagId }).from(patientTagLinks).where(eq(patientTagLinks.patientId, patientId))).map((l) => l.tagId);
      const remover = atuais.filter((id) => !alvo.has(id));
      const incluir = [...alvo].filter((id) => !atuais.includes(id));
      if (remover.length) await tx.delete(patientTagLinks).where(and(eq(patientTagLinks.patientId, patientId), inArray(patientTagLinks.tagId, remover)));
      if (incluir.length) {
        await tx
          .insert(patientTagLinks)
          .values(incluir.map((tagId) => ({ tenantId: ctx.tenantId, patientId, tagId })))
          .onConflictDoNothing();
      }
    },
    db,
  );
}
