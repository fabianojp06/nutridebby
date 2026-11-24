import { and, count, eq, gt } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { listarAgendaNaTransacao, type Consulta } from './consultas';
import { inicioDoDia } from './fuso';
import { contarPendenciasDePresencaNaTransacao, novidadesDaAgendaNaTransacao, pendenciasDePresencaNaTransacao, type Novidades } from './presenca';

/** Quantas consultas sem registro de presença o cartão "Presença a registrar" lista (a lista inteira fica em "Pendências"). */
export const PRESENCA_NO_INICIO = 5;

/**
 * Plano 26 (RN-514, RE-D63): o Início da recepção — o trabalho do dia, sem indicador do mês. Só agenda: nada de diário,
 * acesso ao app, armazenamento, WhatsApp, IA, exames, dúvidas, documentos ou pedidos do titular (as tabelas são negadas a
 * ela; o teste das chaves em inicio-recepcao.test.ts). A leitura da agenda não chama `auditRead` (D10 do Plano 05).
 */
export type InicioDaRecepcao = {
  /** "Agenda de hoje": as consultas de hoje no fuso do consultório, sem as canceladas e sem os pedidos (`solicitada`). */
  agendaDeHoje: Consulta[];
  /** "Presença a registrar": as `PRESENCA_NO_INICIO` mais antigas sem registro (D21) e o total. Para ela, só "Faltou". */
  presenca: { total: number; consultas: Consulta[] };
  /**
   * "Solicitações": os pedidos de paciente cadastrado ainda no prazo de resposta (Plano 23, RN-420/RN-427: consulta
   * `solicitada` com `inicio − antecedência > agora`). O pedido de pessoa nova mora em `public_booking_requests`, negada à
   * recepção, e fica com a nutricionista (RE-D59): não é lido nem contado.
   */
  solicitacoes: number;
  /** "O que os pacientes fizeram na agenda": pedidos de remarcação e marcadas ou canceladas pelo paciente em 7 dias. */
  novidades: Novidades;
};

/** Tudo numa transação (uma conexão por abertura do Início, como o `lerInicio` da nutricionista). Só a sessão da recepção. */
export async function inicioDaRecepcao(
  ctx: TenantContext,
  tenant: Pick<TenantRow, 'fuso' | 'antecedenciaMinH'>,
  agora: Date,
  db: Db = getDb(),
): Promise<InicioDaRecepcao> {
  if (ctx.role !== 'recepcao') throw new Error('o Início da recepção é só da sessão da recepção');
  return withTenant(
    ctx,
    async (tx) => {
      const hoje = hojeNoFuso(tenant.fuso, agora);
      const doDia = await listarAgendaNaTransacao(tx, inicioDoDia(hoje, tenant.fuso), inicioDoDia(somarDias(hoje, 1), tenant.fuso));
      const prazo = new Date(agora.getTime() + tenant.antecedenciaMinH * 3_600_000);
      const [s] = await tx.select({ n: count() }).from(appointments).where(and(eq(appointments.status, 'solicitada'), gt(appointments.inicio, prazo)));
      return {
        // o status 'solicitada' (Plano 23) ainda não está no tipo StatusConsulta: a comparação é pelo texto
        agendaDeHoje: doDia.filter((c) => c.status !== 'cancelada' && (c.status as string) !== 'solicitada'),
        presenca: { total: await contarPendenciasDePresencaNaTransacao(tx, agora), consultas: await pendenciasDePresencaNaTransacao(tx, agora, PRESENCA_NO_INICIO) },
        solicitacoes: s.n,
        novidades: await novidadesDaAgendaNaTransacao(tx, agora),
      };
    },
    db,
  );
}
