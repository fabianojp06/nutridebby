import Link from 'next/link';
import { signFileUrl } from '@/lib/signed-url';
import { estadoDaExportacao } from '@/modules/pacientes/exportacao';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';
import { carregarProntuario } from '../../prontuario';

export const dynamic = 'force-dynamic';

/** Destino do link do e-mail (24 h). O download em si é por URL assinada de 5 min (CLAUDE.md regra 9). */
export default async function ExportacaoPage({
  params,
}: PageProps<'/painel/pacientes/[id]/exportacoes/[exportId]'>) {
  const { id, exportId } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const e = await estadoDaExportacao(ctx, paciente.id, exportId);
  const privacidade = `/painel/pacientes/${paciente.id}/privacidade`;
  return (
    <section aria-labelledby="exportacao-titulo" className="max-w-2xl space-y-3">
      <h2 id="exportacao-titulo" className="text-lg font-semibold">
        Exportação de dados
      </h2>
      {e.estado === 'pronta' && (
        <>
          <p>{`Pronta. O link vale até ${formatarDataHora(e.expiraEm, tenant.fuso)}.`}</p>
          <a
            href={signFileUrl(e.caminho)}
            className="inline-block rounded-full bg-destaque font-semibold px-4 py-2 text-white"
          >
            Baixar ZIP
          </a>
        </>
      )}
      {e.estado === 'pendente' && (
        <p role="status">
          A exportação ainda está sendo gerada. Atualize a página em alguns instantes.
        </p>
      )}
      {e.estado === 'expirada' && (
        <p role="status">Este link expirou. Gere uma nova exportação na aba Privacidade.</p>
      )}
      {e.estado === 'falhou' && (
        <p role="alert">Não foi possível gerar a exportação. Gere de novo na aba Privacidade.</p>
      )}
      {e.estado === 'inexistente' && <p role="alert">Exportação não encontrada.</p>}
      <p>
        <Link href={privacidade} className="text-link underline">
          Voltar para Privacidade
        </Link>
      </p>
    </section>
  );
}
