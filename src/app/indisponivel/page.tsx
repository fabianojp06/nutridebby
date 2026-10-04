import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { EsquecerPlanoGuardado } from '@/app/p/esquecer-plano';
import { SairPortal } from '@/app/p/sair-portal';
import { BotaoSair } from '@/components/botao-sair';
import { getAuth } from '@/lib/auth';

export const metadata: Metadata = { title: 'Conta temporariamente indisponível' };
export const dynamic = 'force-dynamic';

export default async function IndisponivelPage() {
  // Página pública (quem tentou entrar numa conta suspensa chega aqui sem sessão): consulta a sessão sem redirecionar e
  // só oferece "Sair" a quem tem uma (a conta suspensa que ainda não caiu na próxima requisição, RN-15)
  const sessao = await getAuth().api.getSession({ headers: await headers(), query: { disableRefresh: true } });
  const paciente = sessao?.user.appRole === 'paciente';
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      {/* RN-15: o paciente do consultório suspenso perde a cópia offline do plano (a sessão ainda vale) */}
      {paciente && <EsquecerPlanoGuardado />}
      <h1 className="text-2xl font-semibold">Conta temporariamente indisponível</h1>
      <p><a href="/entrar" className="underline">Voltar para o login</a></p>
      {/* o paciente sai pelo SairPortal (S-3): cancela o push do aparelho e apaga a cópia também no Safari < 17 */}
      {sessao && (paciente ? <SairPortal /> : <BotaoSair />)}
    </main>
  );
}
