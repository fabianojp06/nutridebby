import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import type { TenantDeTeste } from './pacientes';

/** `itens[].substitui` = índice do item principal que este substitui (US-024). Todos com o alimento 3 da TACO. */
export type RefeicaoDeTeste = { nome: string; horario: string; observacao?: string; itens?: { gramas: number; substitui?: number }[] };

/**
 * Plano publicado pela nutricionista (US-022/US-025), pelos serviços de verdade (rascunho → publicar). A publicação troca o
 * status no lugar (os ids das refeições ficam) e enfileira o PDF: quem usa precisa de stopBoss() + closeDb() no afterAll.
 */
export async function planoPublicado(
  db: Db,
  T: TenantDeTeste,
  patientId: string,
  o: { refeicoes?: RefeicaoDeTeste[]; mostrarCalorias?: boolean; orientacoes?: string } = {},
): Promise<{ planId: string; refeicoes: { id: string; nome: string; horario: string }[] }> {
  const refeicoes = o.refeicoes ?? [{ nome: 'Almoço', horario: '12:30' }];
  const { id } = await criarRascunho(T.ctx, patientId, { db });
  const [r] = await withTenant(T.ctx, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(eq(mealPlans.id, id)), db);
  const comIds = refeicoes.map((ref) => {
    const itens = ref.itens ?? [{ gramas: 100 }];
    const idsDosItens = itens.map(() => randomUUID());
    return {
      id: randomUUID(),
      nome: ref.nome,
      horario: ref.horario,
      observacao: ref.observacao ?? '',
      itens: itens.map((it, k) => ({
        id: idsDosItens[k],
        foodId: idTaco(3),
        quantidadeG: String(it.gramas),
        medida: null,
        substituiItemId: it.substitui === undefined ? null : idsDosItens[it.substitui],
      })),
    };
  });
  await salvarRascunho(
    T.ctx,
    id,
    { revisao: r.revisao, envio: randomUUID(), titulo: 'Plano de teste', metaKcal: '', mostrarCalorias: o.mostrarCalorias ?? false, orientacoes: o.orientacoes ?? '', refeicoes: comIds },
    { db },
  );
  await publicarPlano(T.ctx, patientId, id, { db });
  return { planId: id, refeicoes: comIds.map((x) => ({ id: x.id, nome: x.nome, horario: x.horario })) };
}
