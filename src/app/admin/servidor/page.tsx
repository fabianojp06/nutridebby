import { ConfirmarBotao } from '@/components/confirmar-botao';
import { classeDoBotao } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { getDb } from '@/db/client';
import { requireUser } from '@/lib/session';
import { lerPausa } from '@/modules/plataforma/ia-nutri-pausa';
import { pausarIaNutriAction, retomarIaNutriAction } from '../actions';
import { PainelInfra } from '../painel-infra';
import { CONFIRMAR_PAUSAR_IA_NUTRI, CONFIRMAR_RETOMAR_IA_NUTRI } from '../textos';

export const dynamic = 'force-dynamic';

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

/**
 * P16-17: a aba "Servidor" — o último backup de cada tipo (RNF-05) e o uso do disco (RNF-13). Plano 15 (RN-185, DP-1,
 * ★ DO-1 = não, ★ DO-5): o desligamento de EMERGÊNCIA da IA Nutri em todos os consultórios. No estado normal ela está ligada
 * e cada consultório decide (a nutricionista ativa e libera paciente por paciente); "Retomar" é a volta da pausa.
 */
export default async function ServidorPage() {
  await requireUser(['admin'], '/admin/servidor');
  const pausa = await lerPausa(getDb());
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <h1 className="font-titulo text-2xl font-semibold">Servidor</h1>
      <div className="max-w-2xl space-y-6">
        <PainelInfra />
        <Cartao id="ia-nutri-pausa" titulo="IA Nutri (pacientes) — desligamento de emergência">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>{pausa.pausadaEm ? <strong>{`Pausada desde ${quando(pausa.pausadaEm)}`}</strong> : 'Ligada — cada consultório decide'}</p>
            <form action={pausa.pausadaEm ? retomarIaNutriAction : pausarIaNutriAction}>
              <ConfirmarBotao className={classeDoBotao('secundario')} mensagem={pausa.pausadaEm ? CONFIRMAR_RETOMAR_IA_NUTRI : CONFIRMAR_PAUSAR_IA_NUTRI}>
                {pausa.pausadaEm ? 'Retomar a IA Nutri' : 'Pausar a IA Nutri em todos os consultórios'}
              </ConfirmarBotao>
            </form>
          </div>
        </Cartao>
      </div>
    </main>
  );
}
