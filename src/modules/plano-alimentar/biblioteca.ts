import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '@/db/client';
import { foods, tenants, type MedidaDoItem } from '@/db/schema';
import { seloDaFonte } from '@/modules/alimentos/fontes';
import { medidasDeVarios } from '@/modules/alimentos/medidas';
import { gramasDaMedida, QTD_MEDIDA_MAX, textoMedida } from '@/modules/alimentos/medidas-constantes';
import { microsDoCatalogo } from '@/modules/alimentos/nutrientes';
import { idValido } from '@/modules/pacientes/base';
import { arredondar } from '@/lib/numero';
import { lerQuantidade } from './calculo';
import { MSG_PLANO } from './constantes';
import type { ItemPlano } from './tipos';

/**
 * Plano 19 (RN-250/RN-251/RN-258): o que "Minhas refeições" (`refeicoes-modelo.ts`) e as listas de substituição
 * (`listas.ts`) têm em comum — a leitura do item como o editor manda (mesmas regras de `meal_items`), a conferência de
 * que cada alimento é visível na sessão antes de gravar, a trava do consultório para os limites e os valores atuais dos
 * alimentos (RN-11: a biblioteca não guarda cópia congelada).
 */

const medidaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  plural: z.string().trim().min(1).max(60),
  gramas: z.number().min(0.1).max(5000),
  qtd: z.number().gt(0).max(QTD_MEDIDA_MAX),
});

export type ItemLido = { chave: string; foodId: string; quantidadeG: number; medida: MedidaDoItem | null };

/**
 * O item como o PUT do editor (`salvarRascunho`, D7): quantidade em gramas (0,1 a 5000, gravada com 2 casas, como a
 * coluna `numeric(7,2)`) ou pela medida caseira (gramas = quantidade × gramas da medida). Os erros vão para `erros`
 * com as chaves do editor (`item:<id da tela>:foodId|quantidadeG|medida`); `null` quando o item tem erro.
 */
export function lerItem(i: Record<string, unknown>, erros: Record<string, string>): ItemLido | null {
  const ci = `item:${i.id}`;
  let ok = true;
  if (!idValido(i.foodId)) {
    erros[`${ci}:foodId`] = MSG_PLANO.alimento;
    ok = false;
  }
  let medida: MedidaDoItem | null = null;
  let gramas: number | null;
  if (i.medida !== null && i.medida !== undefined) {
    const m = medidaSchema.safeParse(i.medida);
    if (!m.success) {
      erros[`${ci}:medida`] = MSG_PLANO.quantidade;
      return null;
    }
    medida = m.data;
    gramas = lerQuantidade(gramasDaMedida(m.data.qtd, m.data.gramas));
  } else {
    const g = lerQuantidade(i.quantidadeG);
    gramas = g === null ? null : arredondar(g, 2);
  }
  if (gramas === null) {
    erros[`${ci}:quantidadeG`] = MSG_PLANO.quantidade;
    return null;
  }
  return ok ? { chave: ci, foodId: i.foodId as string, quantidadeG: gramas, medida } : null;
}

/**
 * RN-258: a FK `food_id` (RESTRICT) não passa pela RLS — um id de "Meu alimento" de outro consultório seria aceito e
 * prenderia a exclusão do dono. Antes de gravar, cada alimento precisa ser visível nesta sessão (molde da conferência
 * `visiveis` de `salvarRascunho`). Devolve os erros por item (`item:<id>:foodId`), vazio quando todos são visíveis.
 */
export async function alimentosInvisiveis(tx: Tx, itens: ItemLido[]): Promise<Record<string, string>> {
  const ids = [...new Set(itens.map((i) => i.foodId))];
  // sem trava de linha: FOR KEY SHARE aplicaria as políticas de UPDATE e esconderia a TACO (só `taco_leitura`); o
  // "Meu alimento" excluído entre esta leitura e o INSERT cai na FK (o módulo devolve o erro do alimento, não um 500)
  const visiveis = new Set(ids.length ? (await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, ids))).map((f) => f.id) : []);
  return Object.fromEntries(itens.filter((i) => !visiveis.has(i.foodId)).map((i) => [`${i.chave}:foodId`, MSG_PLANO.alimento]));
}

/**
 * Limite por consultório sem TOCTOU: o tenant travado `FOR NO KEY UPDATE` (nunca `FOR UPDATE`: as FKs para `tenants`
 * pegam KEY SHARE) antes de contar; dois salvamentos ao mesmo tempo no limite contam um depois do outro.
 */
export async function travarConsultorio(tx: Tx, tenantId: string): Promise<void> {
  await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for('no key update');
}

type ItemGravado = { id: string; foodId: string; quantidadeG: number; medida: MedidaDoItem | null; substituiItemId: string | null };

/**
 * Os itens com os valores atuais dos alimentos (RN-11, como o rascunho: nome, fonte, valores por 100 g, micros e as
 * medidas para trocar), no formato do editor (`ItemPlano`). Alimento que não é mais visível fica de fora.
 */
export async function itensComValoresAtuais(tx: Tx, itens: ItemGravado[]): Promise<ItemPlano[]> {
  if (!itens.length) return [];
  const ids = [...new Set(itens.map((i) => i.foodId))];
  const fs = new Map(
    (
      await tx
        .select({ id: foods.id, nome: foods.nome, fonte: foods.fonte, kcal: foods.kcal, proteinaG: foods.proteinaG, carboidratoG: foods.carboidratoG, lipidioG: foods.lipidioG, fibraG: foods.fibraG, micros: foods.micros })
        .from(foods)
        .where(inArray(foods.id, ids))
    ).map((f) => [f.id, f]),
  );
  const medidas = await medidasDeVarios(tx, ids);
  return itens.flatMap((i) => {
    const f = fs.get(i.foodId);
    if (!f) return [];
    return [
      {
        id: i.id,
        foodId: i.foodId,
        nome: f.nome,
        fonte: f.fonte,
        origem: seloDaFonte(f.fonte),
        porCem: { kcal: f.kcal, proteinaG: f.proteinaG, carboidratoG: f.carboidratoG, lipidioG: f.lipidioG, fibraG: f.fibraG },
        micros: microsDoCatalogo(f.micros),
        medidas: medidas.get(i.foodId) ?? [],
        quantidadeG: i.quantidadeG,
        medida: i.medida ?? null,
        medidaCaseiraTxt: i.medida ? textoMedida(i.medida.qtd, i.medida) : null,
        substituiItemId: i.substituiItemId,
      },
    ];
  });
}
