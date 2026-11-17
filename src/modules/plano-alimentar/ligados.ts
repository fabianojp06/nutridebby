import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { fkViolation } from '@/db/errors';
import { contents, foods, listasSubstituicao, mealPlans, planoConteudos, planoListasSubstituicao, type PlanoConteudoRow, type PlanoListaSubstituicaoRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { FONTES, FONTES_DE_ALIMENTO, type Fonte } from '@/modules/alimentos/fontes';
import { MSG_CONTEUDO, type TipoConteudo } from '@/modules/conteudo/constantes';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { MAX_CONTEUDOS_PLANO, MAX_LISTAS_PLANO, MSG_LIGADOS, MSG_LISTAS, type ConteudoParaLigar } from './biblioteca-constantes';
import { PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';
import { lerListaNaTransacao } from './listas';
import type { ConteudoLigado, GrupoDaListaLigada, ListaLigada } from './tipos';

/**
 * Plano 19, US-239 (RN-252, RN-253; D23, D24): o que fica "Ligado ao plano".
 * - Lista de substituição: `plano_listas_substituicao` guarda uma CÓPIA da lista da biblioteca (grupos e itens com
 *   nome, gramas, medida caseira, fonte, versão, fonte de origem e valores por 100 g), feita na hora da ligação.
 *   Editar ou excluir a lista na biblioteca não muda a cópia; "Atualizar da biblioteca" troca a cópia pela lista de hoje.
 * - Receita, orientação ou vídeo: `plano_conteudos` com o título copiado (o conteúdo excluído deixa a ligação com
 *   `content_id` nulo, ON DELETE SET NULL). O paciente o lê pelo plano publicado (exceção da RN-12 ampliada).
 * Tudo só no rascunho (paciente ou modelo), com o plano travado: as contagens dos limites (5 listas e 10 conteúdos)
 * não têm TOCTOU e a publicação, que trava o mesmo plano, nunca vê a ligação pela metade. Escritas auditadas pelo
 * gatilho (entidade `plano_alimentar`). Nomes, orientação e títulos nunca vão para log nem para a mensagem.
 */

export class LigadoError extends Error {
  override name = 'LigadoError';
}

/** O plano da URL: do paciente (`patientId`) ou modelo (`patientId` nulo). */
export type DonoDoPlano = { planId: string; patientId: string | null };

const fonte = z.enum(FONTES_DE_ALIMENTO);
const valor = z.number().nullable();
const copiaSchema = z.object({
  grupos: z.array(
    z.object({
      nome: z.string(),
      itens: z.array(
        z.object({
          nome: z.string(),
          quantidadeG: z.number(),
          medidaCaseiraTxt: z.string().nullable(),
          fonte,
          fonteVersao: z.string().nullable(),
          fonteOrigem: fonte.nullable(),
          porCem: z.object({ kcal: valor, proteinaG: valor, carboidratoG: valor, lipidioG: valor, fibraG: valor }),
        }),
      ),
    }),
  ),
});

/** RN-252: o formato de `plano_listas_substituicao.conteudo` conferido na leitura (chaves de fora não saem). */
export function lerCopiaDaLista(conteudo: unknown): GrupoDaListaLigada[] {
  return copiaSchema.parse(conteudo).grupos;
}

/**
 * RN-252/RN-257: os grupos da cópia da lista ligada, só por `lerCopiaDaLista`, sem lançar. O CHECK da tabela só exige
 * um objeto JSON: cópia fora do formato (até `{}`) → `[]`, e a lista sai com nome, orientação e data da cópia — a
 * página Plano, o PDF, a publicação, o mural, a IA Nutri, o editor e a exportação não caem por uma linha. Nada do
 * conteúdo vai para log (regra 3).
 */
export function gruposDaCopia(conteudo: unknown): GrupoDaListaLigada[] {
  try {
    return lerCopiaDaLista(conteudo);
  } catch {
    return [];
  }
}

const paraLista = (l: PlanoListaSubstituicaoRow): ListaLigada => ({
  id: l.id,
  listaOrigemId: l.listaOrigemId,
  nome: l.nome,
  orientacao: l.orientacao,
  copiadaEm: l.copiadaEm.toISOString(),
  grupos: gruposDaCopia(l.conteudo),
});

type Atual = { titulo: string; tipo: string; status: string };
const paraConteudo = (c: PlanoConteudoRow, atual: Atual | undefined): ConteudoLigado => {
  if (!c.contentId) return { id: c.id, contentId: null, titulo: c.titulo, tipo: null, situacao: 'excluido' };
  if (!atual) return { id: c.id, contentId: c.contentId, titulo: c.titulo, tipo: null, situacao: 'nao_publicado' };
  return { id: c.id, contentId: c.contentId, titulo: atual.titulo, tipo: atual.tipo as TipoConteudo, situacao: atual.status === 'publicado' ? 'publicado' : 'nao_publicado' };
};

/**
 * As ligações do plano na transação de quem lê (`lerPlanoNaTransacao`). O título e a situação de cada conteúdo vêm do
 * que a sessão enxerga em `contents`: a equipe vê todos; o paciente, só o publicado da audiência — ou, com a liberação
 * da RN-12 ligada na transação por `planoDoPaciente`, também o publicado ligado ao plano publicado dele.
 */
export async function ligadosNaTransacao(tx: Tx, planId: string): Promise<{ listas: ListaLigada[]; conteudos: ConteudoLigado[] }> {
  const ls = await tx.select().from(planoListasSubstituicao).where(eq(planoListasSubstituicao.planId, planId)).orderBy(asc(planoListasSubstituicao.ordem), asc(planoListasSubstituicao.createdAt));
  const cs = await tx.select().from(planoConteudos).where(eq(planoConteudos.planId, planId)).orderBy(asc(planoConteudos.ordem), asc(planoConteudos.createdAt));
  const ids = [...new Set(cs.flatMap((c) => (c.contentId ? [c.contentId] : [])))];
  const atuais = new Map(
    ids.length ? (await tx.select({ id: contents.id, titulo: contents.titulo, tipo: contents.tipo, status: contents.status }).from(contents).where(inArray(contents.id, ids))).map((c) => [c.id, c]) : [],
  );
  return { listas: ls.map(paraLista), conteudos: cs.map((c) => paraConteudo(c, c.contentId ? atuais.get(c.contentId) : undefined)) };
}

/**
 * Trava o rascunho da URL antes de mudar as ligações. Ordem de travas igual à do salvamento e da publicação: paciente
 * → plano. Plano de outro paciente, de outro consultório (RLS), modelo pedido como plano de paciente ou o contrário →
 * não encontrado; publicado ou arquivado → não editável; paciente bloqueado → `PacienteBloqueadoError`.
 */
async function travarRascunho(tx: Tx, d: DonoDoPlano): Promise<void> {
  if (!idValido(d.planId) || (d.patientId !== null && !idValido(d.patientId))) throw new PlanoNaoEncontradoError();
  const doDono = and(eq(mealPlans.id, d.planId), d.patientId === null ? isNull(mealPlans.patientId) : eq(mealPlans.patientId, d.patientId));
  const [antes] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(doDono);
  if (!antes) throw new PlanoNaoEncontradoError();
  if (d.patientId) await carregarPacienteParaEscrita(tx, d.patientId);
  const [p] = await tx.select({ status: mealPlans.status }).from(mealPlans).where(doDono).for('update');
  if (!p) throw new PlanoNaoEncontradoError(); // descartado entre a leitura e a trava
  if (p.status !== 'rascunho') throw new PlanoNaoEditavelError();
}

const proximaOrdem = (linhas: { ordem: number }[]) => (linhas.length ? Math.max(...linhas.map((l) => l.ordem)) + 1 : 0);

/**
 * RN-252: a cópia da lista da biblioteca como está agora (null se não existe ou é de outro consultório). Valores por
 * 100 g, fonte e versão da tabela do alimento; `fonteOrigem` = a tabela pública de onde o "Meu alimento" foi
 * duplicado (rodapé da RN-233), como a congelação da publicação.
 */
async function copiaDaBiblioteca(tx: Tx, listaId: string): Promise<{ nome: string; orientacao: string; conteudo: { grupos: GrupoDaListaLigada[] } } | null> {
  // FOR SHARE: um salvamento da lista em curso (que regrava grupos e itens) termina antes e a cópia sai inteira da
  // versão nova, nunca com o nome de uma e os grupos da outra; uma exclusão em curso termina antes e a lista não aparece
  const [existe] = await tx.select({ id: listasSubstituicao.id }).from(listasSubstituicao).where(eq(listasSubstituicao.id, listaId)).for('share');
  if (!existe) return null;
  const l = await lerListaNaTransacao(tx, listaId);
  if (!l) return null;
  const ids = [...new Set(l.grupos.flatMap((g) => g.itens.map((i) => i.foodId)))];
  const o = alias(foods, 'o');
  const origens = new Map<string, Fonte>(
    ids.length
      ? (
          await tx
            .select({ id: foods.id, fonte: o.fonte })
            .from(foods)
            .innerJoin(o, eq(o.id, foods.origemFoodId))
            .where(and(inArray(foods.id, ids), eq(foods.fonte, 'propria'), ne(o.fonte, 'propria')))
        ).map((f) => [f.id, f.fonte])
      : [],
  );
  return {
    nome: l.nome,
    orientacao: l.orientacao,
    conteudo: {
      grupos: l.grupos.map((g) => ({
        nome: g.nome,
        itens: g.itens.map((i) => ({
          nome: i.nome,
          quantidadeG: i.quantidadeG,
          medidaCaseiraTxt: i.medidaCaseiraTxt,
          fonte: i.fonte,
          fonteVersao: i.fonte === 'propria' ? null : FONTES[i.fonte].versao,
          fonteOrigem: origens.get(i.foodId) ?? null,
          porCem: i.porCem,
        })),
      })),
    },
  };
}

/**
 * "Ligar lista de substituição": grava a cópia da lista no rascunho. A mesma lista ligada de novo (clique duplo, outra
 * aba) devolve a cópia que já está no plano — leitura de dado do plano do paciente, então com `auditRead` na mesma
 * transação (regra 8; a gravação nova é auditada pelo gatilho); a sexta lista → "O plano pode ter até 5 listas e 10
 * receitas ou materiais.".
 */
export async function ligarLista(ctx: TenantContext, d: DonoDoPlano, listaId: string, deps: { db?: Db; now?: Date } = {}): Promise<ListaLigada> {
  if (!idValido(listaId)) throw new LigadoError(MSG_LISTAS.naoEncontrada);
  return withTenant(
    ctx,
    async (tx) => {
      await travarRascunho(tx, d);
      const ligadas = await tx.select().from(planoListasSubstituicao).where(eq(planoListasSubstituicao.planId, d.planId));
      const mesma = ligadas.find((l) => l.listaOrigemId === listaId);
      if (mesma) {
        if (d.patientId) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: d.planId, patientId: d.patientId });
        return paraLista(mesma);
      }
      if (ligadas.length >= MAX_LISTAS_PLANO) throw new LigadoError(MSG_LIGADOS.limite);
      const copia = await copiaDaBiblioteca(tx, listaId);
      if (!copia) throw new LigadoError(MSG_LISTAS.naoEncontrada);
      const [l] = await tx
        .insert(planoListasSubstituicao)
        .values({ tenantId: ctx.tenantId, patientId: d.patientId, planId: d.planId, listaOrigemId: listaId, ...copia, copiadaEm: deps.now ?? new Date(), ordem: proximaOrdem(ligadas) })
        .returning();
      return paraLista(l);
    },
    deps.db ?? getDb(),
  );
}

