import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EditorPlano } from '@/app/painel/planos/editor/editor-plano';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { carregarPlano } from '@/modules/plano-alimentar/carregar';
import { contextoDoPaciente } from '@/modules/plano-alimentar/meta';
import { carregarProntuario } from '../../prontuario';
import { descartarRascunhoAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PlanoPage({ params }: PageProps<'/painel/pacientes/[id]/plano-alimentar/[planId]'>) {
  const { id, planId } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const plano = await carregarPlano(ctx, planId);
  if (!plano || plano.patientId !== paciente.id) notFound();
  const rascunho = plano.status === 'rascunho';
  const contexto = await contextoDoPaciente(ctx, paciente.id, tenant.fuso);
  return (
    <section className="space-y-4">
      <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar`} className="text-sm underline">Voltar às versões</Link>
      <h2 className="text-xl font-semibold">Plano alimentar — versão {plano.versao}</h2>
      <EditorPlano
        plano={plano}
        contexto={contexto}
        somenteLeitura={!rascunho}
        acoes={
          rascunho && (
            <form action={descartarRascunhoAction.bind(null, paciente.id, plano.id)}>
              <ConfirmarBotao mensagem="Descartar este rascunho?">Descartar rascunho</ConfirmarBotao>
            </form>
          )
        }
      />
    </section>
  );
}
