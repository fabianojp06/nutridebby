import { asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients, tenants } from '@/db/schema';
import { withConta } from '@/db/tenant';

export type Vinculo = { tenantId: string; patientId: string; nomeNutri: string; tenantStatus: 'ativa' | 'suspensa' };
export type VinculoQualquer = Vinculo & { pacienteStatus: 'ativo' | 'arquivado' | 'bloqueado'; anonimizado: boolean };

/**
 * D2 / §3: os vínculos (consultório, prontuário) da conta de paciente. Sem `todos`, só os que dão acesso ao portal
 * (RN-08: arquivado, bloqueado e anonimizado ficam de fora). Contexto `conta`: só patients da própria conta.
 * `tenants` não tem RLS (nome e status do consultório).
 */
export async function vinculosDaConta(userId: string, o?: { db?: Db; todos?: false }): Promise<Vinculo[]>;
export async function vinculosDaConta(userId: string, o: { db?: Db; todos: true }): Promise<VinculoQualquer[]>;
export async function vinculosDaConta(userId: string, o: { db?: Db; todos?: boolean } = {}): Promise<Vinculo[] | VinculoQualquer[]> {
  const linhas = await withConta(
    userId,
    (tx) =>
      tx
        .select({
          tenantId: patients.tenantId,
          patientId: patients.id,
          pacienteStatus: patients.status,
          anonimizadoEm: patients.anonimizadoEm,
          nomeNutri: tenants.nomeExibicao,
          tenantStatus: tenants.status,
        })
        .from(patients)
        .innerJoin(tenants, eq(tenants.id, patients.tenantId))
        .where(eq(patients.userId, userId))
        .orderBy(asc(tenants.nomeExibicao), asc(tenants.id)),
    o.db ?? getDb(),
  );
  const todos = linhas.map((l) => ({
    tenantId: l.tenantId,
    patientId: l.patientId,
    nomeNutri: l.nomeNutri,
    tenantStatus: l.tenantStatus as Vinculo['tenantStatus'],
    pacienteStatus: l.pacienteStatus as VinculoQualquer['pacienteStatus'],
    anonimizado: l.anonimizadoEm !== null,
  }));
  if (o.todos) return todos;
  return todos
    .filter((v) => v.pacienteStatus === 'ativo' && !v.anonimizado)
    .map(({ tenantId, patientId, nomeNutri, tenantStatus }) => ({ tenantId, patientId, nomeNutri, tenantStatus }));
}

/**
 * D3 + RN-15: com 1 vínculo entra direto; com 2+ vale o do cookie, só se ainda for vínculo (cookie velho ou forjado →
 * escolher). Consultório suspenso barra só aquele vínculo: sem nenhum ativo → `suspensa`; cookie no suspenso com outro
 * ativo → escolher (o suspenso aparece desabilitado na escolha).
 */
export function escolherVinculo(
  vinculos: Vinculo[],
  cookie: string | undefined,
): { tipo: 'ok'; vinculo: Vinculo } | { tipo: 'escolher' } | { tipo: 'sem_acesso' } | { tipo: 'suspensa' } {
  if (!vinculos.length) return { tipo: 'sem_acesso' };
  const ativos = vinculos.filter((v) => v.tenantStatus === 'ativa');
  if (!ativos.length) return { tipo: 'suspensa' };
  if (vinculos.length === 1) return { tipo: 'ok', vinculo: vinculos[0] };
  const doCookie = ativos.find((v) => v.tenantId === cookie);
  return doCookie ? { tipo: 'ok', vinculo: doCookie } : { tipo: 'escolher' };
}
