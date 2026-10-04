import { requireNutri } from '@/lib/tenant-session';
import { formatarQuando } from '@/modules/agenda/fuso';
import { provedorDoApp, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { MSG_COTA, situacaoDaCota } from '@/modules/notificacoes/whatsapp/cota';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { ConectarWhatsapp } from './conectar';
import { DesconectarWhatsapp } from './desconectar';

export const dynamic = 'force-dynamic';

export default async function WhatsappPage() {
  const { ctx, tenant } = await requireNutri('/painel/whatsapp');
  const s = await situacaoDoWhatsapp(ctx, provedorDoApp() !== null);
  // RN-09 / US-036: só com o WhatsApp ligado na plataforma (sem ele, nada sai e nada conta)
  const cota = s.ligado ? await situacaoDaCota(ctx, tenant) : null;
  return (
    <>
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        {!s.ligado ? (
          <p role="status">O WhatsApp ainda não está disponível na plataforma. Os lembretes saem por e-mail.</p>
        ) : s.estado === 'conectada' ? (
          <section className="space-y-3">
            <p role="status">{`Conectado ao número ${s.numero ? formatarTelefone(s.numero) : '(número ainda não informado)'}.`}</p>
            <DesconectarWhatsapp />
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
        {cota && (
          <section aria-labelledby="uso" className="space-y-2">
            <h2 id="uso" className="text-lg font-semibold">Uso do mês</h2>
            <p>{MSG_COTA.uso(cota.usadas, cota.cota)}</p>
            {cota.nivel === 'aviso' && <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">{MSG_COTA.aviso}</p>}
            {cota.nivel === 'esgotada' && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA.esgotada}</p>}
          </section>
        )}
      </main>
    </>
  );
}
