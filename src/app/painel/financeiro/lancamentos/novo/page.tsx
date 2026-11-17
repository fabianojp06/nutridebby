import { notFound, redirect } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { formularioNovo } from '@/modules/financeiro/telas';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { TopoDoFinanceiro } from '../../topo';
import { FormLancamento } from '../form-lancamento';

export const dynamic = 'force-dynamic';

/**
 * US-301: "Nova entrada" / "Nova saída" (`?tipo=entrada|saida[&paciente=<id>]`, §4.1). Sem configuração (RN-301), qualquer
 * tipo leva às Configurações com o aviso. O paciente da URL vem escolhido se puder receber lançamento (ativo ou arquivado,
 * F-D28); bloqueado → sem paciente e com o aviso da §6.2; de outro consultório, inválido ou anonimizado → sem paciente.
 * Na saída, `paciente` é ignorado (F-D24). A action confere tudo de novo sob a trava (RN-317). RNF-301: `formularioNovo`
 * lê tudo numa transação.
 */
export default async function NovoLancamento({
  searchParams,
}: PageProps<'/painel/financeiro/lancamentos/novo'>) {
  const { ctx, tenant } = await requireNutri('/painel/financeiro/lancamentos/novo');
  const parametros = await searchParams;
  const tipoDaUrl =
    parametros.tipo === 'entrada' || parametros.tipo === 'saida' ? parametros.tipo : null;
  // RNF-301: configuração, categorias, pacientes e o bloqueio do paciente pedido numa transação só
  const form = await formularioNovo(
    ctx,
    tipoDaUrl,
    typeof parametros.paciente === 'string' ? parametros.paciente : undefined,
  );
  if (!form) redirect('/painel/financeiro/configuracoes?aviso=informeSaldo');
  const tipo = tipoDaUrl ?? notFound();
  const { categorias: ativas, pacientes, escolhido, bloqueado } = form;
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
