import { asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { referenciasNutrientes, type ValoresDaReferencia } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { lerDecimal } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { idValido } from '@/modules/pacientes/base';
import { ehChaveNutriente, MICRO_MAX, NUTRIENTES } from './nutrientes';
import { FONTE_REFERENCIA_MAX, FONTE_REFERENCIA_MIN, MSG_REFERENCIAS, NOME_REFERENCIA_MAX, type ReferenciaParaPlano } from './referencias-constantes';

/**
 * RN-238 (Plano 19, US-232): perfis de referência do consultório (`referencias_nutrientes`, `staff_only`). A plataforma
 * não traz perfil pronto (D11). Sem paciente e sem gatilho de auditoria (não é dado de saúde); o plano guarda a cópia
 * na publicação (`referencia_congelada`), e excluir o perfil só anula `referencia_id` de rascunhos e modelos (FK
 * `ON DELETE SET NULL (referencia_id)`, D30). Texto do usuário (nome, fonte) nunca vai para log nem para a mensagem.
 */

export type Referencia = ReferenciaParaPlano;
export type ReferenciaDaLista = { id: string; nome: string; fonte: string; nutrientes: number };

export class ReferenciaError extends Error {
  override name = 'ReferenciaError';
  constructor(readonly erros: Record<string, string>) {
    super('Perfil de referência inválido');
  }
}

/** Valor de um campo como chega do formulário (texto digitado) ou de uma chamada (número). */
type ValorDigitado = { meta?: unknown; maximo?: unknown };
export type EntradaReferencia = { nome: unknown; fonte: unknown; valores: unknown };

const ORDEM = new Map<string, number>(NUTRIENTES.map((n, k) => [n.chave, k]));
/** Valores na ordem do catálogo (a lista do formulário e do editor). */
const ordenados = (v: ValoresDaReferencia): ValoresDaReferencia =>
  Object.fromEntries(Object.entries(v).sort(([a], [b]) => (ORDEM.get(a) ?? 0) - (ORDEM.get(b) ?? 0)));

/** Faixa de meta e máximo: 0 a 100000 (a mesma de `foods.micros`); vazio = sem valor; texto que não é número = erro. */
function lerValor(v: unknown): number | null | false {
  const n = lerDecimal(v);
  if (n === null) return null;
  return Number.isNaN(n) || n < 0 || n > MICRO_MAX ? false : n;
}

/**
 * RN-238: nome 1–80, fonte 2–300 (obrigatória), por chave do catálogo `meta` e/ou `maximo` (≥ 0; com os dois, meta ≤
 * máximo) e ao menos um nutriente. Erros por campo: `nome`, `fonte`, `valores` (nenhum nutriente) e `valores.<chave>`
 * (a linha do nutriente). Chave fora do catálogo só vem de entrada adulterada: `geral`.
 */
function validar(e: EntradaReferencia): { nome: string; fonte: string; valores: ValoresDaReferencia } {
  const erros: Record<string, string> = {};
  const nome = normalizarTexto(e.nome);
  if (!nome || nome.length > NOME_REFERENCIA_MAX) erros.nome = MSG_REFERENCIAS.nome;
  const fonte = normalizarTexto(e.fonte);
  if (fonte.length < FONTE_REFERENCIA_MIN) erros.fonte = MSG_REFERENCIAS.fonte;
  else if (fonte.length > FONTE_REFERENCIA_MAX) erros.fonte = MSG_REFERENCIAS.fonteLonga;
  const valores: ValoresDaReferencia = {};
  const entrada = e.valores;
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) throw new ReferenciaError({ geral: MSG_REFERENCIAS.valor });
  for (const [chave, bruto] of Object.entries(entrada as Record<string, unknown>)) {
    if (!ehChaveNutriente(chave) || typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new ReferenciaError({ geral: MSG_REFERENCIAS.valor });
    const v = bruto as ValorDigitado;
    const meta = lerValor(v.meta);
    const maximo = lerValor(v.maximo);
    if (meta === false || maximo === false) erros[`valores.${chave}`] = MSG_REFERENCIAS.valor;
    else if (meta !== null && maximo !== null && meta > maximo) erros[`valores.${chave}`] = MSG_REFERENCIAS.metaAcimaDoMaximo;
    else if (meta !== null || maximo !== null) valores[chave] = { ...(meta !== null ? { meta } : {}), ...(maximo !== null ? { maximo } : {}) };
  }
  const comErroDeValor = Object.keys(erros).some((k) => k.startsWith('valores.'));
  if (!Object.keys(valores).length && !comErroDeValor) erros.valores = MSG_REFERENCIAS.semValor;
  if (Object.keys(erros).length) throw new ReferenciaError(erros);
  return { nome, fonte, valores: ordenados(valores) };
}

/** US-232: os perfis do consultório por nome, com quantos nutrientes cada um tem ("1 nutriente") e a fonte. */
export async function listarReferencias(ctx: TenantContext, db: Db = getDb()): Promise<ReferenciaDaLista[]> {
  const rows = await withTenant(ctx, (tx) => tx.select().from(referenciasNutrientes).orderBy(asc(referenciasNutrientes.nome)), db);
  return rows.map((r) => ({ id: r.id, nome: r.nome, fonte: r.fonte, nutrientes: Object.keys(r.valores ?? {}).length }));
}

/** RN-239: os perfis inteiros para o editor do plano escolher e comparar (lista do rascunho e do modelo). */
export async function referenciasParaPlano(ctx: TenantContext, db: Db = getDb()): Promise<Referencia[]> {
  const rows = await withTenant(ctx, (tx) => tx.select().from(referenciasNutrientes).orderBy(asc(referenciasNutrientes.nome)), db);
  return rows.map((r) => ({ id: r.id, nome: r.nome, fonte: r.fonte, valores: ordenados(r.valores ?? {}) }));
}

/** Um perfil do consultório (RLS: o de outro consultório não aparece); id inválido ou de outro → null. */
export async function carregarReferencia(ctx: TenantContext, id: string, db: Db = getDb()): Promise<Referencia | null> {
  if (!idValido(id)) return null;
  const [r] = await withTenant(ctx, (tx) => tx.select().from(referenciasNutrientes).where(eq(referenciasNutrientes.id, id)), db);
  return r ? { id: r.id, nome: r.nome, fonte: r.fonte, valores: ordenados(r.valores ?? {}) } : null;
}

/**
 * US-232: cria (`id` nulo) ou altera um perfil. Alterar não muda plano publicado (a cópia congelada é dele, RN-238).
 * Nome repetido no consultório (UNIQUE `referencias_nutrientes_nome_unique`) → erro no campo do nome.
 */
export async function salvarReferencia(ctx: TenantContext, id: string | null, entrada: EntradaReferencia, deps: { db?: Db } = {}): Promise<{ id: string }> {
  if (id !== null && !idValido(id)) throw new ReferenciaError({ geral: MSG_REFERENCIAS.naoEncontrado });
  const v = validar(entrada);
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        if (id === null) {
          const [r] = await tx.insert(referenciasNutrientes).values({ tenantId: ctx.tenantId, ...v }).returning({ id: referenciasNutrientes.id });
          return r;
        }
        const [r] = await tx.update(referenciasNutrientes).set({ ...v, updatedAt: new Date() }).where(eq(referenciasNutrientes.id, id)).returning({ id: referenciasNutrientes.id });
        if (!r) throw new ReferenciaError({ geral: MSG_REFERENCIAS.naoEncontrado });
        return r;
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'referencias_nutrientes_nome_unique') throw new ReferenciaError({ nome: MSG_REFERENCIAS.nomeRepetido });
    throw e;
  }
}

/**
 * US-232, D30: exclui o perfil. Os rascunhos e modelos que o usam ficam "Sem perfil" (FK `ON DELETE SET NULL
 * (referencia_id)`); os planos publicados e arquivados não apontam para ele (a publicação zera `referencia_id`) e mantêm
 * a cópia, sem nenhuma escrita. Perfil que não existe (ou de outro consultório) → erro "Perfil não encontrado.".
 */
export async function excluirReferencia(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(id)) throw new ReferenciaError({ geral: MSG_REFERENCIAS.naoEncontrado });
  const apagados = await withTenant(ctx, (tx) => tx.delete(referenciasNutrientes).where(eq(referenciasNutrientes.id, id)).returning({ id: referenciasNutrientes.id }), deps.db ?? getDb());
  if (!apagados.length) throw new ReferenciaError({ geral: MSG_REFERENCIAS.naoEncontrado });
}
