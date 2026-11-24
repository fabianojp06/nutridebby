import { desc, eq } from 'drizzle-orm';
import { exams } from '@/db/schema';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { LIMITE_DA_SECAO, noAppPor, resumoDasLinhas, totalJunto } from './comum';

/**
 * Exames da nutricionista: "Exame" e a data — nunca o título ("Glicemia" é dado de saúde, D14). Plano 22 (T6, RN-387,
 * RN-279 v2, EP-D22): `noApp` conta os exames marcados "Mostrar no app" — no contexto do paciente que `no-app.ts` abre, a
 * política `paciente_exame_liberado` faz o filtro (nenhum filtro em TypeScript além do paciente, RN-281 do 18), a mesma
 * consulta de `examesLiberadosDoPaciente` (sem teto: o portal mostra todos).
 */
export const secaoExames: SecaoDaFicha = {
  id: 'exames',
  titulo: MSG_FICHA.titulos.exames,
  aba: 'exames',
  disponivel: () => true,
  async resumo(tx, patientId) {
    const linhas = await tx
      .select({ id: exams.id, data: exams.data, total: totalJunto() })
      .from(exams)
      .where(eq(exams.patientId, patientId))
      .orderBy(desc(exams.data), desc(exams.createdAt))
      .limit(LIMITE_DA_SECAO);
    return resumoDasLinhas(linhas, (e) => ({ id: e.id, rotulo: MSG_FICHA.rotulos.exame, data: e.data, href: 'exames' }));
  },
  adicionar: [{ grupo: 'avaliacoes', rotulo: MSG_FICHA.itens.exame, destino: { href: 'exames#novo-exame' } }],
  noApp: noAppPor(exams, exams.id, (patientId) => eq(exams.patientId, patientId)),
};
