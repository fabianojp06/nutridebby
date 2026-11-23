import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BotaoSair } from '@/components/botao-sair';
import { requireUserComTenant } from '@/lib/session';
import { ACESSO_DESATIVADO_PATH, homeFor, type AppRole } from '@/lib/session-rules';
import { MSG_RECEPCAO } from '@/modules/plataforma/equipe-textos';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';

export const metadata: Metadata = { title: 'Acesso desativado' };
export const dynamic = 'force-dynamic';

const M = MSG_RECEPCAO.acessoDesativado;

/**
 * Plano 26 (RN-503, RE-D45): a conta da recepção desativada pela nutricionista. Toda tela a manda para cá (evaluateSession:
 * `desativada`), inclusive a Segurança; esta é a única que abre para ela, sem o 2FA, e não lê nada do consultório. Fora do
 * painel (sem o layout dele), com o tema da conta, como a Segurança. Quem não está desativada vai à própria home.
 */
export default async function AcessoDesativadoPage() {
  const { data, membro } = await requireUserComTenant(['admin', 'nutri', 'paciente', 'recepcao'], ACESSO_DESATIVADO_PATH);
  const papel = data.user.appRole as AppRole;
  if (papel !== 'recepcao' || membro?.ativo) redirect(homeFor(papel));
  const tema = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  return (
    <div data-tema={tema} className="min-h-dvh bg-fundo font-sans text-texto">
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="font-titulo text-2xl font-semibold">{M.titulo}</h1>
        <p>{M.texto}</p>
        <BotaoSair className="inline-flex min-h-11 items-center rounded-full border border-campo px-4" />
      </main>
    </div>
  );
}
