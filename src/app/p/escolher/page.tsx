import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ESCOLHER_PATH, SEM_ACESSO_PATH } from '@/lib/paciente-session';
import { requireUser } from '@/lib/session';
import { SUSPENDED_PATH } from '@/lib/session-rules';
import { vinculosDaConta } from '@/modules/portal/vinculos';
import { EsquecerPlanoGuardado } from '../esquecer-plano';
import { escolherAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Escolher nutricionista' };

/**
 * D3: conta com mais de um vínculo ativo escolhe com qual nutricionista entrar (fica num cookie por 30 dias). RN-15:
 * consultório suspenso aparece sem botão, com "Conta temporariamente indisponível"; com todos suspensos, /indisponivel.
 */
export default async function EscolherNutri({ searchParams }: PageProps<'/p/escolher'>) {
  const { user } = await requireUser(['paciente'], ESCOLHER_PATH);
  const vinculos = await vinculosDaConta(user.id);
  if (!vinculos.length) redirect(SEM_ACESSO_PATH);
  if (!vinculos.some((v) => v.tenantStatus === 'ativa')) redirect(SUSPENDED_PATH);
  const { volta } = await searchParams;
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      {/* S-6 (RN-15): a cópia offline pode ser do consultório suspenso — sai já aqui, não só depois da escolha; a do
          consultório ativo fica (achado 4 do /code-review: só sai a de quem não está entre os escolhíveis) */}
      <EsquecerPlanoGuardado manter={vinculos.filter((v) => v.tenantStatus === 'ativa').map((v) => v.patientId)} />
      <h1 className="font-titulo text-2xl font-semibold">Com qual nutricionista você quer entrar?</h1>
      <ul className="space-y-3">
        {vinculos.map((v) => (
          <li key={v.tenantId}>
            {v.tenantStatus === 'ativa' ? (
              <form action={escolherAction.bind(null, v.tenantId, typeof volta === 'string' ? volta : '/p/inicio')}>
                <button className="min-h-11 w-full rounded-xl border border-campo bg-cartao px-4 py-3 text-left">{v.nomeNutri}</button>
              </form>
            ) : (
              <div className="min-h-11 w-full rounded-xl border border-borda bg-linha px-4 py-3 text-suave">
                <p>{v.nomeNutri}</p>
                <p className="text-sm">Conta temporariamente indisponível</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
