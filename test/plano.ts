import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import type { TenantDeTeste } from './pacientes';

/**
 * `itens[].substitui` = índice do item principal que este substitui (US-024). `taco` = o alimento da TACO (padrão: o 3);
 * `foodId` = outro alimento (ex.: um "Meu alimento"). Plano 19: `dias` (0 = domingo; ausente = os 7) e `descricaoLivre`
 * (plano em texto livre, `modo: 'livre'`, com `itens: []`).
 */
export type RefeicaoDeTeste = {
  nome: string;
  horario: string;
  observacao?: string;
  dias?: number[];
  descricaoLivre?: string;
  itens?: { gramas: number; substitui?: number; taco?: number; foodId?: string }[];
};

/**
 * Plano publicado pela nutricionista (US-022/US-025), pelos serviços de verdade (rascunho → publicar). A publicação troca o
 * status no lugar (os ids das refeições ficam) e enfileira o PDF: quem usa precisa de stopBoss() + closeDb() no afterAll.
 */
export async function planoPublicado(
  db: Db,
  T: TenantDeTeste,
  patientId: string,
  o: OpcoesDoPlano = {},
): Promise<PlanoDeTeste> {
  const plano = await planoEmRascunho(db, T, patientId, o);
  // Plano 19 (D31): os avisos (dia sem refeição, texto livre sem VET) são confirmados, como o "Publicar mesmo assim"
  const r = await publicarPlano(T.ctx, patientId, plano.planId, { db });
  if (r.avisos) await publicarPlano(T.ctx, patientId, plano.planId, { db }, { confirmarAvisos: r.avisos });
  return plano;
}

type OpcoesDoPlano = { refeicoes?: RefeicaoDeTeste[]; mostrarCalorias?: boolean; orientacoes?: string; modo?: 'calculado' | 'livre' };
type PlanoDeTeste = { planId: string; refeicoes: { id: string; nome: string; horario: string }[] };

/** O rascunho salvo (ainda não publicado), com as refeições — o que `planoPublicado` publica em seguida. */
export async function planoEmRascunho(db: Db, T: TenantDeTeste, patientId: string, o: OpcoesDoPlano = {}): Promise<PlanoDeTeste> {
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
      ...(ref.dias ? { diasSemana: ref.dias } : {}),
      ...(ref.descricaoLivre !== undefined ? { descricaoLivre: ref.descricaoLivre } : {}),
      itens: itens.map((it, k) => ({
        id: idsDosItens[k],
        foodId: it.foodId ?? idTaco(it.taco ?? 3),
        quantidadeG: String(it.gramas),
        medida: null,
        substituiItemId: it.substitui === undefined ? null : idsDosItens[it.substitui],
      })),
    };
  });
  await salvarRascunho(
    T.ctx,
    id,
    { revisao: r.revisao, envio: randomUUID(), titulo: 'Plano de teste', metaKcal: '', mostrarCalorias: o.mostrarCalorias ?? false, orientacoes: o.orientacoes ?? '', ...(o.modo ? { modo: o.modo } : {}), refeicoes: comIds },
    { db },
  );
  return { planId: id, refeicoes: comIds.map((x) => ({ id: x.id, nome: x.nome, horario: x.horario })) };
}
