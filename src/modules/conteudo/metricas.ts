import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { contents, contentViews, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arredondar } from '@/lib/numero';
import { idValido } from '@/modules/pacientes/base';
import { naAudiencia, naAudienciaDaLinha } from './audiencia';
import type { Visibilidade } from './constantes';

export type Metrica = { vistos: number; audiencia: number };

/** US-056: "18 de 40 pacientes (45%)" — porcentagem inteira (meio para cima); "1 de 1 paciente" no singular. */
export function textoDaMetrica(m: Metrica): string {
  const pct = m.audiencia ? arredondar((m.vistos / m.audiencia) * 100, 0) : 0;
  return `${m.vistos} de ${m.audiencia} ${m.audiencia === 1 ? 'paciente' : 'pacientes'} (${pct}%)`;
}

/**
 * D14: a audiência ATUAL (RN-12: pacientes ativos, com ou sem conta no portal) e quantos deles já abriram — quem saiu
 * da audiência (arquivado, etiqueta tirada) não conta em nenhum dos dois; quem abriu pelo cartão do plano, fora da
 * audiência, também não. UMA consulta agrupada por conteúdo para a lista inteira (até 200 a cada render de
 * /painel/conteudos): conteúdo × pacientes da audiência (left join — sem ninguém, 0 de 0) × visualizações deles; a
 * visibilidade vem da própria linha. Id de outro consultório: a RLS esconde e ele fica fora do mapa.
 */
export async function metricasDosConteudos(ctx: TenantContext, conteudos: { id: string }[], db: Db = getDb()): Promise<Map<string, Metrica>> {
  const ids = [...new Set(conteudos.map((c) => c.id).filter(idValido))];
  if (!ids.length) return new Map();
  const rs = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: contents.id, audiencia: sql<number>`count(${patients.id})::int`, vistos: sql<number>`count(${contentViews.id})::int` })
        .from(contents)
        .leftJoin(patients, and(eq(patients.tenantId, contents.tenantId), naAudienciaDaLinha(contents.id, contents.visibilidade)))
        .leftJoin(contentViews, and(eq(contentViews.tenantId, patients.tenantId), eq(contentViews.contentId, contents.id), eq(contentViews.patientId, patients.id)))
        .where(inArray(contents.id, ids))
        .groupBy(contents.id),
    db,
  );
  return new Map(rs.map((r) => [r.id, { vistos: r.vistos, audiencia: r.audiencia }]));
}

/** "Posso ver a lista de nomes de quem viu" — os da audiência atual, mais recentes primeiro. Sem auditoria (D6). */
export async function quemViu(ctx: TenantContext, contentId: string, db: Db = getDb()): Promise<{ titulo: string; pessoas: { nome: string; vistoEm: Date }[] } | null> {
  if (!idValido(contentId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ titulo: contents.titulo, visibilidade: contents.visibilidade }).from(contents).where(eq(contents.id, contentId));
      if (!c) return null;
      const pessoas = await tx
        .select({ nome: patients.nome, vistoEm: contentViews.vistoEm })
        .from(contentViews)
        .innerJoin(patients, and(eq(patients.tenantId, contentViews.tenantId), eq(patients.id, contentViews.patientId)))
        .where(and(eq(contentViews.contentId, contentId), naAudiencia(contentId, c.visibilidade as Visibilidade)))
        .orderBy(desc(contentViews.vistoEm));
      return { titulo: c.titulo, pessoas };
    },
    db,
  );
}
