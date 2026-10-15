import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { iaNutriConsentimentos, iaNutriMensagens, iaNutriParticipacoes, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { iaPronta } from './ia';

/**
 * Consultório com a IA ativa no aditivo 1.2, a IA Nutri ativada e o perfil profissional completo (o texto do consentimento
 * cita a responsável: sem nome, CRN e contato, a entrada não aparece — responsavelDoTenant). A pausa é da plataforma (abaixo).
 */
export async function iaNutriPronta(db: Db, tenantId: string, o: { cotaUsd?: number } = {}): Promise<void> {
  await iaPronta(db, tenantId, { aditivo: '1.2' });
  await db
    .update(tenants)
    .set({ iaNutriAtivadaEm: new Date(), iaNutriCotaMensalUsd: o.cotaUsd ?? 7, nomeProfissional: 'Debby Silva', crn: 'CRN-3 12345', contatoEmail: 'debby@consultorio.test' })
    .where(eq(tenants.id, tenantId));
}
/**
 * A pausa é UMA linha para o banco inteiro, e os arquivos de teste rodam em paralelo no mesmo banco: nenhum teste do banco
 * comum muda a linha, que nasce NÃO pausada (DP-1, ★ DO-1 = não). O comportamento "pausada" (emergência) é testado pela
 * injeção `deps.pausa` (T7–T9); "Pausar"/"Retomar" de verdade, no cluster próprio de `ia-nutri-pausa.test.ts` (T5).
 */
export const PAUSADA = { pausadaEm: new Date('2026-10-14T12:00:00Z') } as const;
export const SEM_PAUSA = { pausadaEm: null } as const;

export async function liberarNoBanco(db: Db, ctx: TenantContext, patientId: string): Promise<void> {
  await withTenant(ctx, (tx) => tx.insert(iaNutriParticipacoes).values({ tenantId: ctx.tenantId, patientId, liberadaEm: new Date(), liberadaPor: ctx.actorUserId! }), db);
}
/** O aceite pela sessão do próprio paciente (o gatilho recusa os outros papéis). */
export async function aceiteNoBanco(db: Db, ctxPaciente: TenantContext, o: { versao?: string; destino?: string } = {}): Promise<void> {
  await withTenant(
    ctxPaciente,
    (tx) => tx.insert(iaNutriConsentimentos).values({ tenantId: ctxPaciente.tenantId, patientId: ctxPaciente.patientId!, evento: 'aceite', versao: o.versao ?? '1.0', destino: o.destino ?? 'teste', canal: 'app', registradoPor: ctxPaciente.actorUserId! }),
    db,
  );
}
/** Mensagem gravada pelo worker (os testes do job e da fila partem daqui). */
export async function mensagemNoBanco(db: Db, tenantId: string, patientId: string, o: Partial<typeof iaNutriMensagens.$inferInsert> = {}): Promise<string> {
  const agora = new Date();
  const [m] = await withTenant(
    { tenantId, role: 'worker' },
    (tx) => tx.insert(iaNutriMensagens).values({ tenantId, patientId, sessaoInicio: agora, autor: 'paciente', texto: 'Quanto de arroz no almoço?', status: 'na_fila', contouNoLimite: true, expiraEm: new Date(agora.getTime() + 180 * 86_400_000), ...o }).returning({ id: iaNutriMensagens.id }),
    db,
  );
  return m.id;
}
