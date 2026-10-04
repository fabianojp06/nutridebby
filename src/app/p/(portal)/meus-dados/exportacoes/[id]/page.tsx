import { notFound } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { formatarQuando } from '@/modules/agenda/fuso';
import { idValido } from '@/modules/pacientes/base';
import { estadoDosMeusDados, MSG_MEUS_DADOS } from '@/modules/portal/meus-dados';

export const dynamic = 'force-dynamic';

/** US-046 / D16: destino do link do e-mail "Exportação de dados pronta" pedida pelo titular. Download por URL assinada de 5 min. */
export default async function MeusDadosExportacao({ params }: PageProps<'/p/meus-dados/exportacoes/[id]'>) {
  const { id } = await params;
  if (!idValido(id)) notFound();
  const { ctx, tenant } = await requirePaciente(`/p/meus-dados/exportacoes/${id}`);
  const e = await estadoDosMeusDados(ctx, id);
  if (e.estado === 'inexistente') notFound();
  return (
    <main className="space-y-4 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Seus dados</h1>
      {e.estado === 'pronta' && (
        <>
          <p>{MSG_MEUS_DADOS.pronta(formatarQuando(e.expiraEm, tenant.fuso))}</p>
          <a href={signFileUrl(e.caminho)} className="inline-flex min-h-11 items-center rounded-xl bg-destaque px-4 font-semibold text-white">
            Baixar arquivo
          </a>
        </>
      )}
      {e.estado === 'pendente' && <p role="status">{MSG_MEUS_DADOS.preparando}</p>}
      {e.estado === 'expirada' && <p>{MSG_MEUS_DADOS.expirada}</p>}
      {e.estado === 'falhou' && <p role="alert">{MSG_MEUS_DADOS.falhou}</p>}
    </main>
  );
}