/**
 * "Atualizar da biblioteca": troca a cópia pela lista de agora (nome, orientação, grupos e itens; a data da cópia muda).
 * Só no rascunho. A lista de origem excluída → "A lista de origem foi excluída." e a cópia fica como estava.
 */
export async function atualizarDaBiblioteca(ctx: TenantContext, d: DonoDoPlano, ligacaoId: string, deps: { db?: Db; now?: Date } = {}): Promise<ListaLigada> {
  if (!idValido(ligacaoId)) throw new LigadoError(MSG_LISTAS.naoEncontrada);
  return withTenant(
    ctx,
    async (tx) => {
      await travarRascunho(tx, d);
      const [atual] = await tx.select().from(planoListasSubstituicao).where(and(eq(planoListasSubstituicao.id, ligacaoId), eq(planoListasSubstituicao.planId, d.planId)));
      if (!atual) throw new LigadoError(MSG_LISTAS.naoEncontrada);
      const copia = atual.listaOrigemId ? await copiaDaBiblioteca(tx, atual.listaOrigemId) : null;
      if (!copia) throw new LigadoError(MSG_LIGADOS.origemExcluida);
      const agora = deps.now ?? new Date();
      const [l] = await tx.update(planoListasSubstituicao).set({ ...copia, copiadaEm: agora, updatedAt: agora }).where(eq(planoListasSubstituicao.id, ligacaoId)).returning();
      return paraLista(l);
    },
    deps.db ?? getDb(),
  );
}

