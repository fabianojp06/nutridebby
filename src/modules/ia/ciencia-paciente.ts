import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients, tenants, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { primeiroNome } from '@/modules/notificacoes/mensagens';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import { cancelarTarefas } from './cancelar';
import type { MotivoFalha } from './constantes';
import { AVISO_IA_VERSAO, AVISO_IA_VERSAO_MIN, versaoAtende } from './textos-legais';

/** US-104 (A-D19 = (a)). O canal `portal` fica reservado (spec §5.3): ainda não conta como ciência. */
export type SituacaoCiencia =
  | { tipo: 'informado'; versao: string; em: Date; canal: 'email' | 'em_maos' }
  | { tipo: 'aguardando_email'; enviadoEm: Date }
  | { tipo: 'nao_informado' };

type CamposCiencia = Pick<PatientRow, 'iaAvisoVersao' | 'iaAvisoEm' | 'iaAvisoCanal' | 'iaAvisoEnviadoEm'>;

export function situacaoDaCiencia(p: CamposCiencia): SituacaoCiencia {
  const canal = p.iaAvisoCanal;
  if (p.iaAvisoVersao && p.iaAvisoEm && (canal === 'email' || canal === 'em_maos') && versaoAtende(p.iaAvisoVersao, AVISO_IA_VERSAO_MIN)) {
    return { tipo: 'informado', versao: p.iaAvisoVersao, em: p.iaAvisoEm, canal };
  }
  if (p.iaAvisoEnviadoEm) return { tipo: 'aguardando_email', enviadoEm: p.iaAvisoEnviadoEm };
  return { tipo: 'nao_informado' };
}

/** RN-100 (parte do paciente): ativo, sem recusa e informado. No app e de novo no worker. */
export function motivoDoPaciente(p: CamposCiencia & Pick<PatientRow, 'status' | 'anonimizadoEm' | 'iaRecusadaEm'>): MotivoFalha | null {
  if (p.status !== 'ativo' || p.anonimizadoEm || p.iaRecusadaEm) return 'paciente_indisponivel';
  if (situacaoDaCiencia(p).tipo !== 'informado') return 'paciente_nao_informado';
  return null;
}

type Deps = { db?: Db; agora?: Date };

/** US-104 "Entrega em mãos": a nutricionista confirma "Entreguei o aviso ao paciente". */
export async function registrarEntregaEmMaos(ctx: TenantContext, patientId: string, deps: Deps = {}): Promise<void> {
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      await tx.update(patients).set({ iaAvisoVersao: AVISO_IA_VERSAO, iaAvisoEm: agora, iaAvisoCanal: 'em_maos', iaAvisoEnviadoEm: null, updatedAt: agora }).where(eq(patients.id, p.id));
    },
    deps.db ?? getDb(),
  );
}

/** US-104 "Enviar por e-mail" (D5): enfileira o aviso na mesma transação da marca "aguardando a entrega". */
export async function enviarAvisoPorEmail(ctx: TenantContext, tenant: { nomeExibicao: string }, patientId: string, deps: Deps = {}): Promise<void> {
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      await tx.update(patients).set({ iaAvisoEnviadoEm: agora, updatedAt: agora }).where(eq(patients.id, p.id));
      await enqueueEmail({ tipo: 'aviso_ia', para: p.email, nome: primeiroNome(p.nome), consultorio: tenant.nomeExibicao, versao: AVISO_IA_VERSAO, patientId: p.id }, { tenantId: ctx.tenantId, tx });
    },
    deps.db ?? getDb(),
  );
}

/**
 * D5: chamada pelo worker DEPOIS de o provedor de e-mail aceitar o aviso (`aposEnviar` do job `email`). Ator nulo (aparece
 * como "Sistema"). Só grava se o envio ainda estava pendente, se o paciente ainda tem o e-mail para onde o aviso foi (a
 * nutricionista pode tê-lo trocado entre o enfileiramento e o envio) e se ele não está bloqueado nem anonimizado.
 * Idempotente: uma nova tentativa do job não regrava.
 */
export async function registrarCienciaPorEmail(db: Db, tenantId: string, patientId: string, versao: string, para: string, agora: Date): Promise<boolean> {
  const r = await withTenant(
    { tenantId, role: 'worker' },
    (tx) =>
      tx
        .update(patients)
        .set({ iaAvisoVersao: versao, iaAvisoEm: agora, iaAvisoCanal: 'email', iaAvisoEnviadoEm: null, updatedAt: agora })
        .where(and(eq(patients.id, patientId), eq(patients.email, para), isNotNull(patients.iaAvisoEnviadoEm), ne(patients.status, 'bloqueado'), isNull(patients.anonimizadoEm)))
        .returning({ id: patients.id }),
    db,
  );
  return r.length > 0;
}

/**
 * US-103: marcar ou desfazer "Não usar IA"; marcar cancela a fila e as sugestões do paciente. Ordem de travas da cota
 * (cota.ts): paciente → tenant → tarefas → ia_uso → plataforma — o tenant é travado antes de `cancelarTarefas`, como
 * o contrato dela pede.
 */
export async function definirRecusaIa(ctx: TenantContext, patientId: string, recusar: boolean, deps: Deps = {}): Promise<void> {
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      await tx.update(patients).set({ iaRecusadaEm: recusar ? agora : null, updatedAt: agora }).where(eq(patients.id, p.id));
      if (recusar) {
        await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for('update');
        await cancelarTarefas(tx, { patientId: p.id, agora, por: ctx.actorUserId ?? null });
      }
    },
    deps.db ?? getDb(),
  );
}
