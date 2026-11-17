import { desc, eq } from 'drizzle-orm';
import { energyCalcs } from '@/db/schema';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { diaNoFuso, LIMITE_DA_SECAO, resumoDasLinhas, totalJunto } from './comum';

/** Gasto energético: "Cálculo" e o dia do cálculo no fuso (sem fórmula nem resultado). */
export const secaoGastoEnergetico: SecaoDaFicha = {
  id: 'gasto-energetico',
  titulo: MSG_FICHA.titulos.gastoEnergetico,
  aba: 'gasto-energetico',
  disponivel: () => true,
  async resumo(tx, patientId, fuso) {
    const linhas = await tx
      .select({ id: energyCalcs.id, criadoEm: energyCalcs.createdAt, total: totalJunto() })
      .from(energyCalcs)
      .where(eq(energyCalcs.patientId, patientId))
      .orderBy(desc(energyCalcs.createdAt))
      .limit(LIMITE_DA_SECAO);
    return resumoDasLinhas(linhas, (c) => ({ id: c.id, rotulo: MSG_FICHA.rotulos.calculo, data: diaNoFuso(c.criadoEm, fuso), href: 'gasto-energetico' }));
  },
  adicionar: [{ grupo: 'avaliacoes', rotulo: MSG_FICHA.itens.gastoEnergetico, destino: { href: 'gasto-energetico#novo-calculo' } }],
};
