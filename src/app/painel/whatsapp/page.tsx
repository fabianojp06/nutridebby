import { requireNutri } from '@/lib/tenant-session';
import { formatarQuando } from '@/modules/agenda/fuso';
import { provedorDoApp, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { MSG_COTA, situacaoDaCota } from '@/modules/notificacoes/whatsapp/cota';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { ConectarWhatsapp } from './conectar';
import { DesconectarWhatsapp } from './desconectar';
import { Aviso } from '@/components/ui/aviso';

export const dynamic = 'force-dynamic';

export default async function WhatsappPage() {
  const { ctx, tenant } = await requireNutri('/painel/whatsapp');
  const s = await situacaoDoWhatsapp(ctx, provedorDoApp() !== null);
  // RN-09 / US-036: só com o WhatsApp ligado na plataforma (sem ele, nada sai e nada conta)
  const cota = s.ligado ? await situacaoDaCota(ctx, tenant) : null;
  return (
    <>
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="font-titulo text-2xl font-semibold">WhatsApp</h1>
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
              <Aviso tipo="aviso" papel="alert">{`WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. (Desde ${formatarQuando(s.desconectadaEm, tenant.fuso)}.)`}</Aviso>
            )}
            <p>Use, de preferência, um número só do consultório. Os lembretes saem do número conectado.</p>
            <ConectarWhatsapp />
          </section>
        )}
        {cota && (
          <section aria-labelledby="uso" className="space-y-2">
            <h2 id="uso" className="text-lg font-semibold">Uso do mês</h2>
            <p>{MSG_COTA.uso(cota.usadas, cota.cota)}</p>
            {cota.nivel === 'aviso' && <Aviso tipo="aviso">{MSG_COTA.aviso}</Aviso>}
            {cota.nivel === 'esgotada' && <Aviso tipo="erro">{MSG_COTA.esgotada}</Aviso>}
          </section>
        )}
      </main>
    </>
  );
}