/** "Remover" a lista ligada (só no rascunho). Já removida (outra aba, clique duplo): nada a fazer. */
export async function removerLista(ctx: TenantContext, d: DonoDoPlano, ligacaoId: string, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(ligacaoId)) return;
  await withTenant(
    ctx,
    async (tx) => {
      await travarRascunho(tx, d);
      await tx.delete(planoListasSubstituicao).where(and(eq(planoListasSubstituicao.id, ligacaoId), eq(planoListasSubstituicao.planId, d.planId)));
    },
    deps.db ?? getDb(),
  );
}

/**
 * "Ligar receita ou material": receita, orientação ou vídeo do consultório, em qualquer situação (o editor mostra
 * "Não publicado — o paciente não vê"), com o título copiado. O mesmo conteúdo de novo devolve a ligação que já existe
 * (sem repetir, UNIQUE `plano_conteudos_unique`); o 11º → a mensagem do limite.
 */
export async function ligarConteudo(ctx: TenantContext, d: DonoDoPlano, contentId: string, deps: { db?: Db } = {}): Promise<ConteudoLigado> {
  if (!idValido(contentId)) throw new LigadoError(MSG_CONTEUDO.naoEncontrado);
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        await travarRascunho(tx, d);
        // FOR SHARE, no molde da receita sugerida em salvarRascunho: uma exclusão do conteúdo em curso termina antes (a
        // leitura espera e não acha a linha) e as que chegarem depois esperam este COMMIT — sem 23503 na FK do INSERT
        const [c] = await tx.select({ titulo: contents.titulo, tipo: contents.tipo, status: contents.status }).from(contents).where(eq(contents.id, contentId)).for('share');
        if (!c) throw new LigadoError(MSG_CONTEUDO.naoEncontrado);
        const ligados = await tx.select().from(planoConteudos).where(eq(planoConteudos.planId, d.planId));
        const mesmo = ligados.find((x) => x.contentId === contentId);
        if (mesmo) return paraConteudo(mesmo, c);
        if (ligados.length >= MAX_CONTEUDOS_PLANO) throw new LigadoError(MSG_LIGADOS.limite);
        const [l] = await tx
          .insert(planoConteudos)
          .values({ tenantId: ctx.tenantId, patientId: d.patientId, planId: d.planId, contentId, titulo: c.titulo, ordem: proximaOrdem(ligados) })
          .returning();
        return paraConteudo(l, c);
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    // defesa: o conteúdo saiu entre a trava e o INSERT (a trava acima evita) → o erro do conteúdo, não um 500
    if (fkViolation(e) !== null) throw new LigadoError(MSG_CONTEUDO.naoEncontrado);
    throw e;
  }
}

/** Tira a receita ou o material do plano (só no rascunho). Já tirado: nada a fazer. */
export async function desligarConteudo(ctx: TenantContext, d: DonoDoPlano, ligacaoId: string, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(ligacaoId)) return;
  await withTenant(
    ctx,
    async (tx) => {
      await travarRascunho(tx, d);
      await tx.delete(planoConteudos).where(and(eq(planoConteudos.id, ligacaoId), eq(planoConteudos.planId, d.planId)));
    },
    deps.db ?? getDb(),
  );
}

/** Os conteúdos do consultório para o "Ligar receita ou material", por título (a equipe vê todos, em qualquer situação). */
export async function conteudosParaLigar(ctx: TenantContext, db: Db = getDb()): Promise<ConteudoParaLigar[]> {
  const cs = await withTenant(
    ctx,
    (tx) => tx.select({ id: contents.id, titulo: contents.titulo, tipo: contents.tipo, status: contents.status }).from(contents).orderBy(asc(contents.titulo), asc(contents.id)),
    db,
  );
  return cs.map((c) => ({ id: c.id, titulo: c.titulo, tipo: c.tipo as TipoConteudo, publicado: c.status === 'publicado' }));
}
