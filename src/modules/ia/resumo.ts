import { and, desc, eq, gt } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { iaTarefas, patients, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { autorizacaoDaTarefa, autorizacaoDoPaciente, motivoDoPaciente } from './autorizacao';
import { MSG_RESUMO, USO_DA_TAREFA, type DestinoIA, type ModeloIA, type MotivoFalha, type RegiaoIA, type StatusTarefa, type TipoTarefa } from './constantes';
import { PROMPT_VERSAO_RESUMO } from './instrucoes/resumo';
import { custoMaximoMicroUsd, MAX_TOKENS_RESUMO, tokensDeBytes, TOKENS_INSTRUCOES_TETO } from './precos';
import { montarPedidoDoResumo } from './resumo-dados';
import { criarTarefaDoAssistente, falhaDoPedidoDoAssistente, mensagemDoPaciente, PedidoIaError, usuariaDoPedido, type DepsPedido } from './tarefas';
import type { ResultadoResumo } from './tipos';

const USO = USO_DA_TAREFA.resumo_historico;

/**
 * D12: a reserva cobre o pedido montado × 1,5 (o que mudar até o portão) + as instruções, e a saída máxima. No portão ela só
 * desce (reduzirReserva ao teto do pedido que sai); se o pedido remontado passar dela, nada sai (`limite_custo`, RN-104).
 */
export const reservaDoResumo = (modelo: ModeloIA, geo: RegiaoIA, bytes: number): number =>
  custoMaximoMicroUsd(modelo, geo, Math.ceil(tokensDeBytes(bytes) * 1.5) + TOKENS_INSTRUCOES_TETO, MAX_TOKENS_RESUMO);

/**
 * US-120 (RN-100, RN-103, RN-104, D11, D12): pede o resumo, ou devolve o pronto que ainda vale ("Reaproveitar": mesmo
 * carimbo — os mesmos registros e a mesma escolha das notas —, não vencido; sem cobrança). Ordem de travas: paciente
 * (carregarPacienteParaEscrita) → tenant (FOR NO KEY UPDATE, D16) → tarefas prontas ("Gerar de novo") → (cota) ia_uso →
 * plataforma (do tenant em diante, `criarTarefaDoAssistente`, comum com o rascunho). A montagem lê o prontuário só para o
 * carimbo e o tamanho — nada volta à tela (sem auditRead). O gatilho de auditoria grava o `criar` da entidade `ia` com o
 * ator e o IP ("Pediu resumo à IA", RN-101). Nada sai ao provedor aqui.
 */
export async function pedirResumo(
  ctx: TenantContext,
  tenant: TenantRow,
  patientId: string,
  o: { notasPrivadas: boolean; gerarDeNovo: boolean },
  deps: DepsPedido,
): Promise<{ tarefaId: string; reaproveitada: boolean }> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const usuaria = usuariaDoPedido(ctx, tenant, patientId, deps.ia); // atalho barato; a decisão vale sob a trava D16
  const boss = deps.boss ?? (await getBoss());
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado/anonimizado → PacienteBloqueadoError
        // RN-100 / RN-107: a autorização lida com o paciente travado, para o USO da tarefa (a 1.0 só tinha a leitura)
        const situacao = await autorizacaoDoPaciente(tx, p.id, deps.ia.destino);
        const motivo = motivoDoPaciente(p, situacao, USO);
        if (motivo) throw new PedidoIaError(mensagemDoPaciente(motivo, situacao));
        const pedido = await montarPedidoDoResumo(tx, p, { notasPrivadas: o.notasPrivadas, agora, fuso: tenant.fuso });
        if (pedido.vazio) throw new PedidoIaError(MSG_RESUMO.vazio);
        const prontas = and(eq(iaTarefas.patientId, p.id), eq(iaTarefas.tipo, 'resumo_historico'), eq(iaTarefas.status, 'pronta'), gt(iaTarefas.expiraEm, agora));
        if (!o.gerarDeNovo) {
          const [igual] = await tx
            .select({ id: iaTarefas.id })
            .from(iaTarefas)
            .where(and(prontas, eq(iaTarefas.carimboDados, pedido.carimbo)))
            .orderBy(desc(iaTarefas.criadoEm))
            .limit(1);
          if (igual) return { tarefaId: igual.id, reaproveitada: true };
        }
        const tarefaId = await criarTarefaDoAssistente(
          tx,
          ctx,
          p.id,
          {
            tipo: 'resumo_historico',
            parametros: { notasPrivadas: o.notasPrivadas },
            carimbo: pedido.carimbo,
            microUsd: reservaDoResumo(deps.ia.modeloAssistente, deps.ia.geo, pedido.bytes),
            promptVersao: PROMPT_VERSAO_RESUMO,
            // "Gerar de novo": a anterior é descartada (esvaziada, com quem e quando — §5.11), como o "Descartar resumo"
            antesDaReserva: o.gerarDeNovo
              ? async () => {
                  await tx.update(iaTarefas).set({ status: 'descartada', resultado: null, parametros: null, encerradoEm: agora, encerradoPor: usuaria, updatedAt: agora }).where(prontas);
                }
              : undefined,
          },
          { ia: deps.ia, boss, usuaria, agora },
        );
        return { tarefaId, reaproveitada: false };
      },
      db,
    );
  } catch (e) {
    return falhaDoPedidoDoAssistente(e, MSG_RESUMO.emAndamento, deps, db, agora);
  }
}

