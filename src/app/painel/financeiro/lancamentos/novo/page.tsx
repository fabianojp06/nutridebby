import { notFound, redirect } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { lerConfiguracoes, listarCategorias } from '@/modules/financeiro/configuracoes';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { pacienteDoFinanceiro, pacientesParaLancamento } from '@/modules/financeiro/lancamentos';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { TopoDoFinanceiro } from '../../topo';
import { FormLancamento } from '../form-lancamento';

export const dynamic = 'force-dynamic';

/**
 * US-301: "Nova entrada" / "Nova saída" (`?tipo=entrada|saida[&paciente=<id>]`, §4.1). Sem configuração (RN-301), qualquer
 * tipo leva às Configurações com o aviso. O paciente da URL vem escolhido se puder receber lançamento (ativo ou arquivado,
 * F-D28); bloqueado → sem paciente e com o aviso da §6.2; de outro consultório, inválido ou anonimizado → sem paciente.
 * Na saída, `paciente` é ignorado (F-D24). A action confere tudo de novo sob a trava (RN-317).
 */
export default async function NovoLancamento({
  searchParams,
}: PageProps<'/painel/financeiro/lancamentos/novo'>) {
  const { ctx, tenant } = await requireNutri('/painel/financeiro/lancamentos/novo');
  const parametros = await searchParams;
  if (!(await lerConfiguracoes(ctx)))
    redirect('/painel/financeiro/configuracoes?aviso=informeSaldo');
  const tipo =
    parametros.tipo === 'entrada' || parametros.tipo === 'saida' ? parametros.tipo : notFound();
  const pedido =
    tipo === 'entrada' && typeof parametros.paciente === 'string' ? parametros.paciente : '';
  const [categorias, pacientes] = await Promise.all([
    listarCategorias(ctx),
    tipo === 'entrada' ? pacientesParaLancamento(ctx) : undefined,
  ]);
  const escolhido = pacientes?.some((p) => p.id === pedido) ? pedido : '';
  const bloqueado =
    !!pedido && !escolhido && !!(await pacienteDoFinanceiro(ctx, pedido))?.bloqueado;
  const ativas = categorias
    .filter((c) => c.tipo === tipo && c.arquivadaEm === null)
    .map((c) => ({ id: c.id, nome: c.nome }));
  const hoje = hojeNoFuso(tenant.fuso);
  return (
    <>
      <TopoDoFinanceiro
        titulo={tipo === 'entrada' ? M.novaEntrada : M.novaSaida}
        parametros={parametros}
      />
      {bloqueado && (
        <Aviso tipo="aviso" papel="nenhum">
          {M.bloqueado}
        </Aviso>
      )}
      <FormLancamento
        tipo={tipo}
        categorias={ativas}
        pacientes={pacientes}
        hoje={hoje}
        inicial={{
          valor: '',
          categoriaId: ativas[0]?.id ?? '',
          vencimento: hoje,
          pacienteId: escolhido,
          descricao: '',
          jaFoi: '',
          pagoEm: '',
          forma: '',
        }}
      />
    </>
  );
}
