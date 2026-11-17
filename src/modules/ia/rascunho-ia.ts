import { and, eq, gt, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { foods, iaTarefas, mealPlans, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { seloDaFonte } from '@/modules/alimentos/fontes';
import { textoMedida } from '@/modules/alimentos/medidas-constantes';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { criarRascunhoTx, gravarConteudoRascunhoTx } from '@/modules/plano-alimentar/rascunho';
import { TODOS_OS_DIAS } from '@/modules/plano-alimentar/dias';
import type { ItemPlano, PlanoCompleto, RefeicaoPlano } from '@/modules/plano-alimentar/tipos';
import { auditRead } from '@/modules/plataforma/audit';
import { autorizacaoDaTarefa, autorizacaoDoPaciente, motivoDoPaciente } from './autorizacao';
import { MSG_IA, MSG_RASCUNHO_IA, USO_DA_TAREFA, type DestinoIA } from './constantes';
import { PROMPT_VERSAO_RASCUNHO } from './instrucoes/rascunho';
import { validarMetas } from './rascunho-dados';
import { criarTarefaDoAssistente, falhaDoPedidoDoAssistente, mensagemDoPaciente, PedidoIaError, usuariaDoPedido, type DepsPedido } from './tarefas';
import type { ResultadoRascunho } from './tipos';

const USO = USO_DA_TAREFA.rascunho_plano;

/** US-121: metas fora do formulário — erros por campo (chaves de `validarMetas`), nada criado. */
export class MetasError extends Error {
  override name = 'MetasError';
  constructor(readonly erros: Record<string, string>) {
    super('Metas inválidas');
  }
}
/** A-D12: o paciente já tem rascunho e a nutricionista não confirmou a substituição (a tela pergunta). */
export class RascunhoExisteError extends Error {
  override name = 'RascunhoExisteError';
}
/** "Usar como rascunho" sem a sugestão disponível (RN-108): `mensagem` é o texto da tela. */
export class RascunhoIaError extends Error {
  override name = 'RascunhoIaError';
  constructor(readonly mensagem: string) {
    super(mensagem);
  }
}

/** US-121 (padrão das refeições): as do plano mais recente do paciente, ou seis refeições comuns com horário. */
export const REFEICOES_COMUNS = [
  { nome: 'Café da manhã', horario: '07:00' },
  { nome: 'Lanche da manhã', horario: '10:00' },
  { nome: 'Almoço', horario: '12:30' },
  { nome: 'Lanche da tarde', horario: '16:00' },
  { nome: 'Jantar', horario: '19:30' },
  { nome: 'Ceia', horario: '22:00' },
] as const;

/**
 * Sem leitura própria: recebe o que a página já carregou com auditoria — `contextoDoPaciente` (meta.ts; cálculos do mais
 * recente para o mais antigo) e o plano de versão mais alta (`carregarPlano`) — e devolve o padrão do formulário.
 */
export function metasPadrao(calculos: { kcal: number }[], ultimo: Pick<PlanoCompleto, 'refeicoes'> | null): { metaKcal: number | null; refeicoes: { nome: string; horario: string }[] } {
  const doPlano = (ultimo?.refeicoes ?? [])
    .filter((r) => r.horario)
    .slice(0, 15)
    .map((r) => ({ nome: r.nome, horario: r.horario }));
  return { metaKcal: calculos[0]?.kcal ?? null, refeicoes: doPlano.length ? doPlano : REFEICOES_COMUNS.map((r) => ({ ...r })) };
}

/**
 * US-121 "Gerar rascunho" (RN-100, RN-103, RN-104): valida as metas e cria a tarefa na fila. A reserva é o teto do
 * rascunho (`IA_TETO_RASCUNHO_USD`, D5): o laço nunca passa dele. Ordem de travas, a do resumo: paciente
 * (carregarPacienteParaEscrita) → tenant (FOR NO KEY UPDATE, D16) → (cota) ia_uso → plataforma (do tenant em diante,
 * `criarTarefaDoAssistente`, comum com o resumo). Nada do prontuário é lido
 * aqui (o pedido é montado no portão do worker, com o paciente travado); as metas (dado de saúde) ficam em `parametros` até
 * a tarefa ser esvaziada. O gatilho de auditoria grava o `criar` da entidade `ia` com o ator e o IP ("Pediu rascunho à IA").
 */
export async function pedirRascunhoIa(ctx: TenantContext, tenant: TenantRow, patientId: string, bruto: unknown, deps: DepsPedido): Promise<string> {
  const v = validarMetas(bruto);
  if (!v.ok) throw new MetasError(v.erros);
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const usuaria = usuariaDoPedido(ctx, tenant, patientId, deps.ia); // atalho barato; a decisão vale sob a trava D16
  const boss = deps.boss ?? (await getBoss());
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado/anonimizado → PacienteBloqueadoError
        // RN-100 / RN-107: a autorização lida com o paciente travado, para o USO da tarefa
        const situacao = await autorizacaoDoPaciente(tx, p.id, deps.ia.destino);
        const motivo = motivoDoPaciente(p, situacao, USO);
        if (motivo) throw new PedidoIaError(mensagemDoPaciente(motivo, situacao));
        return criarTarefaDoAssistente(
          tx,
          ctx,
          p.id,
          { tipo: 'rascunho_plano', parametros: v.metas, carimbo: null, microUsd: deps.ia.tetoRascunhoMicroUsd, promptVersao: PROMPT_VERSAO_RASCUNHO },
          { ia: deps.ia, boss, usuaria, agora },
        );
      },
      db,
    );
  } catch (e) {
    return falhaDoPedidoDoAssistente(e, MSG_RASCUNHO_IA.emAndamento, deps, db, agora);
  }
}

