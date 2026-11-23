import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireEquipe } from '@/lib/tenant-session';
import { SEM_PERMISSAO_PATH, type MotivoSemPermissao } from '@/lib/session-rules';
import { MSG_RECEPCAO } from '@/modules/plataforma/equipe-textos';

export const dynamic = 'force-dynamic';

const M = MSG_RECEPCAO.semPermissao;

/**
 * Plano 26 (RE-D47, RN-504, US-490): a recepção numa tela que não é dela — só da nutricionista (`?motivo=nutri`, vindo de
 * requireNutri) ou do Financeiro sem a permissão (`?motivo=financeiro`). Motivo fora da lista: o texto da tela só da
 * nutricionista. A página não lê nada além da sessão. A nutricionista não tem o que fazer aqui: vai ao Início.
 */
export default async function SemPermissaoPage({ searchParams }: PageProps<'/painel/sem-permissao'>) {
  const { papel } = await requireEquipe(SEM_PERMISSAO_PATH);
  if (papel === 'nutri') redirect('/painel');
  const { motivo } = await searchParams;
  const qual: MotivoSemPermissao = motivo === 'financeiro' ? 'financeiro' : 'nutri';
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="font-titulo text-2xl font-semibold">{M.titulo}</h1>
      <p>{M.motivo[qual]}</p>
      <p>
        <Link href="/painel" className="inline-flex min-h-11 items-center text-link underline">
          {M.voltar}
        </Link>
      </p>
    </main>
  );
}
