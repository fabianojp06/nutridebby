'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';

/**
 * Botão "Sair" (todas as áreas logadas): encerra a sessão deste navegador (o `nextCookies` do Better
 * Auth apaga o cookie na resposta desta Server Action) e vai para o login. Sem sessão válida (cookie
 * ausente, expirado ou já encerrado em outra aba) o signOut não faz nada além de limpar o cookie.
 * Nada é registrado em log: não há dado que valha a linha.
 */
export async function sairAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect('/entrar');
}
