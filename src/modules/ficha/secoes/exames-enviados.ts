import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { examSubmissions, patients } from '@/db/schema';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { diaNoFuso, LIMITE_DA_SECAO, resumoDasLinhas, totalJunto } from './comum';

type StatusEnvio = keyof typeof MSG_FICHA.situacaoDoEnvio;

/**
 * Situações em que a página da revisão (/painel/exames-recebidos/{id}) diz algo certo: "recebido" abre a revisão, "aceito" e
 * "recusado" mostram "Este envio já foi revisado.". Nas outras (processando, expirado, falhou) a página diria o mesmo sem
 * ninguém ter revisado: o item leva à aba Exames do paciente (revisão final do PR 1 do Plano 18).
 */
const ABRE_A_REVISAO: ReadonlySet<StatusEnvio> = new Set(['recebido', 'aceito', 'recusado']);

/**
 * Exames enviados pelo paciente (Plano 12): "Envio do paciente", o dia do envio e a situação (sem nome, observação nem
 * motivo). Fora o cancelado (RN-192: "envio não cancelado"); como a fila e os contadores do painel, nada do titular
 * bloqueado ou anonimizado. O item abre fora da ficha, na revisão do envio (fora de recebido, aceito e recusado, na aba
 * Exames); o "Ver todos" é a aba Exames (RN-277).
 */
export const secaoExamesEnviados: SecaoDaFicha = {
  id: 'exames-enviados',
  titulo: MSG_FICHA.titulos.examesEnviados,
  aba: 'exames',
  // RN-192: só com o recebimento ligado ou algum envio
  disponivel: (t, _p, total) => t.examesPacienteAtivadoEm !== null || total > 0,
  async resumo(tx, patientId, fuso) {
    const linhas = await tx
      .select({ id: examSubmissions.id, status: examSubmissions.status, enviadoEm: examSubmissions.createdAt, total: totalJunto() })
      .from(examSubmissions)
      .innerJoin(patients, and(eq(patients.tenantId, examSubmissions.tenantId), eq(patients.id, examSubmissions.patientId)))
      .where(and(eq(examSubmissions.patientId, patientId), ne(examSubmissions.status, 'cancelado'), ne(patients.status, 'bloqueado'), isNull(patients.anonimizadoEm)))
      .orderBy(desc(examSubmissions.createdAt))
      .limit(LIMITE_DA_SECAO);
    return resumoDasLinhas(linhas, (e) => ({
      id: e.id,
      rotulo: MSG_FICHA.rotulos.envio,
      data: diaNoFuso(e.enviadoEm, fuso),
      situacao: MSG_FICHA.situacaoDoEnvio[e.status as StatusEnvio],
      href: ABRE_A_REVISAO.has(e.status as StatusEnvio) ? `/painel/exames-recebidos/${e.id}` : 'exames',
    }));
  },
};
