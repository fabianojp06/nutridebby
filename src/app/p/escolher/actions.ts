'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { COOKIE_VINCULO, ESCOLHER_PATH } from '@/lib/paciente-session';
import { safeReturnPath } from '@/lib/safe-return';
import { requireUser } from '@/lib/session';
import { vinculosDaConta } from '@/modules/portal/vinculos';

/** D3: grava o vínculo escolhido — só se for mesmo um vínculo ativo da conta (o tenantId do formulário não é confiável). */
export async function escolherAction(tenantId: string, volta: string): Promise<void> {
  const { user } = await requireUser(['paciente'], ESCOLHER_PATH);
  const v = (await vinculosDaConta(user.id)).find((x) => x.tenantId === tenantId);
  if (!v) redirect(ESCOLHER_PATH);
  (await cookies()).set(COOKIE_VINCULO, v.tenantId, {
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().APP_URL.startsWith('https://'),
  });
  // só de volta para uma página do portal (e nunca para a própria escolha)
  const destino = safeReturnPath(volta);
  redirect(destino?.startsWith('/p/') && !destino.startsWith(ESCOLHER_PATH) ? destino : '/p/inicio');
}
