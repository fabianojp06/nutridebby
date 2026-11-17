import { desc, eq } from 'drizzle-orm';
import { consultations } from '@/db/schema';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { LIMITE_DA_SECAO, resumoDasLinhas, totalJunto } from './comum';

/** Atendimentos: "Atendimento" e a data (sem orientações nem notas). */
export const secaoAtendimentos: SecaoDaFicha = {
  id: 'atendimentos',
  titulo: MSG_FICHA.titulos.atendimentos,
  aba: 'atendimentos',
  disponivel: () => true,
  async resumo(tx, patientId) {
    const linhas = await tx
      .select({ id: consultations.id, data: consultations.data, total: totalJunto() })
      .from(consultations)
      .where(eq(consultations.patientId, patientId))
      .orderBy(desc(consultations.data), desc(consultations.createdAt))
      .limit(LIMITE_DA_SECAO);
    return resumoDasLinhas(linhas, (c) => ({ id: c.id, rotulo: MSG_FICHA.rotulos.atendimento, data: c.data, href: `atendimentos/${c.id}` }));
  },
  adicionar: [{ grupo: 'avaliacoes', rotulo: MSG_FICHA.itens.atendimento, destino: { href: 'atendimentos#novo-atendimento' } }],
};
