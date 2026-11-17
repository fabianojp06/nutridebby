import { desc, eq } from 'drizzle-orm';
import { anamneses } from '@/db/schema';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { LIMITE_DA_SECAO, resumoDasLinhas, totalJunto } from './comum';

/** Anamneses: "Anamnese" e a data — nunca o nome do modelo ("Anamnese gestante" é dado de saúde, D14). */
export const secaoAnamneses: SecaoDaFicha = {
  id: 'anamneses',
  titulo: MSG_FICHA.titulos.anamneses,
  aba: 'anamnese',
  disponivel: () => true,
  async resumo(tx, patientId) {
    const linhas = await tx
      .select({ id: anamneses.id, data: anamneses.data, total: totalJunto() })
      .from(anamneses)
      .where(eq(anamneses.patientId, patientId))
      .orderBy(desc(anamneses.data), desc(anamneses.createdAt))
      .limit(LIMITE_DA_SECAO);
    return resumoDasLinhas(linhas, (a) => ({ id: a.id, rotulo: MSG_FICHA.rotulos.anamnese, data: a.data, href: `anamnese/${a.id}` }));
  },
  // RN-280: foco no seletor de modelo que já existe na aba (nunca a página "anamnese/nova" sem modelo)
  adicionar: [{ grupo: 'avaliacoes', rotulo: MSG_FICHA.itens.anamnese, destino: { href: 'anamnese#modelo' } }],
};
