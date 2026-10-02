import Link from 'next/link';
import { formatarBytes } from '@/lib/format';
import { requireNutri } from '@/lib/tenant-session';
import { provedorDoApp, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { MSG_COTA, situacaoDaCota } from '@/modules/notificacoes/whatsapp/cota';
import { COTA_BYTES, MSG_COTA_ESGOTADA, nivelDeUso } from '@/modules/plataforma/armazenamento';
import { Cabecalho } from './cabecalho';

export const dynamic = 'force-dynamic';

export default async function PainelHome() {
  const { data, tenant, ctx } = await requireNutri('/painel');
  const whatsapp = await situacaoDoWhatsapp(ctx, provedorDoApp() !== null);
  const cota = whatsapp.ligado ? await situacaoDaCota(ctx, tenant) : null; // RN-09: só com o WhatsApp ligado
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Painel da nutricionista</h1>
        {(() => {
          const uso = nivelDeUso(tenant.armazenamentoBytes);
          if (uso.nivel === 'esgotado') return <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA_ESGOTADA}</p>;
          if (uso.nivel === 'aviso') {
            return (
              <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">
                {`Você já usou ${uso.percentual}% do espaço de armazenamento (${formatarBytes(tenant.armazenamentoBytes)} de ${formatarBytes(COTA_BYTES)}).`}
              </p>
            );
          }
          return null;
        })()}
        {whatsapp.ligado && whatsapp.conectadaAntes && whatsapp.estado === 'desconectada' && (
          <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">
            WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. <Link href="/painel/whatsapp" className="underline">Conectar de novo</Link>
          </p>
        )}
        {cota?.nivel === 'aviso' && <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">{MSG_COTA.aviso}</p>}
        {cota?.nivel === 'esgotada' && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA.esgotada}</p>}
        <p>Conectado como {data.user.email}.</p>
      </main>
    </>
  );
}
