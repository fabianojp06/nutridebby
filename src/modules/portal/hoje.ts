import { getDb, type Db } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { TenantAgenda } from '@/modules/agenda/consultas';
import { jaUsavaOAppNaTransacao } from './acesso';
import { examesVisiveis, temEnvioVisivelNaTransacao } from './exames-enviados';
import { miniJornadaNaTransacao } from './jornada';
import type { MiniJornada } from './jornada-regras';
import { pacienteDaSessao } from './sessao';

/**
 * P08-13 (D2 do Plano 16: Hoje = duas transações, o mural e esta): o que a faixa e o aviso de Hoje leem além do mural, numa
 * transação com o contexto do paciente — a mini-jornada (com o auditRead dela), se já abria o app antes de hoje e, com o
 * recebimento de exames desligado, se há envio visível (a seção "Exames", RN-192). `hoje` no fuso do tenant.
 */
export async function faixaDeHoje(
  ctx: TenantContext,
  tenant: TenantAgenda & Pick<TenantRow, 'examesPacienteAtivadoEm'>,
  agora: Date,
  hoje: string,
  db: Db = getDb(),
): Promise<{ mini: MiniJornada; jaUsava: boolean; exames: boolean }> {
  const patientId = pacienteDaSessao(ctx, 'faixaDeHoje');
  return withTenant(
    ctx,
    async (tx) => ({
      mini: await miniJornadaNaTransacao(tx, patientId, tenant, agora),
      jaUsava: await jaUsavaOAppNaTransacao(tx, patientId, hoje),
      exames: await examesVisiveis(tenant, () => temEnvioVisivelNaTransacao(tx, patientId)),
    }),
    db,
  );
}
