import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { Selo } from '@/components/ui/selo';
import { listarDocumentos, situacaoNoPainel } from '@/modules/documentos/documentos';
import { situacaoDaEntrega } from '@/modules/documentos/entrega';
import { linhaDaAssinatura, ROTULO_STATUS, TIPO_DOCUMENTO_ROTULO } from '@/modules/documentos/constantes';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../prontuario';
import { criarReceitaAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function DocumentosPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/documentos'>) {
  const { id } = await params;
  const busca = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  if (!tenant.documentosLiberados) notFound();
  const lista = await listarDocumentos(ctx, paciente.id);
  const bloqueado = paciente.status === 'bloqueado' || !!paciente.anonimizadoEm;
  return (
    <section aria-labelledby="documentos" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="documentos" className="text-lg font-semibold">Documentos</h2>
        {!bloqueado && (
          <form action={criarReceitaAction.bind(null, paciente.id)} data-guia="nova-receita">
            <Botao>Nova receita</Botao>
          </form>
        )}
      </div>
      {busca.apagado && <Aviso tipo="ok" papel="status">Rascunho apagado.</Aviso>}
      {(bloqueado || busca.bloqueado) && <Aviso tipo="aviso">Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.</Aviso>}
      {lista.length === 0 ? (
        <p>Nenhum documento ainda.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">{`Documentos de ${paciente.nome}`}</caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col">Documento</th>
              <th scope="col">Data</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((d) => (
              <tr key={d.id} className="border-t border-linha">
                <td>
                  <Link href={`/painel/pacientes/${paciente.id}/documentos/${d.id}`} className="inline-flex min-h-11 items-center text-link underline">
                    {`${TIPO_DOCUMENTO_ROTULO[d.tipo]} de ${formatarData(hojeNoFuso(tenant.fuso, d.createdAt))}`}
                  </Link>
                </td>
                <td>{formatarData(hojeNoFuso(tenant.fuso, d.assinadoEm ?? d.createdAt))}</td>
                <td>
                  {/* D4 (T10): no assinado, a situação da entrega no lugar do "Assinado em …" (a data já está na coluna "Data") */}
                  <Selo>{ROTULO_STATUS[d.status]}</Selo> <span className="text-sm text-suave">{d.status === 'assinado' ? situacaoDaEntrega(d, tenant.fuso) : situacaoNoPainel(d, tenant.fuso)}</span>
                  {/* RN-157 / US-144: "Assinatura: Digitalizado" (ou gov.br, ICP) também na lista da nutricionista */}
                  {d.assinaturaTipo && <span className="block text-sm text-suave">{linhaDaAssinatura(d.assinaturaTipo)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
