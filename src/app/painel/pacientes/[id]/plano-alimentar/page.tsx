import Link from 'next/link';
import { criarDeModeloAction } from '@/app/painel/planos/modelos/actions';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { listarPlanosDoPaciente } from '@/modules/plano-alimentar/carregar';
import { listarModelos } from '@/modules/plano-alimentar/modelos';
import { carregarProntuario } from '../prontuario';
import { BotaoAcao } from './botao-acao';
import { CriarDeModelo } from './criar-de-modelo';
import { criarRascunhoAction, editarPublicadoAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS = { rascunho: 'Rascunho', publicado: 'Publicado', arquivado: 'Arquivado' } as const;

export default async function PlanoAlimentarPage({ params }: PageProps<'/painel/pacientes/[id]/plano-alimentar'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const planos = await listarPlanosDoPaciente(ctx, paciente.id);
  const rascunho = planos.find((p) => p.status === 'rascunho');
  const publicado = planos.find((p) => p.status === 'publicado');
  const bloqueado = paciente.status === 'bloqueado'; // US-018: só consulta, sem criar nem editar versões
  const modelos = rascunho || bloqueado ? [] : await listarModelos(ctx); // "Criar a partir de modelo" só aparece sem rascunho
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Plano alimentar</h2>
      {!bloqueado && (
        <div className="flex flex-wrap gap-3">
          {rascunho ? (
            <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar/${rascunho.id}`} className="rounded-full bg-destaque font-semibold px-4 py-2 text-white">Continuar o rascunho (versão {rascunho.versao})</Link>
          ) : publicado ? (
            <BotaoAcao acao={editarPublicadoAction.bind(null, paciente.id, publicado.id)} rotulo="Editar o plano publicado" />
          ) : (
            <BotaoAcao acao={criarRascunhoAction.bind(null, paciente.id)} rotulo="Criar plano" />
          )}
          {!rascunho && modelos.length > 0 && <CriarDeModelo acao={criarDeModeloAction.bind(null, paciente.id)} modelos={modelos} />}
        </div>
      )}
      {planos.length === 0 ? (
        <p>Nenhum plano ainda.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Versões do plano</caption>
          <thead className="text-sm text-suave">
            <tr><th scope="col">Versão</th><th scope="col">Título</th><th scope="col">Situação</th><th scope="col">Publicado em</th></tr>
          </thead>
          <tbody>
            {planos.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/painel/pacientes/${paciente.id}/plano-alimentar/${p.id}`} className="text-link underline">Versão {p.versao}</Link></td>
                <td>{p.titulo}</td>
                <td>{STATUS[p.status]}</td>
                <td>{p.publicadoEm ? formatarDataNoFuso(p.publicadoEm, tenant.fuso) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
