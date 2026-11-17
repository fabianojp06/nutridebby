import { z } from 'zod';
import type { Db } from '@/db/client';
import { arredondar } from '@/lib/numero';
import { buscarAlimentos, type AlimentoEncontrado } from '@/modules/alimentos/busca';
import type { Fonte } from '@/modules/alimentos/fontes';
import { distribuicaoMacros, indicadorMeta, totalDoDia, type ItemCalculo } from '@/modules/plano-alimentar/calculo';
import { MAX_ITENS_RASCUNHO_IA, MAX_REFEICOES_RASCUNHO_IA, QUANTIDADE_MAX, QUANTIDADE_MIN } from '@/modules/plano-alimentar/constantes';
import type { ChamadaFerramenta, FerramentaIA } from './provedor';

/**
 * Plano 14B (RN-116, D7): as ferramentas do rascunho e dos modelos sugeridos. Rodam no worker, com o tenant da tarefa;
 * nenhuma grava nada nem lê dado de paciente. O modelo só vê ids LOCAIS da tarefa ("A1", "A2"…): o id do banco nunca sai,
 * e um id real que o modelo inventar não existe no catálogo (o worker remonta pelo mapa).
 */
export type BuscaAlimentos = (termo: string) => Promise<AlimentoEncontrado[]>;
export type CatalogoDaTarefa = { readonly porLocal: Map<string, AlimentoEncontrado>; readonly localDe: Map<string, string> };
export const novoCatalogo = (): CatalogoDaTarefa => ({ porLocal: new Map(), localDe: new Map() });
/**
 * Produção: a busca de sempre, no contexto worker do tenant da tarefa, só com a TACO e os alimentos do consultório (RN-234,
 * Review Focus 5): as ferramentas da IA nunca devolvem alimento da USDA (nem da TBCA). O "Meu alimento" duplicado de uma
 * tabela pública é próprio e entra.
 */
export const FONTES_DA_IA = ['taco', 'propria'] as const satisfies readonly Fonte[];
export const buscaDoTenant =
  (tenantId: string, db: Db): BuscaAlimentos =>
  (termo) =>
    buscarAlimentos({ tenantId, role: 'worker' }, termo, db, { fontes: FONTES_DA_IA });

const MEDIDAS_POR_ALIMENTO = 5;

export const FERRAMENTAS_ALIMENTOS: readonly FerramentaIA[] = [
  {
    nome: 'buscar_alimentos',
    descricao:
      'Busca alimentos da tabela TACO e da tabela do consultório pelo nome. Devolve até 20, com id, valores por 100 g e medidas caseiras. Use só ids devolvidos por esta ferramenta.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['termo'],
      properties: { termo: { type: 'string', description: 'Uma a seis palavras do nome do alimento.' } },
    },
  },
  {
    nome: 'calcular_plano',
    descricao:
      'Calcula os totais do dia (kcal, proteína, carboidrato, lipídio, fibra), a distribuição dos macronutrientes e o indicador da meta, com as contas do sistema. Use para conferir o plano antes de responder.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['meta_kcal', 'refeicoes'],
      properties: {
        meta_kcal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        refeicoes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['itens'],
            properties: {
              itens: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['alimento', 'gramas'],
                  properties: { alimento: { type: 'string' }, gramas: { type: 'number' } },
                },
              },
            },
          },
        },
      },
    },
  },
];

/** Os limites ficam aqui (o JSON Schema strict não os aceita, §5.1); acima deles, "entrada inválida". */
const buscaSchema = z.object({ termo: z.string().min(1).max(120) });
const calculoSchema = z.object({
  meta_kcal: z.number().nullable(),
  refeicoes: z
    .array(z.object({ itens: z.array(z.object({ alimento: z.string().max(10), gramas: z.number() })).max(MAX_ITENS_RASCUNHO_IA) }))
    .max(MAX_REFEICOES_RASCUNHO_IA), // RN-249: o caminho da IA fica em 15 refeições e 200 itens
});

function localDe(cat: CatalogoDaTarefa, a: AlimentoEncontrado): string {
  const ja = cat.localDe.get(a.id);
  if (ja) return ja;
  const novo = `A${cat.porLocal.size + 1}`;
  cat.porLocal.set(novo, a);
  cat.localDe.set(a.id, novo);
  return novo;
}

const umaCasa = (n: number | null) => (n === null ? null : arredondar(n, 1));

/**
 * Executa uma chamada de ferramenta do modelo. Erro de entrada, alimento não buscado e ferramenta desconhecida voltam como
 * resultado de erro (`is_error`) com texto fixo, sem dado: o laço segue e o modelo corrige.
 */
export async function executarFerramenta(c: ChamadaFerramenta, cat: CatalogoDaTarefa, buscar: BuscaAlimentos): Promise<{ conteudo: string; erro?: true }> {
  if (c.nome === 'buscar_alimentos') {
    const e = buscaSchema.safeParse(c.entrada);
    if (!e.success) return { conteudo: 'entrada inválida', erro: true };
    const achados = await buscar(e.data.termo);
    return {
      conteudo: JSON.stringify(
        achados.map((a) => ({
          id: localDe(cat, a),
          nome: a.nome,
          grupo: a.grupo,
          origem: a.origem,
          por_100g: { kcal: a.porCem.kcal, proteina_g: a.porCem.proteinaG, carboidrato_g: a.porCem.carboidratoG, lipidio_g: a.porCem.lipidioG, fibra_g: a.porCem.fibraG },
          medidas: a.medidas.slice(0, MEDIDAS_POR_ALIMENTO).map((m, i) => ({ indice: i + 1, nome: m.nome, gramas: m.gramas })),
        })),
      ),
    };
  }
  if (c.nome === 'calcular_plano') {
    const e = calculoSchema.safeParse(c.entrada);
    if (!e.success) return { conteudo: 'entrada inválida', erro: true };
    const refeicoes: { itens: ItemCalculo[] }[] = [];
    for (const r of e.data.refeicoes) {
      const itens: ItemCalculo[] = [];
      for (const [i, it] of r.itens.entries()) {
        const a = cat.porLocal.get(it.alimento);
        // o id ecoado é só o que o modelo mandou, sem nada além de letras e dígitos (até 10, pelo schema)
        if (!a) return { conteudo: `alimento ${it.alimento.replace(/[^A-Za-z0-9]/g, '')} não foi buscado nesta tarefa`, erro: true };
        if (!(it.gramas >= QUANTIDADE_MIN && it.gramas <= QUANTIDADE_MAX)) return { conteudo: 'gramas fora de 0,1 a 5000', erro: true };
        itens.push({ id: String(i), quantidadeG: it.gramas, porCem: a.porCem, substituiItemId: null });
      }
      refeicoes.push({ itens });
    }
    const t = totalDoDia(refeicoes);
    const ind = indicadorMeta(t.kcal, e.data.meta_kcal);
    const m = distribuicaoMacros(t, null);
    return {
      conteudo: JSON.stringify({
        total_kcal: arredondar(t.kcal, 0),
        proteina_g: arredondar(t.proteinaG, 1),
        carboidrato_g: arredondar(t.carboidratoG, 1),
        lipidio_g: arredondar(t.lipidioG, 1),
        fibra_g: arredondar(t.fibraG, 1),
        proteina_pct: umaCasa(m.proteina.pctVet),
        carboidrato_pct: umaCasa(m.carboidrato.pctVet),
        lipidio_pct: umaCasa(m.lipidio.pctVet),
        indicador: ind?.rotulo ?? null,
      }),
    };
  }
  return { conteudo: 'ferramenta desconhecida', erro: true };
}
