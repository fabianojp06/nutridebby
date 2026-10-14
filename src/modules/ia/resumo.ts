import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { iaTarefas, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { getBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { avisarTetoGlobal } from './alertas';
import { autorizacaoDaTarefa, autorizacaoDoPaciente, motivoDoPaciente } from './autorizacao';
import { MSG_IA, MSG_RESUMO, USO_DA_TAREFA, type DestinoIA, type ModeloIA, type MotivoFalha, type RegiaoIA, type StatusTarefa, type TipoTarefa } from './constantes';
import { CotaIaError, reservar } from './cota';
import { PROMPT_VERSAO_RESUMO } from './instrucoes/resumo';
import { estadoIaComPaciente, type EstadoIaTenant } from './modo';
import { custoMaximoMicroUsd, MAX_TOKENS_RESUMO, tokensDeBytes, TOKENS_INSTRUCOES_TETO } from './precos';
import { montarPedidoDoResumo } from './resumo-dados';
import { conferirLimites, mensagemDoPaciente, PedidoIaError, type DepsPedido } from './tarefas';
import type { ResultadoResumo } from './tipos';

const USO = USO_DA_TAREFA.resumo_historico;

/** `sem_retencao` (Plano 14A, D9) cai no "indisponível", como a emergência. */
const mensagemDoEstado = (e: EstadoIaTenant): string => (e === 'aditivo_desatualizado' ? MSG_IA.aditivoDesatualizado : MSG_IA.indisponivel);

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
 * plataforma. A montagem lê o prontuário só para o carimbo e o tamanho — nada volta à tela (sem auditRead). O gatilho de
 * auditoria grava o `criar` da entidade `ia` com o ator e o IP ("Pediu resumo à IA", RN-101). Nada sai ao provedor aqui.
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
  const estado = estadoIaComPaciente(tenant, deps.ia); // atalho barato; a decisão vale sob a trava D16, abaixo
  if (estado !== 'ativa') throw new PedidoIaError(mensagemDoEstado(estado));
  if (!ctx.actorUserId || !idValido(patientId)) throw new PedidoIaError(MSG_IA.indisponivel);
  const usuaria = ctx.actorUserId;
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
        // D16: decide com a linha travada do tenant de `ctx`, não com a cópia da action
        const [tn] = await tx
          .select({ status: tenants.status, iaLiberada: tenants.iaLiberada, iaAtivadaEm: tenants.iaAtivadaEm, iaAditivoVersao: tenants.iaAditivoVersao })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .for('no key update');
        const travado = tn ? estadoIaComPaciente(tn, deps.ia) : 'suspensa';
        if (travado !== 'ativa') throw new PedidoIaError(mensagemDoEstado(travado));
        await conferirLimites(tx, usuaria, agora);
        if (o.gerarDeNovo) {
          // "Gerar de novo": a anterior é descartada (esvaziada, com quem e quando — §5.11), como o "Descartar resumo"
          await tx.update(iaTarefas).set({ status: 'descartada', resultado: null, parametros: null, encerradoEm: agora, encerradoPor: usuaria, updatedAt: agora }).where(prontas);
        }
        const tarefaId = randomUUID();
        const modelo = deps.ia.modeloAssistente;
        const microUsd = reservaDoResumo(modelo, deps.ia.geo, pedido.bytes);
        await reservar(tx, { tenantId: ctx.tenantId, tarefaId, tipo: 'resumo_historico', modelo, promptVersao: PROMPT_VERSAO_RESUMO, microUsd, agora, tetoGlobalMicroUsd: deps.ia.tetoGlobalMicroUsd });
        await tx.insert(iaTarefas).values({
          id: tarefaId, tenantId: ctx.tenantId, patientId: p.id, tipo: 'resumo_historico', status: 'na_fila', pedidoPor: usuaria,
          // a escolha das notas é dado de saúde: fica até a tarefa ser esvaziada (CHECK ia_tarefas_conteudo_esvaziado)
          parametros: { notasPrivadas: o.notasPrivadas },
          // RN-108 (D14): criado_em pelo relógio do banco, depois da trava do paciente (como a leitura)
          carimboDados: pedido.carimbo, modelo, promptVersao: PROMPT_VERSAO_RESUMO, reservaMicroUsd: microUsd, criadoEm: sql`clock_timestamp()`, updatedAt: agora,
        });
        const job = await boss.send('ia-assistente', { tenantId: ctx.tenantId, tarefaId }, { db: fromDrizzle(tx, sql) });
        if (!job) throw new Error('A fila recusou o pedido de IA');
        return { tarefaId, reaproveitada: false };
      },
      db,
    );
  } catch (e) {
    if (uniqueViolation(e) === 'ia_tarefas_em_andamento_sem_exame_idx') throw new PedidoIaError(MSG_RESUMO.emAndamento);
    if (e instanceof CotaIaError) {
      if (e.motivo === 'teto_plataforma') {
        const avisar = deps.avisarTeto ?? ((a: Date) => avisarTetoGlobal(db, a, getEnv().APP_URL));
        await avisar(agora).catch((err: unknown) => logger.error({ err: err instanceof Error ? err.name : 'erro' }, 'falha ao avisar os admins do teto da IA'));
      }
      throw new PedidoIaError(e.motivo === 'cota' ? MSG_IA.cotaAcabou : MSG_IA.indisponivel);
    }
    throw e;
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
