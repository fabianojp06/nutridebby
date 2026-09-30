'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { requireUser } from '@/lib/session';
import { aceitarConvitePaciente, ConvitePacienteError, vincularContaExistente } from '@/modules/pacientes/convite-paciente';

export type AceitePacienteState = { erro?: string; campo?: 'senha' | 'confirmacao' | 'termo' };

export async function aceitarConvitePacienteAction(token: string, _prev: AceitePacienteState, formData: FormData): Promise<AceitePacienteState> {
  const senha = String(formData.get('senha') ?? '');
  let email: string;
  try {
    ({ email } = await aceitarConvitePaciente({
      token,
      senha,
      confirmacao: String(formData.get('confirmacao') ?? ''),
      aceitouTermo: formData.get('termo') === 'on',
      whatsapp: formData.get('whatsapp') === 'on',
      ip: await requestIp(),
    }));
  } catch (e) {
    if (e instanceof ConvitePacienteError) return { erro: e.message, campo: e.campo };
    throw e;
  }
  let entrou = true;
  try {
    // nextCookies grava o cookie de sessão na resposta desta Server Action
    await getAuth().api.signInEmail({ body: { email, password: senha }, headers: await headers() });
  } catch {
    entrou = false; // a senha já foi gravada: cai no login normal
  }
  redirect(entrou ? '/p/inicio' : '/entrar?volta=%2Fp%2Finicio');
}

export async function vincularContaAction(token: string, _prev: AceitePacienteState, formData: FormData): Promise<AceitePacienteState> {
  const { user } = await requireUser(['paciente'], `/convite/paciente/${token}`);
  try {
    await vincularContaExistente({
      token,
      userId: user.id,
      aceitouTermo: formData.get('termo') === 'on',
      whatsapp: formData.get('whatsapp') === 'on',
      ip: await requestIp(),
    });
  } catch (e) {
    if (e instanceof ConvitePacienteError) return { erro: e.message, campo: e.campo };
    throw e;
  }
  redirect('/p/inicio');
}
