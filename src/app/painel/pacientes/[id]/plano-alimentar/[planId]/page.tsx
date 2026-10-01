import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EditorPlano } from '@/app/painel/planos/editor/editor-plano';
import { salvarComoModeloAction } from '@/app/painel/planos/modelos/actions';
import { SalvarComoModelo } from '@/app/painel/planos/salvar-como-modelo';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { carregarPlano, paraCliente } from '@/modules/plano-alimentar/carregar';
import { contextoDoPaciente } from '@/modules/plano-alimentar/meta';
import { carregarProntuario } from '../../prontuario';
import { descartarRascunhoAction, editarPublicadoAction, publicarAction } from '../actions';
import { BotaoAcao } from '../botao-acao';
import { PdfDoPlano } from './pdf-do-plano';

export const dynamic = 'force-dynamic';

export default async function PlanoPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/plano-alimentar/[planId]'>) {
  const { id, planId } = await params;
  const { publicado } = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const plano = await carregarPlano(ctx, planId);
  if (!plano || plano.patientId !== paciente.id) notFound();
  const rascunho = plano.status === 'rascunho';
  // paciente bloqueado (US-018): o prontuário é só para consulta, como nas outras abas; o servidor também recusa
  const bloqueado = paciente.status === 'bloqueado';
  const editavel = rascunho && !bloqueado;
  const contexto = await contextoDoPaciente(ctx, paciente.id, tenant.fuso);
  return (
    <section className="space-y-4">
      <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar`} className="text-sm underline">Voltar às versões</Link>
      <h2 className="text-xl font-semibold">Plano alimentar — versão {plano.versao}</h2>
      {publicado === '1' && plano.status === 'publicado' && <p role="status" className="rounded bg-emerald-50 p-3">Plano publicado.</p>}
      {bloqueado && <p role="status">{MSG_BLOQUEADO}</p>}
      <EditorPlano
        plano={paraCliente(plano)}
        contexto={contexto}
        somenteLeitura={!editavel}
        acoes={
          <div className="flex flex-wrap items-start gap-4">
            {editavel && (
              <BotaoAcao acao={publicarAction.bind(null, paciente.id, plano.id)} rotulo="Publicar" confirmar="Publicar esta versão para o paciente? A versão publicada hoje será arquivada." exigirSalvo />
            )}
            {plano.status === 'publicado' && !bloqueado && <BotaoAcao acao={editarPublicadoAction.bind(null, paciente.id, plano.id)} rotulo="Editar" principal={false} />}
            {!rascunho && <PdfDoPlano plano={plano} patientId={paciente.id} bloqueado={bloqueado} />}
            {!bloqueado && <SalvarComoModelo acao={salvarComoModeloAction.bind(null, plano.id)} tituloSugerido={plano.titulo} />}
            {editavel && (
              <BotaoAcao acao={descartarRascunhoAction.bind(null, paciente.id, plano.id)} rotulo="Descartar rascunho" confirmar="Descartar este rascunho?" principal={false} />
            )}
          </div>
        }
      />
    </section>
  );
}