export type PreviaRascunho = { tarefaId: string; plano: PlanoCompleto; descartados: number; foraDoCatalogo: number };

/** A sugestão como fica pronta (não vencida, do paciente e do tipo rascunho) — ou nada. */
const prontaDoPaciente = (tarefaId: string, patientId: string, agora: Date) =>
  and(eq(iaTarefas.id, tarefaId), eq(iaTarefas.patientId, patientId), eq(iaTarefas.tipo, 'rascunho_plano'), eq(iaTarefas.status, 'pronta'), gt(iaTarefas.expiraEm, agora));

/**
 * US-121 "Prévia": abrir é LEITURA de dado de saúde — auditRead (entidade `ia`) na mesma transação (regra 8). RN-108 (D14):
 * sem a autorização vigente para o rascunho (ou a tarefa pedida antes da última retirada), não abre. Os alimentos são lidos
 * agora (valores atuais; totais pelo calculo.ts na tela) e a prévia mostra o que "Usar como rascunho" gravaria: o alimento
 * que sumiu sai e é contado (`foraDoCatalogo`), com as substituições dele; a refeição sem principal não aparece (D15).
 */
export async function abrirRascunhoIa(ctx: TenantContext, patientId: string, tarefaId: string, deps: { destino: DestinoIA | null; db?: Db; agora?: Date }): Promise<PreviaRascunho | null> {
  if (!idValido(patientId) || !idValido(tarefaId)) return null;
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx.select().from(iaTarefas).where(prontaDoPaciente(tarefaId, patientId, agora));
      const r = t?.resultado;
      if (!t || !r || !('tipo' in r) || r.tipo !== 'rascunho') return null;
      const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
      if (!p || motivoDoPaciente(p, await autorizacaoDaTarefa(tx, t, deps.destino), USO)) return null;
      const ids = [...new Set(r.plano.refeicoes.flatMap((x) => x.itens.map((i) => i.foodId)))];
      const fs = new Map((ids.length ? await tx.select().from(foods).where(inArray(foods.id, ids)) : []).map((f) => [f.id, f]));
      let foraDoCatalogo = 0;
      const refeicoes: RefeicaoPlano[] = [];
      r.plano.refeicoes.forEach((x, ir) => {
        const idDoItem = (ii: number) => `${t.id}-${ir}-${ii}`;
        // como gravarConteudoRascunhoTx: principais visíveis; substituição só de principal que ficou
        const principais = new Set(x.itens.flatMap((i, ii) => (i.substitui === null && fs.has(i.foodId) ? [ii] : [])));
        const itens: ItemPlano[] = x.itens.flatMap((i, ii) => {
          const f = fs.get(i.foodId);
          if (!f || (i.substitui !== null && !principais.has(i.substitui))) return [];
          return [
            {
              id: idDoItem(ii), foodId: f.id, nome: f.nome, fonte: f.fonte, origem: seloDaFonte(f.fonte), // RN-230: de foods.fonte
              porCem: { kcal: f.kcal, proteinaG: f.proteinaG, carboidratoG: f.carboidratoG, lipidioG: f.lipidioG, fibraG: f.fibraG },
              medidas: [], quantidadeG: i.quantidadeG, medida: i.medida, medidaCaseiraTxt: i.medida ? textoMedida(i.medida.qtd, i.medida) : null,
              substituiItemId: i.substitui === null ? null : idDoItem(i.substitui),
            },
          ];
        });
        if (!principais.size) {
          foraDoCatalogo += x.itens.length;
          return;
        }
        foraDoCatalogo += x.itens.length - itens.length;
        // RN-246: como gravarConteudoRascunhoTx, a refeição sugerida vale todos os dias
        refeicoes.push({ id: `${t.id}-${ir}`, nome: x.nome, horario: x.horario, observacao: '', diasSemana: [...TODOS_OS_DIAS], descricaoLivre: null, itens });
      });
      await auditRead(tx, { entidade: 'ia', entidadeId: t.id, patientId });
      return {
        tarefaId: t.id,
        descartados: r.plano.descartados,
        foraDoCatalogo,
        plano: {
          id: t.id, patientId, isTemplate: false, titulo: r.plano.titulo, metaKcal: r.plano.metaKcal, energyCalcId: null, status: 'rascunho', versao: 0, revisao: 0,
          publicadoEm: null, mostrarCalorias: true, orientacoes: r.plano.orientacoes, modo: 'calculado', macrosPrescritos: null, pdfStatus: null, pdfPath: null, origemIa: null, iaOrigemEm: null, refeicoes,
        },
      };
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-121 "Usar como rascunho" (RN-122, A-D12, D15): na MESMA transação, o rascunho do paciente e a tarefa "aplicada".
 * Travas: paciente (carregarPacienteParaEscrita) → rascunho atual (FOR UPDATE) → tenant (FOR SHARE: o "Desativar" e a
 * admin, que esvaziam as prontas, terminam antes ou esperam) → tarefa (FOR UPDATE). RN-100/RN-108: o paciente ativo e a
 * autorização da tarefa para o rascunho são conferidos com o paciente travado. Com rascunho e sem `substituir` →
 * RascunhoExisteError (a tela pergunta); com `substituir`, o atual sai (como "Descartar rascunho") e o da IA entra, com a
 * marca `ia_origem_em`. A tarefa é esvaziada (resultado e metas) e guarda quem aplicou, quando e quantos itens.
 */
export async function usarComoRascunho(
  ctx: TenantContext,
  patientId: string,
  tarefaId: string,
  o: { substituir: boolean },
  deps: { destino: DestinoIA | null; db?: Db; agora?: Date },
): Promise<{ planId: string; foraDoCatalogo: number }> {
  if (!idValido(patientId) || !idValido(tarefaId)) throw new RascunhoIaError(MSG_IA.indisponivelSugestao);
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const [atual] = await tx
        .select({ id: mealPlans.id })
        .from(mealPlans)
        .where(and(eq(mealPlans.patientId, p.id), eq(mealPlans.status, 'rascunho')))
        .for('update');
      await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for('share');
      const [t] = await tx.select().from(iaTarefas).where(prontaDoPaciente(tarefaId, p.id, agora)).for('update');
      const r = t?.resultado as ResultadoRascunho | null | undefined;
      if (!t || r?.tipo !== 'rascunho') throw new RascunhoIaError(MSG_IA.indisponivelSugestao);
      if (motivoDoPaciente(p, await autorizacaoDaTarefa(tx, t, deps.destino), USO)) throw new RascunhoIaError(MSG_IA.indisponivelSugestao);
      if (atual && !o.substituir) throw new RascunhoExisteError();
      if (atual) await tx.delete(mealPlans).where(and(eq(mealPlans.id, atual.id), eq(mealPlans.status, 'rascunho')));
      const planId = await criarRascunhoTx(tx, ctx.tenantId, p.id, { titulo: r.plano.titulo, metaKcal: r.plano.metaKcal, orientacoes: r.plano.orientacoes, iaOrigemEm: agora });
      const g = await gravarConteudoRascunhoTx(tx, ctx.tenantId, p.id, planId, r.plano.refeicoes);
      await tx
        .update(iaTarefas)
        .set({ status: 'aplicada', resultado: null, parametros: null, encerradoEm: agora, encerradoPor: ctx.actorUserId ?? null, linhasAplicadas: g.itens, updatedAt: agora })
        .where(eq(iaTarefas.id, t.id));
      return { planId, foraDoCatalogo: g.foraDoCatalogo };
    },
    deps.db ?? getDb(),
  );
}
