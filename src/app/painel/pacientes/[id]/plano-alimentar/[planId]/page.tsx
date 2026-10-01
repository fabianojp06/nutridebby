import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EditorPlano } from '@/app/painel/planos/editor/editor-plano';
import { salvarComoModeloAction } from '@/app/painel/planos/modelos/actions';
import { SalvarComoModelo } from '@/app/painel/planos/salvar-como-modelo';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { carregarPlano } from '@/modules/plano-alimentar/carregar';
import { contextoDoPaciente } from '@/modules/plano-alimentar/meta';
import { carregarProntuario } from '../../prontuario';
import { descartarRascunhoAction, editarPublicadoAction, publicarAction } from '../actions';
import { BotaoAcao } from '../botao-acao';

export const dynamic = 'force-dynamic';

export default async function PlanoPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/plano-alimentar/[planId]'>) {
  const { id, planId } = await params;
  const { publicado } = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const plano = await carregarPlano(ctx, planId);
  if (!plano || plano.patientId !== paciente.id) notFound();
  const rascunho = plano.status === 'rascunho';
  const contexto = await contextoDoPaciente(ctx, paciente.id, tenant.fuso);
  return (
    <section className="space-y-4">
      <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar`} className="text-sm underline">Voltar às versões</Link>
      <h2 className="text-xl font-semibold">Plano alimentar — versão {plano.versao}</h2>
      {publicado === '1' && plano.status === 'publicado' && <p role="status" className="rounded bg-emerald-50 p-3">Plano publicado.</p>}
      <EditorPlano
        plano={plano}
        contexto={contexto}
        somenteLeitura={!rascunho}
        acoes={
          <div className="flex flex-wrap items-start gap-4">
            {rascunho && (
              <BotaoAcao acao={publicarAction.bind(null, paciente.id, plano.id)} rotulo="Publicar" confirmar="Publicar esta versão para o paciente? A versão publicada hoje será arquivada." exigirSalvo />
            )}
            {plano.status === 'publicado' && <BotaoAcao acao={editarPublicadoAction.bind(null, paciente.id, plano.id)} rotulo="Editar" principal={false} />}
            <SalvarComoModelo acao={salvarComoModeloAction.bind(null, plano.id)} tituloSugerido={plano.titulo} />
            {rascunho && (
              <form action={descartarRascunhoAction.bind(null, paciente.id, plano.id)}>
                <ConfirmarBotao mensagem="Descartar este rascunho?">Descartar rascunho</ConfirmarBotao>
              </form>
            )}
          </div>
        }
      />
    </section>
  );
}
