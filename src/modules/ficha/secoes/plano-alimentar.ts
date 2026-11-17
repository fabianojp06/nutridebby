import { and, desc, eq, sql } from 'drizzle-orm';
import { mealPlans } from '@/db/schema';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { diaNoFuso, LIMITE_DA_SECAO, noAppPor, resumoDasLinhas, totalJunto } from './comum';

type StatusPlano = keyof typeof MSG_FICHA.situacaoDoPlano;

/** Plano alimentar: as versões do paciente (a mais nova primeiro), com a situação; data = publicação ou criação. */
export const secaoPlanoAlimentar: SecaoDaFicha = {
  id: 'plano-alimentar',
  titulo: MSG_FICHA.titulos.planoAlimentar,
  aba: 'plano-alimentar',
  disponivel: () => true,
  async resumo(tx, patientId, fuso) {
    const linhas = await tx
      .select({ id: mealPlans.id, status: mealPlans.status, quando: sql<Date>`coalesce(${mealPlans.publicadoEm}, ${mealPlans.createdAt})`.mapWith(mealPlans.createdAt), total: totalJunto() })
      .from(mealPlans)
      .where(eq(mealPlans.patientId, patientId))
      .orderBy(desc(mealPlans.versao), desc(mealPlans.createdAt))
      .limit(LIMITE_DA_SECAO);
    return resumoDasLinhas(linhas, (p) => ({
      id: p.id,
      rotulo: MSG_FICHA.rotulos.planoAlimentar,
      data: diaNoFuso(p.quando, fuso),
      situacao: MSG_FICHA.situacaoDoPlano[p.status as StatusPlano],
      href: `plano-alimentar/${p.id}`,
    }));
  },
  adicionar: [{ grupo: 'prescricoes', rotulo: MSG_FICHA.itens.planoAlimentar, destino: { href: 'plano-alimentar' } }],
  // RN-279: só o publicado — a política paciente_sem_rascunho também entrega o arquivado, que `planoDoPaciente` descarta
  noApp: noAppPor(mealPlans, mealPlans.id, (patientId) => and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado'))),
};
