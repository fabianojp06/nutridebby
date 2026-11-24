import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BotaoSair } from '@/components/botao-sair';
import { TextoLegalView } from '@/components/texto-legal';
import { requireUserComTenant } from '@/lib/session';
import { ACESSO_DESATIVADO_PATH, homeFor, type AppRole } from '@/lib/session-rules';
import { MSG_EQUIPE, MSG_RECEPCAO } from '@/modules/plataforma/equipe-textos';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';
import { SIGILO_EQUIPE_TEXTO, SIGILO_EQUIPE_VERSAO } from '@/modules/plataforma/textos-versionados';
import { AceiteDoTermo } from './aceite-do-termo';

export const metadata: Metadata = { title: 'Acesso desativado' };
export const dynamic = 'force-dynamic';

const M = MSG_RECEPCAO.acessoDesativado;

/**
 * Plano 26 (RN-503, RE-D45): a conta da recepção desativada pela nutricionista. Toda tela a manda para cá (evaluateSession:
 * `desativada`), inclusive a Segurança; esta é a única que abre para ela, sem o 2FA, e não lê nada do consultório. Fora do
 * painel (sem o layout dele), com o tema da conta, como a Segurança. Quem não está desativada vai à própria home.
 * Revisão da P26-07 (RN-500): a conta ativa sem o aceite do termo de confidencialidade também cai aqui (a sessão a recusa
 * como a desativada), com o aviso próprio.
 * Revisão do code review do PR 2 (RN-500): o termo numa versão nova não tranca a recepção — a conta ativa, com o 2FA e sem o
 * aceite da versão em vigor, vê o termo inteiro, a caixa e o botão (a action confere tudo de novo). A conta desativada de
 * verdade (`desativada_em`, ou sem linha) vê só o aviso dela; a ativa sem o 2FA, só o aviso do termo pendente (a página abre
 * sem o 2FA, e o aceite pede a pessoa já verificada).
 */
export default async function AcessoDesativadoPage() {
  const { data, membro } = await requireUserComTenant(['admin', 'nutri', 'paciente', 'recepcao'], ACESSO_DESATIVADO_PATH);
  const papel = data.user.appRole as AppRole;
  if (papel !== 'recepcao' || (membro?.ativo && membro.termoAceito)) redirect(homeFor(papel));
  const tema = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  const sair = <BotaoSair className="inline-flex min-h-11 items-center rounded-full border border-campo px-4" />;
  if (membro?.ativo && data.user.twoFactorEnabled) {
    return (
      <div data-tema={tema} className="min-h-dvh bg-fundo font-sans text-texto">
        <main className="mx-auto max-w-lg space-y-4 p-6">
          <h1 className="font-titulo text-2xl font-semibold">{M.aceiteDoTermo.titulo}</h1>
          <p>{M.aceiteDoTermo.texto}</p>
          <section className="rounded-xl border border-borda p-3 text-sm">
            <TextoLegalView texto={SIGILO_EQUIPE_TEXTO} id="sigilo-titulo" classeTitulo="font-semibold" />
          </section>
          <AceiteDoTermo rotulo={MSG_EQUIPE.convite.rotuloTermo} botao={M.aceiteDoTermo.botao} versao={SIGILO_EQUIPE_VERSAO} />
          {sair}
        </main>
      </div>
    );
  }
  const texto = membro?.ativo ? M.termoPendente : M.texto;
  return (
    <div data-tema={tema} className="min-h-dvh bg-fundo font-sans text-texto">
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="font-titulo text-2xl font-semibold">{M.titulo}</h1>
        <p>{texto}</p>
        {sair}
      </main>
    </div>
  );
}
