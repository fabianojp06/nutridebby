import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SairPortal } from '@/app/p/sair-portal';
import { BotaoSair } from '@/components/botao-sair';
import { requireUser } from '@/lib/session';
import { ehPapel, homeFor, OUTRO_PAPEL_PATH, textoOutroPapel, type AppRole } from '@/lib/session-rules';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';

export const metadata: Metadata = { title: 'Conectado com outra conta' };
export const dynamic = 'force-dynamic';

const VOLTAR: Record<AppRole, string> = { admin: 'Ir para a administração', nutri: 'Ir para o painel', paciente: 'Ir para o portal' };

/**
 * P09-03: quem abre uma tela de outro papel (a nutricionista no portal, o paciente no painel, a nutricionista no admin)
 * chega aqui em vez de cair calado na própria home. Só os rótulos dos papéis: nada da conta (nome, e-mail) na tela.
 * `/conta` é protegido no proxy; o `esperado` só vale se for um dos papéis e diferente do atual.
 */
export default async function OutroPapelPage({ searchParams }: PageProps<'/conta/outro-papel'>) {
  const { user } = await requireUser(['admin', 'nutri', 'paciente'], OUTRO_PAPEL_PATH);
  const atual = user.appRole as AppRole;
  const { esperado } = await searchParams;
  if (!ehPapel(esperado) || esperado === atual) redirect(homeFor(atual));
  // como a Segurança: a nutricionista com o tema da conta, o admin no claro; o paciente segue o aparelho
  const tema = atual === 'nutri' ? (ehTema(user.tema) ? user.tema : 'sistema') : atual === 'admin' ? 'claro' : 'sistema';
  return (
    <div data-tema={tema} className="min-h-dvh bg-fundo font-sans text-texto">
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="font-titulo text-2xl font-semibold">Conectado com outra conta</h1>
        <p role="status">{textoOutroPapel(atual, esperado)}</p>
        {/* o paciente sai pelo SairPortal (S-3): cancela o push e apaga a cópia do plano do aparelho */}
        {atual === 'paciente' ? <SairPortal /> : <BotaoSair />}
        <p>
          <a href={homeFor(atual)} className="inline-flex min-h-11 items-center text-link underline">
            {VOLTAR[atual]}
          </a>
        </p>
      </main>
    </div>
  );
}
