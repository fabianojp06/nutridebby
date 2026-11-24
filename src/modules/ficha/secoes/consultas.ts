import { and, asc, desc, eq, gt, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { appointments, consultations } from '@/db/schema';
import { ROTULO_RETORNO_PREVISTO, ROTULO_STATUS, ROTULO_TIPO_CONSULTA, sqlEhRetorno, STATUS_OCUPA, TITULO_SECAO_CONSULTAS } from '@/modules/agenda/status';
import { hojeNoFuso, somarAnos } from '@/modules/pacientes/datas';
import type { SecaoDaFicha } from '../tipos';
import { diaNoFuso, LIMITE_DA_SECAO, noAppPor, totalJunto } from './comum';

/** O teto de "Próximas" em "Minhas consultas" do portal (`consultasDoPaciente`, `limite: 20`): o "No app" conta o mesmo. */
const PROXIMAS_NO_PORTAL = 20;

/**
 * Consulta futura (§4.4): agendada, confirmada ou o pedido (`STATUS_OCUPA`, §4.3) que ainda não terminou — a mesma regra de
 * "Próximas" do portal e do marcador de retorno (`previsoesDeRetorno`).
 */
const futuraDo = (patientId: string, agora: SQL | Date) =>
  and(eq(appointments.patientId, patientId), inArray(appointments.status, [...STATUS_OCUPA]), gt(appointments.fim, agora));

/**
 * Plano 23 (US-411, §4.4): "Consultas" no Início da ficha — só agenda (nome, hora, situação: sem `leitura`, RN-277 do Plano
 * 18, como a P05 D10). `total` = consultas futuras até o fim da Lista filtrada pelo paciente (de hoje a hoje + 12 meses,
 * RN-411: o "Ver todos" mostra as mesmas). Os itens são as próximas em ordem **crescente** — exceção ao "mais recentes
 * primeiro" de `tipos.ts`: aqui o que importa é a próxima consulta —, com "Primeira consulta" ou "Retorno" (`sqlEhRetorno`,
 * RN-416) e a situação. Sem consulta futura, o item "Retorno previsto" com a data do último atendimento com previsão
 * (RN-430; total 1). Sem `adicionar`: o "Marcar consulta" já existe na ficha.
 */
export const secaoConsultas: SecaoDaFicha = {
  id: 'consultas',
  titulo: TITULO_SECAO_CONSULTAS,
  aba: '',
  verTodos: (patientId) => `/painel/agenda?visao=lista&paciente=${patientId}`,
  disponivel: () => true,
  async resumo(tx, patientId, fuso) {
    const agora = new Date();
    // o fim da Lista do paciente: o começo do dia de hoje + 1 ano, no fuso do consultório (periodoDaVisao, RN-411)
    const limite = somarAnos(hojeNoFuso(fuso, agora), 1);
    const linhas = await tx
      .select({
        id: appointments.id,
        inicio: appointments.inicio,
        status: appointments.status,
        retorno: sqlEhRetorno(appointments, consultations).mapWith(Boolean),
        total: totalJunto(),
      })
      .from(appointments)
      .where(and(futuraDo(patientId, agora), sql`${appointments.inicio} < (${limite}::date)::timestamp at time zone ${fuso}`))
      .orderBy(asc(appointments.inicio), asc(appointments.id))
      .limit(LIMITE_DA_SECAO);
    if (linhas.length) {
      return {
        total: linhas[0].total,
        ultimos: linhas.map((c) => ({
          id: c.id,
          rotulo: ROTULO_TIPO_CONSULTA[c.retorno ? 'retorno' : 'primeira'],
          data: diaNoFuso(c.inicio, fuso),
          situacao: ROTULO_STATUS[c.status as keyof typeof ROTULO_STATUS],
          href: `/painel/agenda/consultas/${c.id}`,
        })),
      };
    }
    const [previsao] = await tx
      .select({ id: consultations.id, data: consultations.retornoPrevistoEm })
      .from(consultations)
      .where(and(eq(consultations.patientId, patientId), isNotNull(consultations.retornoPrevistoEm)))
      .orderBy(desc(consultations.data), desc(consultations.createdAt), desc(consultations.id))
      .limit(1);
    if (!previsao?.data) return { total: 0, ultimos: [] };
    return { total: 1, ultimos: [{ id: previsao.id, rotulo: ROTULO_RETORNO_PREVISTO, data: previsao.data, href: `/painel/agenda/nova?paciente=${patientId}` }] };
  },
  // RN-279: as "Próximas" de "Minhas consultas" (portal/agenda.ts), com o mesmo teto e a mesma ordem
  noApp: noAppPor(appointments, appointments.id, (patientId) => futuraDo(patientId, sql`now()`), { limite: PROXIMAS_NO_PORTAL, ordem: appointments.inicio }),
};
