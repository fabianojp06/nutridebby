import { z } from 'zod';
import { gramasDaMedida, QTD_MEDIDA_MAX } from '@/modules/alimentos/medidas-constantes';
import { lerQuantidade } from '@/modules/plano-alimentar/calculo';
import { MAX_ITENS, MAX_REFEICOES, MAX_TEXTO, META_MAX, META_MIN } from '@/modules/plano-alimentar/constantes';
import type { CatalogoDaTarefa } from './ferramentas-alimentos';
import type { ItemIa, PlanoIa, RefeicaoIa } from './tipos';

/**
 * Plano 14B (RN-121, RN-124, D14): o plano que a IA sugere, revalidado contra o catálogo da tarefa. O resultado guarda
 * só ids REAIS de alimento e gramas — nunca nome nem número do modelo; totais, indicador e macros são sempre do calculo.ts.
 * Os tipos moram em `tipos.ts` (o schema do banco os usa em `ia_tarefas.resultado`); daqui, só reexportados.
 */
export type { ItemIa, PlanoIa, RefeicaoIa } from './tipos';

const MAX_TITULO = 120;
const MAX_NOME_REFEICAO = 60;

const SCHEMA_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['alimento', 'gramas', 'medida', 'substitui'],
  properties: {
    alimento: { type: 'string' },
    gramas: { type: 'number' },
    medida: {
      anyOf: [
        { type: 'null' },
        { type: 'object', additionalProperties: false, required: ['indice', 'quantidade'], properties: { indice: { type: 'integer' }, quantidade: { type: 'number' } } },
      ],
    },
    substitui: { anyOf: [{ type: 'null' }, { type: 'integer' }] },
  },
};
/** Sem limites no JSON Schema (a API não os aceita, §5.1): os limites ficam no Zod e em `validarPlanoIa`. */
export const SCHEMA_PLANO_IA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'meta_kcal', 'orientacoes', 'refeicoes'],
  properties: {
    titulo: { type: 'string' },
    meta_kcal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    orientacoes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    refeicoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nome', 'horario', 'itens'],
        properties: { nome: { type: 'string' }, horario: { type: 'string' }, itens: { type: 'array', items: SCHEMA_ITEM } },
      },
    },
  },
} as const satisfies Record<string, unknown>;

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

// §5.8 (camada 3), no molde de `resposta-leitura.ts`: link de qualquer esquema ou www. tira a palavra inteira que o contém
// (só literais, custo linear); controle C0/C1 vira espaço; formatação invisível e surrogate solto somem ANTES da busca de
// links ("ht​tps://…"). Diferente da leitura, as quebras de linha ficam (orientações têm parágrafos).
const LINK = /:\/\/|www\./i;
const INVISIVEL = /[\p{Cf}\p{Cs}]/gu;
const CONTROLE_MENOS_QUEBRA = /[^\S\n]|(?!\n)\p{Cc}/gu;

