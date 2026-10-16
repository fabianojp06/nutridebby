'use server';
import { redirect } from 'next/navigation';
import { requirePaciente, TERMO_PATH, voltaDoTermo } from '@/lib/paciente-session';
import { MSG_TERMO_NAO_ACEITO, TERMO_PACIENTE_VERSAO } from '@/modules/pacientes/termo-paciente';
import { leuAVersaoEmVigor, MSG_TEXTO_ATUALIZADO } from '@/modules/plataforma/textos-versionados';
import { aceitarTermo } from '@/modules/portal/termo';

/**
 * US-011 "Nova versão do termo": aceite da versão atual no consultório do vínculo escolhido; depois, o destino que levou
 * ao termo (campo `volta`, S-1: só página do portal, sem o `?v=`), ou o Início.
 */
export async function aceitarTermoAction(_: { erro?: string }, formData: FormData): Promise<{ erro?: string }> {
  const { data, tenant, ctx } = await requirePaciente(TERMO_PATH, { permitirTermoPendente: true });
  if (formData.get('aceite') !== 'on') return { erro: MSG_TERMO_NAO_ACEITO };
  if (!leuAVersaoEmVigor(formData, TERMO_PACIENTE_VERSAO)) return { erro: MSG_TEXTO_ATUALIZADO };
  await aceitarTermo({ userId: data.user.id, tenantId: tenant.id, ip: ctx.ip ?? null });
  const volta = formData.get('volta');
  redirect(voltaDoTermo(typeof volta === 'string' ? volta : null));
}
