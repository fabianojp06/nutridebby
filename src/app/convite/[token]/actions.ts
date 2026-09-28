'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { aceitarConvite, ConviteError } from '@/modules/plataforma/convites';

export type AceiteState = { erro?: string };

export async function aceitarConviteAction(token: string, _prev: AceiteState, formData: FormData): Promise<AceiteState> {
  const senha = String(formData.get('senha') ?? '');
  let email: string;
  try {
    ({ email } = await aceitarConvite({
      token,
      senha,
      confirmacao: String(formData.get('confirmacao') ?? ''),
      aceitouDpa: formData.get('dpa') === 'on',
      ip: await requestIp(),
    }));
  } catch (e) {
    if (e instanceof ConviteError) return { erro: e.message };
    throw e;
  }
  let entrou = true;
  try {
    // nextCookies grava o cookie de sessão na resposta desta Server Action
    await getAuth().api.signInEmail({ body: { email, password: senha }, headers: await headers() });
  } catch {
    entrou = false;
  }
  redirect(entrou ? '/painel' : '/entrar?volta=%2Fpainel');
}
