import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { MSG_G } from '@/components/portal/textos';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { meusLembretes } from '@/modules/lembretes/paciente';
import { AtivarAviso } from './ativar-aviso';
import { LembretesDoPaciente } from './interruptor';

export const dynamic = 'force-dynamic';

const INTRODUCAO =
  'Sua nutricionista configurou estes lembretes. Você pode desligar qualquer um ou pausar todos; ela vê o que você desligou ou pausou e se as notificações estão ativas.';

/**
 * Plano 17 (Tarefa 6, §5.3): Eu › Lembretes — os lembretes que a nutricionista ligou, cada um com o interruptor do
 * paciente, e "Pausar todos os lembretes". Tela de detalhe de Eu (como /p/perfil/ia), destino do push de suplemento e de
 * lembrete livre (`telaDoPortal`: o `?v=` do vínculo vale aqui como nas outras telas, por requirePaciente). Sem nenhum
 * lembrete ligado pela equipe, não redireciona: o push antigo abre uma frase com sentido. Leitura auditada
 * (`meusLembretes`); se falhar, vale o error.tsx do portal.
 */
export default async function Lembretes() {
  const { ctx, vinculo } = await requirePaciente('/p/perfil/lembretes');
  const { lembretes, pausadoEm } = await meusLembretes(ctx);
  return (
    <>
      <CabecalhoDetalhe titulo="Lembretes" voltar={{ href: '/p/perfil', secao: MSG_G.titulos.eu }} />
      <main className="space-y-4 p-4">
        {lembretes.length === 0 ? (
          <p>Sua nutricionista ainda não configurou lembretes para você.</p>
        ) : (
          <>
            <p>{INTRODUCAO}</p>
            <AtivarAviso chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={vinculo.patientId} />
            <LembretesDoPaciente lembretes={lembretes} pausado={pausadoEm !== null} />
          </>
        )}
      </main>
    </>
  );
}
