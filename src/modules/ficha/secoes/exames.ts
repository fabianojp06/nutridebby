import { desc, eq } from 'drizzle-orm';
import { exams } from '@/db/schema';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { LIMITE_DA_SECAO, resumoDasLinhas, totalJunto } from './comum';

/** Exames da nutricionista: "Exame" e a data — nunca o título ("Glicemia" é dado de saúde, D14). */
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
};
