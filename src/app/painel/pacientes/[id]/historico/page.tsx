import { HistoricoAcessos } from '@/modules/plataforma/ui/historico-acessos';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

/** US-007: acessos a este paciente (inclusive às tabelas filhas), 50 por página, do mais recente. */
export default async function HistoricoPage({
  params,
  searchParams,
}: PageProps<'/painel/pacientes/[id]/historico'>) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const pagina = Number(typeof sp.pagina === 'string' ? sp.pagina : '1') || 1;
  return (
    <HistoricoAcessos
      ctx={ctx}
      patientId={paciente.id}
      pagina={pagina}
      fuso={tenant.fuso}
      baseHref={`/painel/pacientes/${paciente.id}/historico`}
    />
  );
}
