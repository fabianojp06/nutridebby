'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_VINCULO, cookieVinculoSeguro, ESCOLHER_PATH, OPCOES_COOKIE_VINCULO, voltaDoPortal } from '@/lib/paciente-session';
import { requireUser } from '@/lib/session';
import { vinculosDaConta } from '@/modules/portal/vinculos';

/**
 * D3: grava o vínculo escolhido — só se for mesmo um vínculo ativo da conta (o tenantId do formulário não é confiável)
 * e o consultório não estiver suspenso (RN-15).
 */
export async function escolherAction(tenantId: string, volta: string): Promise<void> {
  const { user } = await requireUser(['paciente'], ESCOLHER_PATH);
  const v = (await vinculosDaConta(user.id)).find((x) => x.tenantId === tenantId);
  if (!v || v.tenantStatus !== 'ativa') redirect(ESCOLHER_PATH);
  (await cookies()).set(COOKIE_VINCULO, v.tenantId, { ...OPCOES_COOKIE_VINCULO, secure: cookieVinculoSeguro() });
  // só de volta para uma página do portal (nunca para a própria escolha), sem o `?v=` de um link (venceria esta escolha)
  redirect(voltaDoPortal(volta));
}
