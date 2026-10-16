'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { APIError } from 'better-auth/api';
import { getAuth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { SUSPENDED_PATH } from '@/lib/session-rules';
import { aceitarConvite, ConviteError } from '@/modules/plataforma/convites';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { leuAVersaoEmVigor, MSG_TEXTO_ATUALIZADO } from '@/modules/plataforma/textos-versionados';

export type AceiteState = { erro?: string; campo?: 'senha' | 'confirmacao' | 'dpa' };

export async function aceitarConviteAction(token: string, _prev: AceiteState, formData: FormData): Promise<AceiteState> {
  // P08-06: o DPA mudou com a página aberta → não grava aceite de um texto que ela não leu
  if (!leuAVersaoEmVigor(formData, DPA_VERSAO)) return { erro: MSG_TEXTO_ATUALIZADO, campo: 'dpa' };
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
    if (e instanceof ConviteError) return { erro: e.message, campo: e.campo };
    throw e;
  }
  let entrou = true;
  try {
    // nextCookies grava o cookie de sessão na resposta desta Server Action
    await getAuth().api.signInEmail({ body: { email, password: senha }, headers: await headers() });
  } catch (e) {
    // T7-R2a: a senha já foi gravada (aceitarConvite concluiu); se o tenant foi suspenso entre
    // o aceite e este login (corrida), a conta existe mas não pode entrar — RN-15.
    if (e instanceof APIError && e.body?.code === 'CONTA_SUSPENSA') redirect(SUSPENDED_PATH);
    entrou = false;
  }
  redirect(entrou ? '/painel' : '/entrar?volta=%2Fpainel');
}
