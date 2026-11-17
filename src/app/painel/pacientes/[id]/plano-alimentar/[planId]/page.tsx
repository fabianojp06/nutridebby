import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EditorPlano } from '@/app/painel/planos/editor/editor-plano';
import { salvarComoModeloAction } from '@/app/painel/planos/modelos/actions';
import { SalvarComoModelo } from '@/app/painel/planos/salvar-como-modelo';
import { referenciasParaPlano } from '@/modules/alimentos/referencias';
import { listarReceitasPublicadas } from '@/modules/conteudo/receitas';
import { MSG_RASCUNHO_IA } from '@/modules/ia/constantes';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { carregarPlano, paraCliente } from '@/modules/plano-alimentar/carregar';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { contextoDoPaciente } from '@/modules/plano-alimentar/meta';
import { carregarProntuario } from '../../prontuario';
import { descartarRascunhoAction, editarPublicadoAction, publicarAction } from '../actions';
import { BotaoAcao } from '../botao-acao';
import { BotaoPublicar } from '../botao-publicar';
import { PdfDoPlano } from './pdf-do-plano';
import { Aviso } from '@/components/ui/aviso';

export const dynamic = 'force-dynamic';

export default async function PlanoPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/plano-alimentar/[planId]'>) {
  const { id, planId } = await params;
  const { publicado, ia, fora } = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const plano = await carregarPlano(ctx, planId);
  if (!plano || plano.patientId !== paciente.id) notFound();
  const rascunho = plano.status === 'rascunho';
  // paciente bloqueado (US-018): o prontuário é só para consulta, como nas outras abas; o servidor também recusa
  const bloqueado = paciente.status === 'bloqueado';
  const editavel = rascunho && !bloqueado;
  const contexto = await contextoDoPaciente(ctx, paciente.id, tenant.fuso);
  // "Usar como rascunho" (US-121, D15): quantos itens ficaram de fora porque o alimento saiu do catálogo
  const foraDoCatalogo = typeof fora === 'string' && /^\d{1,3}$/.test(fora) ? Number(fora) : 0;
  return (
    <section className="space-y-4">
      <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar`} className="text-sm underline">Voltar às versões</Link>
      <h2 className="text-xl font-semibold">Plano alimentar — versão {plano.versao}</h2>
      {/* RN-117 (Plano 14B, D16): a marca do rascunho que nasceu de "Usar como rascunho"; publicado, vira o selo do PDF e do app */}
      {plano.iaOrigemEm && <p className="text-sm text-suave">{MSG_PLANO.marcaIa}</p>}
      {publicado === '1' && plano.status === 'publicado' && <Aviso tipo="ok">Plano publicado.</Aviso>}
      {ia === 'criado' && rascunho && (
        <Aviso tipo="ok">
          {MSG_RASCUNHO_IA.criado}
          {foraDoCatalogo > 0 && <> {MSG_RASCUNHO_IA.foraDoCatalogo(foraDoCatalogo)}</>}
        </Aviso>
      )}
      {bloqueado && <p role="status">{MSG_BLOQUEADO}</p>}
      <EditorPlano
        plano={paraCliente(plano)}
        contexto={contexto}
        receitas={await listarReceitasPublicadas(ctx)}
        somenteLeitura={!editavel}
        perfis={await referenciasParaPlano(ctx)}
        acoes={
          <div className="flex flex-wrap items-start gap-4">
            {editavel && (
              <span data-guia="publicar-plano"><BotaoPublicar acao={publicarAction.bind(null, paciente.id, plano.id)} /></span>
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
