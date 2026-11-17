import { BotaoLink } from '@/components/ui/botao';
import { MSG_RESUMO } from '@/modules/ia/constantes';
import { iaDoAssistente } from './ia-assistente';
import { carregarProntuario } from './prontuario';

export const dynamic = 'force-dynamic';

/** Aba Início (Plano 18). O cadastro, o acesso ao app e as etiquetas foram para o Perfil (D12); o resto do Início chega na Tarefa 4. */
export default async function InicioPage({ params }: PageProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const ia = await iaDoAssistente(ctx, tenant, paciente, 'resumo_historico');
  return (
    <div className="grid gap-8 md:grid-cols-2">
      {/* US-120 (Plano 14B): só com a IA da plataforma presente e o paciente ativo; sem poder pedir, o motivo (texto da aba Exames) */}
      {ia && (
        <section aria-labelledby="ia-titulo" className="space-y-2">
          <h2 id="ia-titulo" className="text-lg font-semibold">Inteligência artificial</h2>
          {ia.podePedir ? (
            <BotaoLink href={`/painel/pacientes/${paciente.id}/resumo-ia`} variante="secundario">{MSG_RESUMO.botao}</BotaoLink>
          ) : (
            <p className="text-sm text-suave">{ia.aviso}</p>
          )}
        </section>
      )}
    </div>
  );
}
