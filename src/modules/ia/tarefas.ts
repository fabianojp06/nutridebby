import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { exams, iaTarefas, storedFiles, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { getEnv } from '@/env';
import { logger } from '@/lib/logger';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { avisarTetoGlobal } from './alertas';
import { motivoDoPaciente } from './ciencia-paciente';
import { EM_ANDAMENTO, IA_ARQUIVO_MAX_BYTES, MSG_FALHA, MSG_IA, type MotivoFalha, type StatusTarefa } from './constantes';
import { CotaIaError, reservar } from './cota';
import { PROMPT_VERSAO_LEITURA } from './instrucoes/leitura';
import { estadoIaDoTenant, type ConfigIA } from './modo';
import { reservaDaLeitura } from './precos';

/** Erro com texto pronto para a tela (texto da spec). */
export class PedidoIaError extends Error {
  override name = 'PedidoIaError';
  constructor(readonly mensagem: string) {
    super(mensagem);
  }
}

export type DepsPedido = { ia: ConfigIA; db?: Db; boss?: PgBoss; agora?: Date; avisarTeto?: (agora: Date) => Promise<unknown> };

const MAX_EM_ANDAMENTO_POR_TENANT = 2; // RN-103
const MAX_PEDIDOS_POR_HORA = 30; // RN-103

function mensagemDoEstado(e: ReturnType<typeof estadoIaDoTenant>): string {
  return e === 'aditivo_desatualizado' ? MSG_IA.aditivoDesatualizado : MSG_IA.indisponivel;
}
/** US-110: a mensagem do paciente — sem ciência (US-104), com recusa (US-103) ou arquivado. */
function mensagemDoPaciente(motivo: MotivoFalha, recusou: boolean): string {
  if (motivo === 'paciente_nao_informado') return MSG_IA.semCiencia;
  return recusou ? MSG_IA.recusou : MSG_FALHA[motivo];
}

/** RN-103, com a linha do tenant já travada (D16): duas abas não passam do limite. */
async function conferirLimites(tx: Tx, usuaria: string, agora: Date): Promise<void> {
  const [{ andamento }] = await tx.select({ andamento: count() }).from(iaTarefas).where(inArray(iaTarefas.status, [...EM_ANDAMENTO]));
  if (andamento >= MAX_EM_ANDAMENTO_POR_TENANT) throw new PedidoIaError(MSG_IA.muitosPedidos);
  const [{ naHora }] = await tx
    .select({ naHora: count() })
    .from(iaTarefas)
    .where(and(eq(iaTarefas.pedidoPor, usuaria), gte(iaTarefas.criadoEm, new Date(agora.getTime() - 3_600_000))));
  if (naHora >= MAX_PEDIDOS_POR_HORA) throw new PedidoIaError(MSG_IA.muitosPedidos);
}

/**
 * US-110: cria a tarefa "na_fila" e enfileira o job, na MESMA transação (o job só existe se a tarefa existir). Ordem de
 * travas: paciente (carregarPacienteParaEscrita) → exame → tenant → (cota) linha do mês da plataforma. O gatilho de
 * auditoria grava o `criar` da entidade `ia` com o ator e o IP da sessão ("Pediu leitura à IA", RN-101). Nada sai ao provedor
 * aqui: o app não tem o SDK nem a chave (RNF-103).
 */
export async function pedirLeituraExame(ctx: TenantContext, tenant: TenantRow, patientId: string, examId: string, deps: DepsPedido): Promise<string> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const estado = estadoIaDoTenant(tenant, deps.ia.modo); // atalho barato; a decisão vale sob a trava D16, abaixo
  if (estado !== 'ativa') throw new PedidoIaError(mensagemDoEstado(estado));
  if (!idValido(examId) || !ctx.actorUserId) throw new PedidoIaError(MSG_FALHA.exame_indisponivel);
  const boss = deps.boss ?? (await getBoss());
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado/anonimizado → PacienteBloqueadoError
        const motivo = motivoDoPaciente(p);
        if (motivo) throw new PedidoIaError(mensagemDoPaciente(motivo, Boolean(p.iaRecusadaEm)));
        const [e] = await tx.select({ id: exams.id, arquivo: exams.arquivoPath }).from(exams).where(and(eq(exams.id, examId), eq(exams.patientId, p.id))).for('update');
        if (!e?.arquivo) throw new PedidoIaError(MSG_FALHA.exame_indisponivel);
        const [arq] = await tx.select({ mime: storedFiles.mime, bytes: storedFiles.bytes }).from(storedFiles).where(eq(storedFiles.caminho, e.arquivo));
        if (!arq || arq.bytes > IA_ARQUIVO_MAX_BYTES || !['application/pdf', 'image/jpeg', 'image/png'].includes(arq.mime)) throw new PedidoIaError(MSG_FALHA.arquivo_invalido);
        const [jaLendo] = await tx
          .select({ id: iaTarefas.id })
          .from(iaTarefas)
          .where(and(eq(iaTarefas.examId, e.id), inArray(iaTarefas.status, [...EM_ANDAMENTO])));
        if (jaLendo) throw new PedidoIaError(MSG_IA.emAndamento);
        // code review do PR #23: uma sugestão pronta e não vencida do mesmo exame barra o pedido (o laudo sairia de novo,
        // com custo em dobro, e a sugestão anterior sumiria da tela); a nutricionista descarta antes. O exame travado acima
        // serializa com a gravação da pronta no worker (etapa 6, mesma trava).
        const [jaPronta] = await tx
          .select({ id: iaTarefas.id })
          .from(iaTarefas)
          .where(and(eq(iaTarefas.examId, e.id), eq(iaTarefas.status, 'pronta'), or(isNull(iaTarefas.expiraEm), gt(iaTarefas.expiraEm, agora))));
        if (jaPronta) throw new PedidoIaError(MSG_IA.jaTemSugestao);
        // D16: decide com a linha travada do tenant de `ctx`, não com a cópia da action (desativar, bloqueio, suspensão ou
        // aditivo trocado entre a leitura e a trava não deixam tarefa, reserva nem "Pediu leitura à IA" — US-101, D19)
        const [tn] = await tx
          .select({ status: tenants.status, iaLiberada: tenants.iaLiberada, iaAtivadaEm: tenants.iaAtivadaEm, iaAditivoVersao: tenants.iaAditivoVersao })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .for('no key update');
        const estadoTravado = tn ? estadoIaDoTenant(tn, deps.ia.modo) : 'suspensa';
        if (estadoTravado !== 'ativa') throw new PedidoIaError(mensagemDoEstado(estadoTravado));
        await conferirLimites(tx, ctx.actorUserId!, agora);
        const tarefaId = randomUUID();
        const microUsd = reservaDaLeitura(deps.ia.modelo, deps.ia.geo, arq.mime === 'application/pdf' ? 'pdf' : 'imagem');
        await reservar(tx, { tenantId: ctx.tenantId, tarefaId, tipo: 'leitura_exame', modelo: deps.ia.modelo, promptVersao: PROMPT_VERSAO_LEITURA, microUsd, agora, tetoGlobalMicroUsd: deps.ia.tetoGlobalMicroUsd });
        await tx.insert(iaTarefas).values({
          id: tarefaId, tenantId: ctx.tenantId, patientId: p.id, tipo: 'leitura_exame', status: 'na_fila', examId: e.id, pedidoPor: ctx.actorUserId!,
          modelo: deps.ia.modelo, promptVersao: PROMPT_VERSAO_LEITURA, reservaMicroUsd: microUsd, criadoEm: agora, updatedAt: agora,
        });
        const job = await boss.send('ia', { tenantId: ctx.tenantId, tarefaId }, { db: fromDrizzle(tx, sql) });
        if (!job) throw new Error('A fila recusou o pedido de IA');
        return tarefaId;
      },
      db,
    );
  } catch (e) {
    if (uniqueViolation(e) === 'ia_tarefas_em_andamento_idx') throw new PedidoIaError(MSG_IA.emAndamento);
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

/** RNF-100: a situação para o painel (GET a cada 3 s) — sem auditoria, sem conteúdo. */
export async function estadoDaTarefa(ctx: TenantContext, tarefaId: string, db: Db = getDb()): Promise<{ status: StatusTarefa; erro: MotivoFalha | null } | null> {
  if (!idValido(tarefaId)) return null;
  const [t] = await withTenant(ctx, (tx) => tx.select({ status: iaTarefas.status, erro: iaTarefas.erro }).from(iaTarefas).where(eq(iaTarefas.id, tarefaId)), db);
  return t ? { status: t.status as StatusTarefa, erro: (t.erro as MotivoFalha | null) ?? null } : null;
}

export type SituacaoDoExame = { id: string; status: StatusTarefa; erro: MotivoFalha | null; expiraEm: Date | null };

/** A última tarefa de cada exame do paciente (só situação: a lista da aba Exames não audita, como a agenda). */
export async function tarefasDosExames(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Map<string, SituacaoDoExame>> {
  if (!idValido(patientId)) return new Map();
  const linhas = await withTenant(
    ctx,
    (tx) =>
      tx
        .selectDistinctOn([iaTarefas.examId], { examId: iaTarefas.examId, id: iaTarefas.id, status: iaTarefas.status, erro: iaTarefas.erro, expiraEm: iaTarefas.expiraEm })
        .from(iaTarefas)
        .where(and(eq(iaTarefas.patientId, patientId), sql`${iaTarefas.examId} is not null`))
        .orderBy(iaTarefas.examId, desc(iaTarefas.criadoEm)),
    db,
  );
  return new Map(linhas.map((l) => [l.examId!, { id: l.id, status: l.status as StatusTarefa, erro: (l.erro as MotivoFalha | null) ?? null, expiraEm: l.expiraEm }]));
}

/** D8: data em que cada tarefa aplicada foi conferida ("IA · conferido em {data}"). */
export async function marcasDeIa(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Map<string, Date>> {
  if (!idValido(patientId)) return new Map();
  const linhas = await withTenant(
    ctx,
    (tx) => tx.select({ id: iaTarefas.id, em: iaTarefas.encerradoEm }).from(iaTarefas).where(and(eq(iaTarefas.patientId, patientId), eq(iaTarefas.status, 'aplicada'))),
    db,
  );
  return new Map(linhas.filter((l) => l.em).map((l) => [l.id, l.em!]));
}
