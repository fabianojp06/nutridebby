import Link from 'next/link';
import { formatarData } from '@/modules/pacientes/datas';
import { listarPlanosDoPaciente } from '@/modules/plano-alimentar/carregar';
import { carregarProntuario } from '../prontuario';
import { BotaoAcao } from './botao-acao';
import { criarRascunhoAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS = { rascunho: 'Rascunho', publicado: 'Publicado', arquivado: 'Arquivado' } as const;

export default async function PlanoAlimentarPage({ params }: PageProps<'/painel/pacientes/[id]/plano-alimentar'>) {
  const { id } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const planos = await listarPlanosDoPaciente(ctx, paciente.id);
  const rascunho = planos.find((p) => p.status === 'rascunho');
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Plano alimentar</h2>
      <div className="flex flex-wrap gap-3">
        {rascunho ? (
          <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar/${rascunho.id}`} className="rounded bg-emerald-700 px-4 py-2 text-white">Continuar o rascunho (versão {rascunho.versao})</Link>
        ) : (
          !planos.some((p) => p.status === 'publicado') && <BotaoAcao acao={criarRascunhoAction.bind(null, paciente.id)} rotulo="Criar plano" />
        )}
      </div>
      {planos.length === 0 ? (
        <p>Nenhum plano ainda.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Versões do plano</caption>
          <thead>
            <tr><th scope="col">Versão</th><th scope="col">Título</th><th scope="col">Situação</th><th scope="col">Publicado em</th></tr>
          </thead>
          <tbody>
            {planos.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/painel/pacientes/${paciente.id}/plano-alimentar/${p.id}`} className="underline">Versão {p.versao}</Link></td>
                <td>{p.titulo}</td>
                <td>{STATUS[p.status]}</td>
                <td>{p.publicadoEm ? formatarData(p.publicadoEm.slice(0, 10)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
