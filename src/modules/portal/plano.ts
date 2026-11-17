import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { liberarReceitasDoPlano } from '@/modules/conteudo/audiencia';
import type { TipoConteudo } from '@/modules/conteudo/constantes';
import { kcalTexto, nutrientesDoItem, quantidadeDoItem, totaisDoDia, totalDosItens } from '@/modules/plano-alimentar/calculo';
import { lerPlanoNaTransacao } from '@/modules/plano-alimentar/carregar';
import { perfisDeDia, rotuloDosDiasPorExtenso, type DiaDaSemana } from '@/modules/plano-alimentar/dias';
import type { ItemPlano, PlanoCompleto } from '@/modules/plano-alimentar/tipos';
import { agoraNoFuso, proximaRefeicao } from './plano-regras';
import { pacienteDaSessao } from './sessao';

export { proximaRefeicao, quantidadeDoItem };

export const MSG_PLANO_PACIENTE = {
  semPlano: 'Sua nutricionista ainda está preparando seu plano',
  pdfPreparando: 'Seu PDF está sendo preparado. Volte em alguns minutos.',
} as const;

/*
 * RN-240 / CS-232: a projeção é FECHADA — só estas chaves saem para a tela, o payload RSC e a cópia offline. Nunca micros,
 * perfil de referência, nutrientes exibidos, ids de alimento nem de lista da biblioteca (`listaOrigemId`).
 */
export type SubstituicaoDoPaciente = { id: string; nome: string; quantidade: string; kcal: string | null };
export type ItemDoPaciente = SubstituicaoDoPaciente & { substituicoes: SubstituicaoDoPaciente[] };
export type RefeicaoDoPaciente = {
  id: string;
  nome: string;
  horario: string;
  observacao: string;
  /** RN-246: os dias em que a refeição vale (0 = domingo). */
  dias: DiaDaSemana[];
  /** RN-243: o texto da refeição no plano em texto livre ("Sua nutricionista:"); null no plano com alimentos. */
  descricaoLivre: string | null;
  /** RN-213: "{total} kcal" dos itens principais da refeição; null quando o plano não mostra calorias. */
  kcal: string | null;
  itens: ItemDoPaciente[];
  receita?: { id: string; titulo: string };
};
/** RN-246/RN-247 (c): os dias com o mesmo conjunto de refeições, o título por extenso e o total do dia (nunca a soma de todas). */
export type PerfilDoPaciente = { dias: DiaDaSemana[]; titulo: string; totalKcal: string | null; refeicaoIds: string[] };
/** RN-252: a cópia da lista ligada ao plano publicado; a energia de cada item só com "mostrar calorias". */
export type ItemDaListaDoPaciente = { nome: string; quantidade: string; kcal: string | null };
export type ListaDoPaciente = { nome: string; orientacao: string; grupos: { nome: string; itens: ItemDaListaDoPaciente[] }[] };
/** RN-253: receita ou material ligado e PUBLICADO (`id` = o do conteúdo, aberto com `?de=plano`). */
export type ConteudoDoPlano = { id: string; titulo: string; tipo: TipoConteudo };
export type PlanoDoPaciente = {
  id: string;
  titulo: string;
  orientacoes: string;
  /** O plano mostra calorias (a nutricionista escolhe no editor; no texto livre não há cálculo — RN-243). */
  mostrarCalorias: boolean;
  /** Todas as refeições do plano, em ordem de horário (as sem horário no fim). */
  refeicoes: RefeicaoDoPaciente[];
  /** RN-247 (c): o servidor entrega os 7 dias (dia fora de todo perfil = sem refeição); a página escolhe o de hoje no aparelho. */
  perfis: PerfilDoPaciente[];
  /** O dia de hoje no fuso do consultório, na hora da leitura (o aparelho decide de novo na cópia offline). */
  hoje: DiaDaSemana;
  /** RN-247 (d): a próxima refeição e o texto ("Próxima, daqui a 2 h", "Próxima: amanhã às 07:30", "Próxima: seg às 07:30"). */
  proxima: { id: string; texto: string } | null;
  pdf: 'pronto' | 'pendente' | 'indisponivel';
  /** RN-117 / A-D13 (Plano 14B): o plano nasceu do rascunho da IA ("Elaborado com apoio de IA e revisado pela nutricionista"). */
  seloIa: boolean;
  listas: ListaDoPaciente[];
  conteudos: ConteudoDoPlano[];
};

/** "{kcal} kcal" da quantidade, só se o plano mostra calorias e a tabela tem a energia (RN-02). */
const kcalDaQuantidade = (porCem: Nutrientes100, gramas: number, mostrar: boolean): string | null => {
  if (!mostrar) return null;
  const n = nutrientesDoItem(porCem, gramas);
  return n.semValor.includes('kcal') ? null : `${kcalTexto(n.kcal)} kcal`;
};

/** Plano 15 (§7.3): a IA Nutri mostra o item com a mesma regra da tela (RN-02 por construção). */
export const kcalDo = (i: ItemPlano, mostrar: boolean): string | null => kcalDaQuantidade(i.porCem, i.quantidadeG, mostrar);

const paraCalculo = (r: PlanoCompleto['refeicoes'][number]) => ({
  diasSemana: r.diasSemana,
  itens: r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId })),
});

