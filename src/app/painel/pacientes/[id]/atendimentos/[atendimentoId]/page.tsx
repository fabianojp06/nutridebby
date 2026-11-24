import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import type { TenantContext } from '@/db/tenant';
import { valorDaCobrancaDoAtendimento } from '@/modules/financeiro/cobranca';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { buscarAtendimento } from '@/modules/pacientes/atendimentos';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../../prontuario';
import { atualizarAtendimentoAction } from '../actions';
import { AtendimentoForm } from '../atendimento-form';

export const dynamic = 'force-dynamic';

/**
 * Plano 20 (US-303, §6.2): depois de "Registrar atendimento" ligado a uma consulta que passou a "Realizada"
 * (`?ok=atendimento&cobranca=…`). Criada: o valor lido da própria cobrança (nunca da URL); sem valor: o texto com o link
 * para as configurações; bloqueado, já existia ou desconhecido: sem mensagem do Financeiro.
 */
async function mensagemDoAtendimento(ctx: TenantContext, atendimentoId: string, sp: Record<string, string | string[] | undefined>) {
  if (sp.ok !== 'atendimento') return null;
  const M = MSG_FINANCEIRO.atendimento;
  if (sp.cobranca === 'sem_valor')
    return { tipo: 'aviso' as const, texto: <>{M.semValor.antes}<Link href="/painel/financeiro/configuracoes" className="underline">{M.semValor.link}</Link>{M.semValor.depois}</> };
  if (sp.cobranca !== 'criada') return null;
  const valor = await valorDaCobrancaDoAtendimento(ctx, atendimentoId);
  return valor === null ? null : { tipo: 'ok' as const, texto: M.criada(formatarReais(valor)) };
}

export default async function AtendimentoPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/atendimentos/[atendimentoId]'>) {
  const { id, atendimentoId } = await params;
  const sp = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const a = await buscarAtendimento(ctx, paciente.id, atendimentoId);
  if (!a) notFound();
  const mensagem = await mensagemDoAtendimento(ctx, a.id, sp);
  const base = `/painel/pacientes/${paciente.id}`;
  return (
    <div className="space-y-4">
      {mensagem && <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>}
      <div className="grid gap-8 md:grid-cols-3">
        <section aria-labelledby="atendimento-titulo" className="space-y-3 md:col-span-2">
          <h2 id="atendimento-titulo" className="text-lg font-semibold">{`Atendimento de ${formatarData(a.data)}`}</h2>
          <AtendimentoForm
            acao={atualizarAtendimentoAction.bind(null, paciente.id, a.id)}
            inicial={{ data: a.data, notasPrivadas: a.notasPrivadas ?? '', orientacoes: a.orientacoesPaciente ?? '', retornoPrevistoEm: a.retornoPrevistoEm ?? '' }}
            hoje={hojeNoFuso(tenant.fuso)}
            botao="Salvar atendimento"
            somenteLeitura={paciente.status === 'bloqueado'}
          />
        </section>
        <nav aria-labelledby="atalhos" className="space-y-2">
          <h2 id="atalhos" className="text-lg font-semibold">Neste atendimento</h2>
          <ul className="space-y-1">
            <li><Link href={`${base}/anamnese`} className="text-link underline">Anamnese</Link></li>
            <li><Link href={`${base}/antropometria?atendimento=${a.id}`} className="text-link underline">Antropometria</Link></li>
            <li><Link href={`${base}/gasto-energetico`} className="text-link underline">Gasto energético</Link></li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