/** Texto da IA → texto puro: sem link, sem controle nem invisível, espaços colapsados, até duas quebras seguidas. */
export function limparTexto(s: string): string {
  return s
    .normalize('NFC')
    .replace(INVISIVEL, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROLE_MENOS_QUEBRA, ' ')
    .split('\n')
    .map((linha) =>
      linha
        .split(' ')
        .filter((p) => p && !LINK.test(p))
        .join(' '),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/** Título e nome de refeição (e nome, pergunta, unidade e opção da anamnese do pacote de modelos): uma linha só. */
export const limparLinha = (s: string): string => limparTexto(s).replace(/\n+/g, ' ');

const brutoSchema = z.object({
  titulo: z.string(),
  meta_kcal: z.number().nullable(),
  orientacoes: z.string().nullable(),
  refeicoes: z
    .array(
      z.object({
        nome: z.string(),
        horario: z.string(),
        itens: z.array(
          z.object({
            alimento: z.string(),
            gramas: z.number(),
            medida: z.object({ indice: z.number().int(), quantidade: z.number() }).nullable(),
            substitui: z.number().int().nullable(),
          }),
        ),
      }),
    )
    .max(MAX_REFEICOES),
});
type ItemBruto = z.infer<typeof brutoSchema>['refeicoes'][number]['itens'][number];

/**
 * Revalida o plano devolvido pelo modelo (JSON em texto ou já lido). Fora do formato ou acima dos limites do plano inteiro
 * (refeições, itens, título, orientações) → `null`. Item inválido (alimento não buscado, gramas fora de 0,1–5000, medida
 * inexistente, substituição sem principal válido) sai e é contado em `descartados`; refeição com nome ou horário inválido
 * ou sem item principal válido sai inteira (os itens dela contam).
 */
export function validarPlanoIa(bruto: unknown, cat: CatalogoDaTarefa): PlanoIa | null {
  let obj = bruto;
  if (typeof bruto === 'string') {
    try {
      obj = JSON.parse(bruto);
    } catch {
      return null;
    }
  }
  const p = brutoSchema.safeParse(obj);
  if (!p.success) return null;
  if (p.data.refeicoes.reduce((n, r) => n + r.itens.length, 0) > MAX_ITENS) return null;
  const titulo = limparLinha(p.data.titulo);
  const orientacoes = limparTexto(p.data.orientacoes ?? '');
  if (!titulo || titulo.length > MAX_TITULO || orientacoes.length > MAX_TEXTO) return null;
  const meta = p.data.meta_kcal;
  let descartados = 0;
  const refeicoes: RefeicaoIa[] = [];
  for (const r of p.data.refeicoes) {
    const nome = limparLinha(r.nome);
    if (!nome || nome.length > MAX_NOME_REFEICAO || !HORARIO.test(r.horario)) {
      descartados += r.itens.length;
      continue;
    }
    // principais primeiro: `substitui` é a posição (1…n) do principal na lista que o modelo mandou
    const novoIndice = new Map<number, number>();
    const itens: ItemIa[] = [];
    r.itens.forEach((it, pos) => {
      if (it.substitui !== null) return;
      const v = itemValido(it, cat);
      if (!v) return void descartados++;
      novoIndice.set(pos + 1, itens.length);
      itens.push(v);
    });
    r.itens.forEach((it) => {
      if (it.substitui === null) return;
      const principal = novoIndice.get(it.substitui);
      const v = itemValido(it, cat);
      if (principal === undefined || !v) return void descartados++;
      itens.push({ ...v, substitui: principal });
    });
    if (!itens.some((i) => i.substitui === null)) {
      descartados += itens.length;
      continue;
    }
    refeicoes.push({ nome, horario: r.horario, itens });
  }
  return { titulo, metaKcal: meta !== null && meta >= META_MIN && meta <= META_MAX ? Math.round(meta) : null, orientacoes, refeicoes, descartados };
}

/** Com medida, os gramas são do sistema (quantidade × gramas da medida); os do modelo são ignorados. */
function itemValido(it: ItemBruto, cat: CatalogoDaTarefa): ItemIa | null {
  const a = cat.porLocal.get(it.alimento);
  if (!a) return null;
  if (it.medida) {
    const m = a.medidas[it.medida.indice - 1];
    if (!m || !(it.medida.quantidade > 0) || it.medida.quantidade > QTD_MEDIDA_MAX) return null;
    const g = lerQuantidade(gramasDaMedida(it.medida.quantidade, m.gramas));
    return g === null ? null : { foodId: a.id, quantidadeG: g, medida: { nome: m.nome, plural: m.plural, gramas: m.gramas, qtd: it.medida.quantidade }, substitui: null };
  }
  const g = lerQuantidade(it.gramas);
  return g === null ? null : { foodId: a.id, quantidadeG: Math.round(g * 100) / 100, medida: null, substitui: null };
}