/**
 * US-041: o plano publicado do paciente da sessão. A RLS entrega só o dele e nunca o rascunho (paciente_sem_rascunho);
 * os valores são a cópia congelada na publicação (RN-01). Leitura auditada com o paciente como ator (D22).
 * Plano 19: os dias de cada refeição e os perfis de dia com o total (RN-247), o texto livre (RN-243), as listas ligadas
 * (RN-252) e só os conteúdos ligados PUBLICADOS (RN-253: a cópia do título de um despublicado ou excluído nunca sai).
 */
export async function planoDoPaciente(ctx: TenantContext, fuso: string, o: { db?: Db; agora?: Date } = {}): Promise<PlanoDoPaciente | null> {
  const patientId = pacienteDaSessao(ctx, 'planoDoPaciente');
  const plano = await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      if (!p) return null;
      // US-054 + RN-253: a receita sugerida e os conteúdos ligados aparecem mesmo fora da audiência (RN-12) — só neste caminho (D2)
      await liberarReceitasDoPlano(tx);
      return lerPlanoNaTransacao(tx, p.id, { comMedidas: false });
    },
    o.db ?? getDb(),
  );
  if (!plano) return null;
  // RN-243: no texto livre não há cálculo — "mostrar calorias" fica sem efeito (a caixa some do editor)
  const mostrar = plano.mostrarCalorias && plano.modo === 'calculado';
  const ordenadas = [...plano.refeicoes]
    // Plano 16: as refeições sem horário vão para o fim (antes, '' < '07:00' as punha no começo)
    .sort((a, b) => (a.horario === '' ? 1 : 0) - (b.horario === '' ? 1 : 0) || a.horario.localeCompare(b.horario));
  const refeicoes: RefeicaoDoPaciente[] = ordenadas.map((r) => ({
    id: r.id,
    nome: r.nome,
    horario: r.horario,
    observacao: r.observacao,
    dias: [...r.diasSemana],
    descricaoLivre: plano.modo === 'livre' ? r.descricaoLivre : null,
    // RN-213: "Cerca de {total} kcal" na refeição aberta — o total dos itens principais (as substituições não somam)
    kcal: mostrar ? `${kcalTexto(totalDosItens(paraCalculo(r).itens).kcal)} kcal` : null,
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
  // RN-247 (c): o total do dia é o do perfil (as refeições que valem no dia), nunca a soma de todas
  const perfis = perfisDeDia(ordenadas).map((pf) => ({
    dias: pf.dias,
    titulo: rotuloDosDiasPorExtenso(pf.dias),
    totalKcal: mostrar ? `${kcalTexto(totaisDoDia(ordenadas.map(paraCalculo), pf.dias[0]).kcal)} kcal` : null,
    refeicaoIds: pf.refeicoes.map((r) => r.id),
  }));
  const agora = agoraNoFuso(o.agora ?? new Date(), fuso);
  return {
    id: plano.id,
    titulo: plano.titulo,
    orientacoes: plano.orientacoes,
    mostrarCalorias: mostrar,
    refeicoes,
    perfis,
    hoje: agora.dia,
    proxima: proximaRefeicao(refeicoes, agora),
    pdf: plano.pdfStatus === 'pronto' && plano.pdfPath ? 'pronto' : plano.pdfStatus === 'pendente' || plano.pdfStatus === null ? 'pendente' : 'indisponivel',
    seloIa: plano.iaOrigemEm !== null,
    listas: plano.listas.map((l) => ({
      nome: l.nome,
      orientacao: l.orientacao,
      grupos: l.grupos.map((g) => ({
        nome: g.nome,
        itens: g.itens.map((i) => ({ nome: i.nome, quantidade: quantidadeDoItem(i), kcal: kcalDaQuantidade(i.porCem, i.quantidadeG, mostrar) })),
      })),
    })),
    conteudos: plano.conteudos.flatMap((c) => (c.situacao === 'publicado' && c.contentId && c.tipo ? [{ id: c.contentId, titulo: c.titulo, tipo: c.tipo }] : [])),
  };
}

/**
 * D6 (Plano 06) + US-054 + RN-247/RN-253: versão da cópia offline de "Meu plano" = id do plano + resumo das sugestões de
 * receita (id E título: o cartão some quando a receita é despublicada e muda quando ela é renomeada), dos conteúdos
 * ligados (id e título; só os publicados chegam à projeção, então despublicar ou excluir muda o resumo) e das listas
 * ligadas. Resumo de 16 caracteres (sha256 em base64url): 36 + 1 + 16 = 53, dentro do limite de 100 do service worker
 * (`textoCurto`, `src/app/sw-regras.ts`) com qualquer número de refeições, conteúdos e listas.
 */
export function versaoDaCopiaOffline(
  plano: { id: string; refeicoes: { receita?: { id: string; titulo: string } }[]; conteudos?: { id: string; titulo: string }[]; listas?: unknown[] } | null,
): string {
  if (!plano) return 'sem-plano';
  const resumo = JSON.stringify([
    plano.refeicoes.map((r) => (r.receita ? [r.receita.id, r.receita.titulo] : null)),
    (plano.conteudos ?? []).map((c) => [c.id, c.titulo]),
    plano.listas ?? [],
  ]);
  return `${plano.id}:${createHash('sha256').update(resumo).digest('base64url').slice(0, 16)}`;
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
