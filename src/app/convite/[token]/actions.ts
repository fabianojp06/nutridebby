'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { APIError } from 'better-auth/api';
import { getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { SUSPENDED_PATH } from '@/lib/session-rules';
import { aceitarConvite, ConviteError, inspecionarConvite } from '@/modules/plataforma/convites';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { leuAVersaoEmVigor, MSG_TEXTO_ATUALIZADO, SIGILO_EQUIPE_VERSAO } from '@/modules/plataforma/textos-versionados';

export type AceiteState = { erro?: string; campo?: 'senha' | 'confirmacao' | 'dpa' | 'sigilo' };

export async function aceitarConviteAction(token: string, _prev: AceiteState, formData: FormData): Promise<AceiteState> {
  // Plano 26 (RN-500): o tipo do convite (no banco, nunca do formulário) decide o texto aceito — o DPA da nutricionista ou o
  // termo de confidencialidade da equipe. Convite inválido ou vencido: sem texto a conferir, o aceitarConvite diz por quê.
  const estado = await inspecionarConvite(getDb(), token);
  const recepcao = estado.estado === 'valido' && estado.tipo === 'recepcao';
  // P08-06: o texto mudou com a página aberta → não grava aceite de um texto que a pessoa não leu
  if (estado.estado === 'valido' && !leuAVersaoEmVigor(formData, recepcao ? SIGILO_EQUIPE_VERSAO : DPA_VERSAO)) return { erro: MSG_TEXTO_ATUALIZADO, campo: recepcao ? 'sigilo' : 'dpa' };
  const senha = String(formData.get('senha') ?? '');
  let email: string;
  try {
    ({ email } = await aceitarConvite({
      token,
      senha,
      confirmacao: String(formData.get('confirmacao') ?? ''),
      aceitouDpa: formData.get('dpa') === 'on',
      aceitouSigilo: formData.get('sigilo') === 'on',
      ip: await requestIp(),
    }));
  } catch (e) {
    if (e instanceof ConviteError) return { erro: e.message, campo: e.campo };
    throw e;
  }
  // a recepção vai a /inicio, que leva à configuração obrigatória do 2FA (RN-500) e depois ao Início dela (RE-D67)
  const destino = recepcao ? '/inicio' : '/painel';
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
  redirect(entrou ? destino : `/entrar?volta=${encodeURIComponent(destino)}`);
}
