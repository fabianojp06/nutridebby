import { and, asc, eq, inArray, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contentAudience, patients, patientTagLinks, patientTags } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import type { Visibilidade } from './constantes';

export type AudienciaEnviada = { visibilidade: Visibilidade; pacientes: string[]; etiquetas: string[] };
export type OpcoesDeAudiencia = { etiquetas: { id: string; nome: string }[]; pacientes: { id: string; nome: string }[] };

/** Teto da lista de pacientes no formulário (ordem alfabética). */
export const PACIENTES_NA_LISTA = 500;

type Conteudo = string | AnyColumn | SQL;
const ativo = () => sql`${patients.status} = 'ativo' and ${patients.anonimizadoEm} is null`;
const porPaciente = (contentId: Conteudo) => sql`exists (select 1 from ${contentAudience} a
      where a.tenant_id = ${patients.tenantId} and a.content_id = ${contentId} and a.patient_id = ${patients.id})`;
const porEtiqueta = (contentId: Conteudo) => sql`exists (select 1 from ${contentAudience} a
      join ${patientTagLinks} l on l.tenant_id = a.tenant_id and l.tag_id = a.tag_id
      where a.tenant_id = ${patients.tenantId} and a.content_id = ${contentId} and l.patient_id = ${patients.id})`;

/**
 * RN-12 fora da sessão de paciente (aviso de conteúdo novo, métricas): condição SQL sobre `patients` — ativo, não
 * anonimizado e na audiência do conteúdo. A sessão de paciente NÃO usa isto: lá a RLS decide (0083).
 */
export function naAudiencia(contentId: string, visibilidade: Visibilidade): SQL {
  if (visibilidade === 'todos') return ativo();
  return sql`${ativo()} and ${visibilidade === 'pacientes' ? porPaciente(contentId) : porEtiqueta(contentId)}`;
}

/** A mesma condição com o conteúdo vindo da linha da consulta (id e visibilidade lidos do banco): métricas agrupadas (T11). */
export function naAudienciaDaLinha(contentId: AnyColumn | SQL, visibilidade: AnyColumn | SQL): SQL {
  return sql`${ativo()} and (${visibilidade} = 'todos'
      or (${visibilidade} = 'pacientes' and ${porPaciente(contentId)})
      or (${visibilidade} = 'etiquetas' and ${porEtiqueta(contentId)}))`;
}

/**
 * RN-12, exceção (US-054): libera, SÓ nesta transação (set_config local), a leitura das receitas sugeridas no plano
 * publicado do próprio paciente (política paciente_conteudo_visivel, 0083). Só "Meu plano" (`planoDoPaciente`,
 * src/modules/portal/plano.ts) e a receita aberta pelo cartão (`conteudoDoPaciente(…, { doPlano: true })`) chamam —
 * nunca o feed, a busca, os favoritos ou o registro de visualização (guarda em src/modules/portal/conteudos.test.ts).
 */
export const liberarReceitasDoPlano = (tx: Tx) => tx.execute(sql`select set_config('app.receitas_do_plano', 'on', true)`);

/** Os pacientes que o formulário mostra: ativos, não anonimizados, os PACIENTES_NA_LISTA primeiros por nome. */
const pacientesDoFormulario = (tx: Tx) =>
  tx
    .select({ id: patients.id, nome: patients.nome })
    .from(patients)
    .where(and(eq(patients.status, 'ativo'), isNull(patients.anonimizadoEm)))
    .orderBy(asc(patients.nome), asc(patients.id))
    .limit(PACIENTES_NA_LISTA);

