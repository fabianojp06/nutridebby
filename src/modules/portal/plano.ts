import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { liberarReceitasDoPlano } from '@/modules/conteudo/audiencia';
import { kcalTexto, nutrientesDoItem, quantidadeDoItem, totalDoDia, totalDosItens } from '@/modules/plano-alimentar/calculo';
import { lerPlanoNaTransacao } from '@/modules/plano-alimentar/carregar';
import type { ItemPlano } from '@/modules/plano-alimentar/tipos';
import { pacienteDaSessao } from './sessao';

export { quantidadeDoItem };

export const MSG_PLANO_PACIENTE = {
  semPlano: 'Sua nutricionista ainda está preparando seu plano',
  pdfPreparando: 'Seu PDF está sendo preparado. Volte em alguns minutos.',
} as const;

export type SubstituicaoDoPaciente = { id: string; nome: string; quantidade: string; kcal: string | null };
export type ItemDoPaciente = SubstituicaoDoPaciente & { substituicoes: SubstituicaoDoPaciente[] };
export type RefeicaoDoPaciente = {
  id: string;
  nome: string;
  horario: string;
  observacao: string;
  /** RN-213: "{total} kcal" dos itens principais da refeição; null quando o plano não mostra calorias. */
  kcal: string | null;
  itens: ItemDoPaciente[];
  receita?: { id: string; titulo: string };
};
export type PlanoDoPaciente = {
  id: string;
  titulo: string;
  orientacoes: string;
  totalKcal: string | null;
  /** O plano mostra calorias (a nutricionista escolhe no editor). */
  mostrarCalorias: boolean;
  refeicoes: RefeicaoDoPaciente[];
  proximaRefeicaoId: string | null;
  pdf: 'pronto' | 'pendente' | 'indisponivel';
  /** RN-117 / A-D13 (Plano 14B): o plano nasceu do rascunho da IA ("Elaborado com apoio de IA e revisado pela nutricionista"). */
  seloIa: boolean;
};

/** A primeira refeição COM HORÁRIO a partir de agora (HH:MM no fuso do tenant); depois da última, a primeira do dia seguinte. */
export function proximaRefeicao(horarios: { id: string; horario: string }[], agoraHHMM: string): string | null {
  const ordem = horarios.filter((r) => r.horario).sort((a, b) => a.horario.localeCompare(b.horario));
  return (ordem.find((r) => r.horario >= agoraHHMM) ?? ordem[0])?.id ?? null;
}

const kcalDo = (i: ItemPlano, mostrar: boolean): string | null => {
  if (!mostrar) return null;
  const n = nutrientesDoItem(i.porCem, i.quantidadeG);
  return n.semValor.includes('kcal') ? null : `${kcalTexto(n.kcal)} kcal`;
};

/**
 * US-041: o plano publicado do paciente da sessão. A RLS entrega só o dele e nunca o rascunho (paciente_sem_rascunho);
 * os valores são a cópia congelada na publicação (RN-01). Leitura auditada com o paciente como ator (D22).
 */
export async function planoDoPaciente(ctx: TenantContext, fuso: string, o: { db?: Db; agora?: Date } = {}): Promise<PlanoDoPaciente | null> {
  const patientId = pacienteDaSessao(ctx, 'planoDoPaciente');
  const plano = await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      if (!p) return null;
      // US-054: a receita sugerida aparece no cartão mesmo fora da audiência (RN-12) — só neste caminho (D2)
      await liberarReceitasDoPlano(tx);
      return lerPlanoNaTransacao(tx, p.id, { comMedidas: false });
    },
    o.db ?? getDb(),
  );
  if (!plano) return null;
  const mostrar = plano.mostrarCalorias;
  const refeicoes = [...plano.refeicoes]
    // Plano 16: as refeições sem horário vão para o fim (antes, '' < '07:00' as punha no começo)
    .sort((a, b) => (a.horario === '' ? 1 : 0) - (b.horario === '' ? 1 : 0) || a.horario.localeCompare(b.horario))
    .map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: r.horario,
      observacao: r.observacao,
      // RN-213: "Cerca de {total} kcal" na refeição aberta — o total dos itens principais (as substituições não somam)
      kcal: mostrar ? `${kcalTexto(totalDosItens(r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId }))).kcal)} kcal` : null,
      ...(r.receita?.disponivel ? { receita: { id: r.receita.id, titulo: r.receita.titulo } } : {}),
      itens: r.itens
        .filter((i) => i.substituiItemId === null)
        .map((i) => ({
          id: i.id,
          nome: i.nome,
          quantidade: quantidadeDoItem(i),
          kcal: kcalDo(i, mostrar),
          substituicoes: r.itens
            .filter((s) => s.substituiItemId === i.id)
            .map((s) => ({ id: s.id, nome: s.nome, quantidade: quantidadeDoItem(s), kcal: kcalDo(s, mostrar) })),
        })),
    }));
  const total = totalDoDia(plano.refeicoes.map((r) => ({ itens: r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId })) })));
  return {
    id: plano.id,
    titulo: plano.titulo,
    orientacoes: plano.orientacoes,
    totalKcal: mostrar ? `${kcalTexto(total.kcal)} kcal` : null,
    mostrarCalorias: mostrar,
    refeicoes,
    proximaRefeicaoId: proximaRefeicao(refeicoes, partesNoFuso(o.agora ?? new Date(), fuso).hora),
    pdf: plano.pdfStatus === 'pronto' && plano.pdfPath ? 'pronto' : plano.pdfStatus === 'pendente' || plano.pdfStatus === null ? 'pendente' : 'indisponivel',
    seloIa: plano.iaOrigemEm !== null,
  };
}

/**
 * D6 (Plano 06) + US-054: versão da cópia offline de "Meu plano" = id do plano + resumo das sugestões de receita, com
 * id E título (o cartão some da cópia quando a receita é despublicada e muda quando ela é renomeada). Resumo de 16
 * caracteres (sha256 em base64url): 36 + 1 + 16 = 53, dentro do limite de 100 do service worker (`textoCurto`,
 * `src/app/sw-regras.ts`) com qualquer número de refeições e qualquer título.
 */
export function versaoDaCopiaOffline(plano: { id: string; refeicoes: { receita?: { id: string; titulo: string } }[] } | null): string {
  if (!plano) return 'sem-plano';
  const sugestoes = JSON.stringify(plano.refeicoes.map((r) => (r.receita ? [r.receita.id, r.receita.titulo] : null)));
  return `${plano.id}:${createHash('sha256').update(sugestoes).digest('base64url').slice(0, 16)}`;
}

/** "Baixar PDF" (US-041 = o PDF da US-026): só o estado e o caminho interno, para a rota assinar. Sem dado de saúde: sem auditoria. */
export async function caminhoDoPdf(ctx: TenantContext, db: Db = getDb()): Promise<{ estado: 'pronto'; caminho: string } | { estado: 'pendente' | 'indisponivel' }> {
  const patientId = pacienteDaSessao(ctx, 'caminhoDoPdf');
  const [p] = await withTenant(
    ctx,
    (tx) => tx.select({ status: mealPlans.pdfStatus, caminho: mealPlans.pdfPath }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado'))),
    db,
  );
  if (p?.status === 'pronto' && p.caminho) return { estado: 'pronto', caminho: p.caminho };
  return { estado: !p || p.status === 'falhou' || p.status === 'pronto' ? 'indisponivel' : 'pendente' };
}
