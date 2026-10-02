import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { formatarQuando } from '@/modules/agenda/fuso';
import { provedorDoApp, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { Cabecalho } from '../cabecalho';
import { desconectarAction } from './actions';
import { ConectarWhatsapp } from './conectar';

export const dynamic = 'force-dynamic';

export default async function WhatsappPage() {
  const { ctx, tenant } = await requireNutri('/painel/whatsapp');
  const s = await situacaoDoWhatsapp(ctx, provedorDoApp() !== null);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        {!s.ligado ? (
          <p role="status">O WhatsApp ainda não está disponível na plataforma. Os lembretes saem por e-mail.</p>
        ) : s.estado === 'conectada' ? (
          <section className="space-y-3">
            <p role="status">{`Conectado ao número ${s.numero ? formatarTelefone(s.numero) : '(número ainda não informado)'}.`}</p>
            <form action={desconectarAction}>
              <ConfirmarBotao mensagem="Desconectar o WhatsApp? Os lembretes passam a sair só por e-mail e notificação no app.">Desconectar WhatsApp</ConfirmarBotao>
            </form>
          </section>
        ) : (
          <section className="space-y-3">
            {s.conectadaAntes && s.desconectadaEm && (
              <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">{`WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. (Desde ${formatarQuando(s.desconectadaEm, tenant.fuso)}.)`}</p>
            )}
            <p>Use, de preferência, um número só do consultório. Os lembretes saem do número conectado.</p>
            <ConectarWhatsapp />
          </section>
        )}
        {/* Tarefa 11: WhatsApps do mês */}
      </main>
    </>
  );
}
