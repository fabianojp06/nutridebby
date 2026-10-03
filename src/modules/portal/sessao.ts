import type { TenantContext } from '@/db/tenant';

/** O paciente da sessão: o `patientId` do contexto, ou erro se não for sessão de paciente (`quem` = a função que pede). */
export function pacienteDaSessao(ctx: TenantContext, quem: string): string {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error(`${quem} só roda em sessão de paciente`);
  return ctx.patientId;
}