/**
 * Deixa o conteúdo com estes alvos (só os da visibilidade escolhida: "todos" limpa tudo). Vale só o que a RLS mostra
 * (paciente/etiqueta de outro tenant some) e paciente ativo, não anonimizado. D15: só sai o paciente que o formulário
 * MOSTROU e a nutricionista desmarcou — alvo arquivado, ou além dos PACIENTES_NA_LISTA, não aparece no formulário e
 * fica (desarquivado, volta à audiência). Trocar a visibilidade é escolha explícita e limpa os alvos do tipo anterior.
 * Grava só a diferença: o gatilho de auditoria (entidade `conteudos`, D6) registra o que mudou. Chamar com o conteúdo
 * travado. Devolve os alvos pedidos que valeram (para "Escolha pelo menos uma etiqueta ou um paciente.").
 */
export async function gravarAudiencia(tx: Tx, tenantId: string, contentId: string, a: AudienciaEnviada): Promise<{ pacientes: string[]; etiquetas: string[] }> {
  const pedidos = (ids: string[]) => [...new Set(ids.filter(idValido))];
  const pedP = a.visibilidade === 'pacientes' ? pedidos(a.pacientes) : [];
  const pedE = a.visibilidade === 'etiquetas' ? pedidos(a.etiquetas) : [];
  const pacientes = pedP.length
    ? (await tx.select({ id: patients.id }).from(patients).where(and(inArray(patients.id, pedP), eq(patients.status, 'ativo'), isNull(patients.anonimizadoEm)))).map((r) => r.id)
    : [];
  const etiquetas = pedE.length ? (await tx.select({ id: patientTags.id }).from(patientTags).where(inArray(patientTags.id, pedE))).map((r) => r.id) : [];
  const atuais = await tx.select().from(contentAudience).where(eq(contentAudience.contentId, contentId));
  const exibidos =
    a.visibilidade === 'pacientes' && atuais.some((r) => r.patientId) ? new Set((await pacientesDoFormulario(tx)).map((p) => p.id)) : new Set<string>();
  const sair = atuais
    .filter((r) =>
      r.patientId
        ? a.visibilidade !== 'pacientes' || (exibidos.has(r.patientId) && !pacientes.includes(r.patientId))
        : !etiquetas.includes(r.tagId!),
    )
    .map((r) => r.id);
  if (sair.length) await tx.delete(contentAudience).where(inArray(contentAudience.id, sair));
  const temP = new Set(atuais.map((r) => r.patientId));
  const temE = new Set(atuais.map((r) => r.tagId));
  const novos = [
    ...pacientes.filter((id) => !temP.has(id)).map((patientId) => ({ tenantId, contentId, patientId })),
    ...etiquetas.filter((id) => !temE.has(id)).map((tagId) => ({ tenantId, contentId, tagId })),
  ];
  if (novos.length) await tx.insert(contentAudience).values(novos);
  return { pacientes: pedP.filter((id) => pacientes.includes(id)), etiquetas: pedE.filter((id) => etiquetas.includes(id)) };
}

export async function lerAudiencia(tx: Tx, contentId: string): Promise<{ pacientes: string[]; etiquetas: string[] }> {
  const rs = await tx.select({ patientId: contentAudience.patientId, tagId: contentAudience.tagId }).from(contentAudience).where(eq(contentAudience.contentId, contentId)).orderBy(asc(contentAudience.createdAt));
  return { pacientes: rs.flatMap((r) => (r.patientId ? [r.patientId] : [])), etiquetas: rs.flatMap((r) => (r.tagId ? [r.tagId] : [])) };
}

/** O que o formulário oferece: as etiquetas do tenant e os pacientes ativos (nome, sem auditoria — como a lista de pacientes, D6). */
export async function opcoesDeAudiencia(ctx: TenantContext, db: Db = getDb()): Promise<OpcoesDeAudiencia> {
  return withTenant(
    ctx,
    async (tx) => ({
      etiquetas: await tx.select({ id: patientTags.id, nome: patientTags.nome }).from(patientTags).orderBy(asc(patientTags.nome)),
      // a MESMA lista que gravarAudiencia usa para decidir o que pode sair (D15)
      pacientes: await pacientesDoFormulario(tx),
    }),
    db,
  );
}
