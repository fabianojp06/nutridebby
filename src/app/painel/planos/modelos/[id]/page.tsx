import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { referenciasParaPlano } from '@/modules/alimentos/referencias';
import { listarReceitasPublicadas } from '@/modules/conteudo/receitas';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { carregarPlano, paraCliente } from '@/modules/plano-alimentar/carregar';
import { MSG_MODELO_IA } from '@/modules/plano-alimentar/constantes';
import { conteudosParaLigar } from '@/modules/plano-alimentar/ligados';
import { listarListas } from '@/modules/plano-alimentar/listas';
import { listarMinhasRefeicoes } from '@/modules/plano-alimentar/refeicoes-modelo';
import { EditorPlano } from '../../editor/editor-plano';
import { aprovarModeloPlanoAction, excluirModeloAction } from '../actions';
import { AprovarModelo } from '../aprovar-modelo';

export const dynamic = 'force-dynamic';

export default async function ModeloPage({ params }: PageProps<'/painel/planos/modelos/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requireNutri(`/painel/planos/modelos/${id}`);
  const modelo = await carregarPlano(ctx, id);
  if (!modelo || !modelo.isTemplate) notFound();
  const origem = modelo.origemIa; // US-123: modelo sugerido pela IA
  // leituras independentes em paralelo (code review do PR #57)
  const [receitas, perfis, minhasRefeicoes, listas, conteudos] = await Promise.all([
    listarReceitasPublicadas(ctx),
    referenciasParaPlano(ctx),
    listarMinhasRefeicoes(ctx),
    listarListas(ctx),
    conteudosParaLigar(ctx),
  ]);
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <Link href="/painel/planos/modelos" className="text-sm underline">Voltar aos modelos</Link>
        <h1 className="font-titulo text-2xl font-semibold">Modelo: {modelo.titulo}</h1>
        {origem?.sugestao && (
          <>
            <Aviso tipo="aviso">{MSG_MODELO_IA.faixa}</Aviso>
            {origem.descartados > 0 && <p className="text-suave">{MSG_MODELO_IA.descartados(origem.descartados)}</p>}
          </>
        )}
        {origem?.aprovadoEm && <p className="text-suave">{MSG_MODELO_IA.aprovadoEm(formatarDataNoFuso(origem.aprovadoEm, tenant.fuso))}</p>}
        <EditorPlano
          plano={paraCliente(modelo)}
          contexto={null}
          receitas={receitas}
          perfis={perfis}
          minhasRefeicoes={minhasRefeicoes}
          fuso={tenant.fuso}
          ligaveis={{ listas, conteudos }}
          acoes={
            <div className="flex flex-wrap items-center gap-4">
              {origem?.sugestao && <AprovarModelo acao={aprovarModeloPlanoAction.bind(null, modelo.id)} />}
              <form action={excluirModeloAction.bind(null, modelo.id)}>
                <ConfirmarBotao mensagem="Excluir este modelo? Os planos criados a partir dele não mudam.">Excluir modelo</ConfirmarBotao>
              </form>
            </div>
          }
        />
      </main>
    </>
  );
}
