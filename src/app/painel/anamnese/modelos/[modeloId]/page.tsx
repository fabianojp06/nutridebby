import { notFound } from 'next/navigation';
import { AprovarModelo } from '@/app/painel/planos/modelos/aprovar-modelo';
import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { buscarModelo, itensDescartadosDoModelo } from '@/modules/pacientes/anamnese';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { MSG_MODELO_IA } from '@/modules/plano-alimentar/constantes';
import { aprovarModeloAnamneseAction, salvarModeloAction } from '../actions';
import { ModeloEditor } from '../modelo-editor';

export const dynamic = 'force-dynamic';

export default async function EditarModeloPage({ params }: PageProps<'/painel/anamnese/modelos/[modeloId]'>) {
  const { modeloId } = await params;
  const { ctx, tenant } = await requireNutri(`/painel/anamnese/modelos/${modeloId}`);
  const modelo = await buscarModelo(ctx, modeloId);
  if (!modelo) notFound();
  const sugestao = modelo.iaGeracaoId !== null && modelo.aprovadoEm === null; // US-123: sugerido pela IA, ainda não aprovado
  const descartados = sugestao ? await itensDescartadosDoModelo(ctx, modelo) : 0;
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <h1 className="font-titulo text-2xl font-semibold">Editar modelo de anamnese</h1>
        {sugestao && (
          <>
            <Aviso tipo="aviso">{MSG_MODELO_IA.faixa}</Aviso>
            {descartados > 0 && <p className="text-suave">{MSG_MODELO_IA.descartados(descartados)}</p>}
            <AprovarModelo acao={aprovarModeloAnamneseAction.bind(null, modelo.id)} />
          </>
        )}
        {modelo.aprovadoEm && <p className="text-suave">{MSG_MODELO_IA.aprovadoEm(formatarDataNoFuso(modelo.aprovadoEm, tenant.fuso))}</p>}
        <p className="text-sm text-suave">As anamneses já preenchidas continuam com as perguntas de quando foram respondidas.</p>
        <ModeloEditor acao={salvarModeloAction.bind(null, modelo.id)} inicial={{ nome: modelo.nome, perguntas: modelo.schema.perguntas }} />
      </main>
    </>
  );
}
