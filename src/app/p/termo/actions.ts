'use server';
import { redirect } from 'next/navigation';
import { requirePaciente, TERMO_PATH } from '@/lib/paciente-session';
import { MSG_TERMO_NAO_ACEITO } from '@/modules/pacientes/termo-paciente';
import { aceitarTermo } from '@/modules/portal/termo';

/** US-011 "Nova versão do termo": aceite da versão atual no consultório do vínculo escolhido. */
export async function aceitarTermoAction(_: { erro?: string }, formData: FormData): Promise<{ erro?: string }> {
  const { data, tenant, ctx } = await requirePaciente(TERMO_PATH, { permitirTermoPendente: true });
  if (formData.get('aceite') !== 'on') return { erro: MSG_TERMO_NAO_ACEITO };
  await aceitarTermo({ userId: data.user.id, tenantId: tenant.id, ip: ctx.ip ?? null });
  redirect('/p/inicio');
}
