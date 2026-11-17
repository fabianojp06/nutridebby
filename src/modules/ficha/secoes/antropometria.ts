import { desc, eq } from 'drizzle-orm';
import { anthropometry } from '@/db/schema';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { LIMITE_DA_SECAO, resumoDasLinhas, totalJunto } from './comum';

/** Antropometria: "Avaliação" e a data (sem as medidas: o cabeçalho é que mostra a última, com a leitura auditada). */
export const secaoAntropometria: SecaoDaFicha = {
  id: 'antropometria',
  titulo: MSG_FICHA.titulos.antropometria,
  aba: 'antropometria',
  disponivel: () => true,
  async resumo(tx, patientId) {
    const linhas = await tx
      .select({ id: anthropometry.id, data: anthropometry.data, total: totalJunto() })
      .from(anthropometry)
      .where(eq(anthropometry.patientId, patientId))
      .orderBy(desc(anthropometry.data), desc(anthropometry.createdAt), desc(anthropometry.id))
      .limit(LIMITE_DA_SECAO);
    return resumoDasLinhas(linhas, (a) => ({ id: a.id, rotulo: MSG_FICHA.rotulos.avaliacao, data: a.data, href: 'antropometria' }));
  },
  adicionar: [{ grupo: 'avaliacoes', rotulo: MSG_FICHA.itens.antropometria, destino: { href: 'antropometria#nova-avaliacao' } }],
};
