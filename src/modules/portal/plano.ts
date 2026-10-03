import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { kcalTexto, nutrientesDoItem, quantidadeDoItem, totalDoDia } from '@/modules/plano-alimentar/calculo';
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
export type RefeicaoDoPaciente = { id: string; nome: string; horario: string; observacao: string; itens: ItemDoPaciente[] };
export type PlanoDoPaciente = {
  id: string;
  titulo: string;
  orientacoes: string;
  totalKcal: string | null;
  refeicoes: RefeicaoDoPaciente[];
  proximaRefeicaoId: string | null;
  pdf: 'pronto' | 'pendente' | 'indisponivel';
};

/** A primeira refeição a partir de agora (HH:MM no fuso do tenant); depois da última, a primeira do dia seguinte. */
export function proximaRefeicao(horarios: { id: string; horario: string }[], agoraHHMM: string): string | null {
  const ordem = [...horarios].sort((a, b) => a.horario.localeCompare(b.horario));
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
      return p ? lerPlanoNaTransacao(tx, p.id, { comMedidas: false }) : null;
    },
    o.db ?? getDb(),
  );
  if (!plano) return null;
  const mostrar = plano.mostrarCalorias;
  const refeicoes = [...plano.refeicoes]
    .sort((a, b) => a.horario.localeCompare(b.horario))
    .map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: r.horario,
      observacao: r.observacao,
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
    refeicoes,
    proximaRefeicaoId: proximaRefeicao(refeicoes, partesNoFuso(o.agora ?? new Date(), fuso).hora),
    pdf: plano.pdfStatus === 'pronto' && plano.pdfPath ? 'pronto' : plano.pdfStatus === 'pendente' || plano.pdfStatus === null ? 'pendente' : 'indisponivel',
  };
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