export type ResumoAberto = {
  tarefaId: string;
  geradoEm: Date;
  secoes: ResultadoResumo['secoes'];
  fontes: ResultadoResumo['fontes'];
  retiradas: number;
  tabela: ResultadoResumo['tabela'];
  notasPrivadas: boolean;
};

/**
 * US-120 ("Gerar"/"Reaproveitar"): abrir o resumo é LEITURA de dado de saúde — auditRead (entidade `ia`) na mesma transação
 * (regra 8). RN-108 (D14): sem a autorização vigente para o resumo (retirada, versão ou destino que não valem mais, ou a
 * tarefa pedida antes da última retirada), não abre — a tela mostra "Esta sugestão não está mais disponível.". `destino` =
 * o do provedor em uso (configIA).
 */
export async function abrirResumo(ctx: TenantContext, patientId: string, tarefaId: string, deps: { destino: DestinoIA | null; db?: Db; agora?: Date }): Promise<ResumoAberto | null> {
  if (!idValido(patientId) || !idValido(tarefaId)) return null;
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx
        .select()
        .from(iaTarefas)
        .where(and(eq(iaTarefas.id, tarefaId), eq(iaTarefas.patientId, patientId), eq(iaTarefas.tipo, 'resumo_historico'), eq(iaTarefas.status, 'pronta'), gt(iaTarefas.expiraEm, agora)));
      const r = t?.resultado;
      if (!t || !r || !('tipo' in r) || r.tipo !== 'resumo') return null;
      const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
      if (!p || motivoDoPaciente(p, await autorizacaoDaTarefa(tx, t, deps.destino), USO)) return null;
      await auditRead(tx, { entidade: 'ia', entidadeId: t.id, patientId });
      return {
        tarefaId: t.id,
        geradoEm: t.concluidoEm ?? t.criadoEm,
        secoes: r.secoes,
        fontes: r.fontes,
        retiradas: r.retiradas,
        tabela: r.tabela,
        notasPrivadas: (t.parametros as { notasPrivadas?: unknown } | null)?.notasPrivadas === true,
      };
    },
    deps.db ?? getDb(),
  );
}

/** RNF-100: a última tarefa de um tipo do paciente — só a situação (a tela decide o que mostrar; sem auditoria). */
export async function ultimaTarefaDoTipo(ctx: TenantContext, patientId: string, tipo: TipoTarefa, db: Db = getDb()): Promise<{ id: string; status: StatusTarefa; erro: MotivoFalha | null } | null> {
  if (!idValido(patientId)) return null;
  const [t] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: iaTarefas.id, status: iaTarefas.status, erro: iaTarefas.erro })
        .from(iaTarefas)
        .where(and(eq(iaTarefas.patientId, patientId), eq(iaTarefas.tipo, tipo)))
        .orderBy(desc(iaTarefas.criadoEm))
        .limit(1),
    db,
  );
  return t ? { id: t.id, status: t.status as StatusTarefa, erro: (t.erro as MotivoFalha | null) ?? null } : null;
}
