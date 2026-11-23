import { getDb } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { configuracaoNaTransacao } from '@/modules/financeiro/configuracoes';
import { porCategoriaNoPeriodo, recebidoEPagoPorMes } from '@/modules/financeiro/resumo';
import { prepararSecao, type DepsRel, type OpcoesRel, type TenantRel } from './comum';
import type { Periodo } from './periodo';
import type { RelFinanceiro } from './tipos';

/**
 * US-484 (RN-491): "Recebido", "Pago" (e o "Resultado", que a tela calcula) por mês e "Por categoria", numa transação, só
 * pelas funções do módulo do Financeiro (nenhuma consulta a `fin_*` aqui, RN-491/RE-D68). Sem a configuração do
 * Financeiro, o estado vazio da US-484. Nutricionista; a recepção só com a permissão (RN-480, T11b).
 */
export async function relatorioFinanceiro(ctx: TenantContext, tenant: TenantRel, p: Periodo, o: OpcoesRel, deps: DepsRel = {}): Promise<RelFinanceiro> {
  prepararSecao(ctx, tenant, 'financeiro', p, o);
  return withTenant(
    ctx,
    async (tx) => {
      if (!(await configuracaoNaTransacao(tx))) return { configurado: false };
      const meses = await recebidoEPagoPorMes(tx, ctx.tenantId, p);
      return { configurado: true, meses, porCategoria: await porCategoriaNoPeriodo(tx, ctx.tenantId, p) };
    },
    deps.db ?? getDb(),
  );
}
