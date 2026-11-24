import { redirect } from 'next/navigation';
import { DPA_PATH, requireEquipe } from '@/lib/tenant-session';
import { CONTRATO_PENDENTE_PATH } from '@/lib/session-rules';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { MSG_RECEPCAO } from '@/modules/plataforma/equipe-textos';

export const dynamic = 'force-dynamic';

const M = MSG_RECEPCAO.contratoPendente;

/**
 * Plano 26 (RN-501, RE-D29, US-490): o DPA do consultório numa versão que a nutricionista ainda não aceitou. A recepção não
 * aceita (quem aceita é a controladora): toda tela dela vem para cá (requireEquipe) até a nutricionista aceitar. O "Sair"
 * está no cabeçalho mínimo do layout (sem o menu), como na tela do DPA da nutricionista. Com o DPA em dia, o Início; a
 * nutricionista vai ao aceite.
 */
export default async function ContratoPendentePage() {
  const { papel, tenant } = await requireEquipe(CONTRATO_PENDENTE_PATH, { permitirDpaPendente: true });
  const emDia = tenant.dpaVersao === DPA_VERSAO;
  if (papel === 'nutri') redirect(emDia ? '/painel' : DPA_PATH);
  if (emDia) redirect('/painel');
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="font-titulo text-2xl font-semibold">{M.titulo}</h1>
      <p>{M.texto}</p>
    </main>
  );
}
