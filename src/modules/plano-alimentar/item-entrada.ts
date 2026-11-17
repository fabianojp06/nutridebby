import { z } from 'zod';
import type { MedidaDoItem } from '@/db/schema';
import { gramasDaMedida, QTD_MEDIDA_MAX } from '@/modules/alimentos/medidas-constantes';
import { idValido } from '@/modules/pacientes/base';
import { arredondar } from '@/lib/numero';
import { lerQuantidade } from './calculo';
import { MSG_PLANO } from './constantes';

/**
 * Plano 19 (RN-250/RN-251: "mesmas regras de `meal_items`"): a leitura de um item como o editor manda, uma só para o
 * PUT do rascunho (`salvarRascunho`), "Minhas refeições" e as listas de substituição. Mudar a faixa de gramas, o schema
 * da medida ou o arredondamento aqui muda os três juntos.
 */
export const medidaSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  plural: z.string().trim().min(1).max(60),
  gramas: z.number().min(0.1).max(5000),
  qtd: z.number().gt(0).max(QTD_MEDIDA_MAX),
});

/** O item lido; `quantidadeG: null` quando a quantidade (ou a medida) tem erro, `valido: false` quando há qualquer erro. */
export type LeituraDoItem = { chave: string; foodId: string; quantidadeG: number | null; medida: MedidaDoItem | null; valido: boolean };

/**
 * Quantidade em gramas (0,1 a 5000, gravada com 2 casas, como a coluna `numeric(7,2)`: com 3 ou mais casas, o valor
 * gravado nunca bateria com o enviado — UPDATE e audit_log a cada salvamento) ou pela medida caseira (gramas =
 * quantidade × gramas da medida). Os erros vão para `erros` com as chaves do editor (`item:<id da tela>:foodId|
 * quantidadeG|medida`); com a medida fora do formato, só o erro da medida (não o da quantidade).
 */
export function lerCamposDoItem(i: Record<string, unknown>, erros: Record<string, string>): LeituraDoItem {
  const chave = `item:${i.id}`;
  let valido = true;
  if (!idValido(i.foodId)) {
    erros[`${chave}:foodId`] = MSG_PLANO.alimento;
    valido = false;
  }
  let medida: MedidaDoItem | null = null;
  let gramas: number | null;
  if (i.medida !== null && i.medida !== undefined) {
    const m = medidaSchema.safeParse(i.medida);
    if (!m.success) {
      erros[`${chave}:medida`] = MSG_PLANO.quantidade;
      return { chave, foodId: i.foodId as string, quantidadeG: null, medida: null, valido: false };
    }
    medida = m.data;
    gramas = lerQuantidade(gramasDaMedida(m.data.qtd, m.data.gramas));
  } else {
    const g = lerQuantidade(i.quantidadeG);
    gramas = g === null ? null : arredondar(g, 2);
  }
  if (gramas === null) {
    erros[`${chave}:quantidadeG`] = MSG_PLANO.quantidade;
    valido = false;
  }
  return { chave, foodId: i.foodId as string, quantidadeG: gramas, medida, valido };
}

export type ItemLido = { chave: string; foodId: string; quantidadeG: number; medida: MedidaDoItem | null };

/** A biblioteca ("Minhas refeições", listas) só segue com o item sem erro: `null` quando o item tem erro. */
export function lerItem(i: Record<string, unknown>, erros: Record<string, string>): ItemLido | null {
  const l = lerCamposDoItem(i, erros);
  return l.valido && l.quantidadeG !== null ? { chave: l.chave, foodId: l.foodId, quantidadeG: l.quantidadeG, medida: l.medida } : null;
}
