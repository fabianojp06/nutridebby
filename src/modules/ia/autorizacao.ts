import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaAutorizacoes, type IaAutorizacaoRow, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { cancelarTarefas } from './cancelar';
import type { CanalAutorizacao, DestinoIA, MotivoFalha, UsoIA } from './constantes';
import { AUTORIZACAO_IA_VERSAO_MIN, versaoAtende } from './textos-legais';

/**
 * Plano 14A (spec da IA v0.5.1, RN-107 a RN-109, A-D23 a A-D25): a autorização do paciente para o uso de IA. Esta é a parte
 * de LEITURA (a situação, a RN-100 do paciente) e a retirada registrada pela nutricionista; a T5 acrescenta o resto da
 * escrita (app, pedido por e-mail, papel). Cada linha de `ia_autorizacoes` é um evento, só de inclusão (0108).
 */
export type SituacaoAutorizacao =
  | { tipo: 'nunca' }
  | { tipo: 'vigente'; id: string; em: Date; canal: CanalAutorizacao; versao: string; destino: DestinoIA; usos: UsoIA[] }
  | { tipo: 'retirada'; id: string; em: Date; canal: CanalAutorizacao }
  | { tipo: 'versao_antiga'; id: string; em: Date; canal: CanalAutorizacao; versao: string }
  | { tipo: 'outro_destino'; id: string; em: Date; canal: CanalAutorizacao; versao: string; destino: DestinoIA };

export type EventoDeDecisao = Pick<IaAutorizacaoRow, 'id' | 'evento' | 'versao' | 'usos' | 'destino' | 'canal' | 'em' | 'registradoEm'>;

/**
 * RN-107 (D7): o último evento de decisão (`autorizou`/`retirou`) decide. Vigente = `autorizou`, versão ≥ o mínimo e o
 * destino do provedor em uso (RN-109); o uso é conferido por `vigentePara`. Com `destino` nulo (IA_PROVEDOR ausente), o
 * destino não é conferido — só a tela usa assim; a RN-100 nunca chega aqui sem provedor.
 */
export function situacaoDaAutorizacao(ultimo: EventoDeDecisao | null, destino: DestinoIA | null): SituacaoAutorizacao {
  if (!ultimo) return { tipo: 'nunca' };
  const base = { id: ultimo.id, em: ultimo.em, canal: ultimo.canal as CanalAutorizacao };
  if (ultimo.evento === 'retirou') return { tipo: 'retirada', ...base };
  const versao = ultimo.versao ?? '';
  if (!versaoAtende(versao, AUTORIZACAO_IA_VERSAO_MIN)) return { tipo: 'versao_antiga', ...base, versao };
  const doEvento = ultimo.destino as DestinoIA;
  if (destino !== null && doEvento !== destino) return { tipo: 'outro_destino', ...base, versao, destino: doEvento };
  return { tipo: 'vigente', ...base, versao, destino: doEvento, usos: (ultimo.usos ?? []) as UsoIA[] };
}

export const vigentePara = (s: SituacaoAutorizacao, uso: UsoIA): boolean => s.tipo === 'vigente' && s.usos.includes(uso);

/** O último `autorizou`/`retirou` do paciente (por `registrado_em`, o relógio do banco depois da trava; desempate pelo id). */
export async function ultimaDecisao(tx: Tx, patientId: string): Promise<EventoDeDecisao | null> {
  const [u] = await tx
    .select({ id: iaAutorizacoes.id, evento: iaAutorizacoes.evento, versao: iaAutorizacoes.versao, usos: iaAutorizacoes.usos, destino: iaAutorizacoes.destino, canal: iaAutorizacoes.canal, em: iaAutorizacoes.em, registradoEm: iaAutorizacoes.registradoEm })
    .from(iaAutorizacoes)
    .where(and(eq(iaAutorizacoes.patientId, patientId), inArray(iaAutorizacoes.evento, ['autorizou', 'retirou'])))
    .orderBy(desc(iaAutorizacoes.registradoEm), desc(iaAutorizacoes.id))
    .limit(1);
  return u ?? null;
}

/** Dentro de withTenant. Quem decide algo com ela trava o paciente ANTES (a retirada trava o paciente FOR UPDATE). */
export async function autorizacaoDoPaciente(tx: Tx, patientId: string, destino: DestinoIA | null): Promise<SituacaoAutorizacao> {
  return situacaoDaAutorizacao(await ultimaDecisao(tx, patientId), destino);
}

/** A última `retirou` do paciente (por `registrado_em`, o relógio do banco depois da trava; desempate pelo id). */
export async function ultimaRetirada(tx: Tx, patientId: string): Promise<Pick<EventoDeDecisao, 'id' | 'canal' | 'em' | 'registradoEm'> | null> {
  const [r] = await tx
    .select({ id: iaAutorizacoes.id, canal: iaAutorizacoes.canal, em: iaAutorizacoes.em, registradoEm: iaAutorizacoes.registradoEm })
    .from(iaAutorizacoes)
    .where(and(eq(iaAutorizacoes.patientId, patientId), eq(iaAutorizacoes.evento, 'retirou')))
    .orderBy(desc(iaAutorizacoes.registradoEm), desc(iaAutorizacoes.id))
    .limit(1);
  return r ?? null;
}

/**
 * RN-108 (D14) para uma tarefa JÁ pedida: "se o paciente autorizou de novo, cancela só as tarefas criadas antes da
 * retirada" — a mesma regra do `criadasAntesDe` do job ia-retirada. A tarefa criada antes da última retirada vale como
 * retirada mesmo com a reautorização vigente: não sai (portão), não é gravada (passo 6), não é aplicada e a varredura a
 * cancela. `criado_em` e `registrado_em` vêm do relógio do banco, os dois depois da trava do paciente (pedirLeituraExame,
 * gatilho ia_autorizacoes_regras): a ordem entre eles é a ordem real.
 */
export function situacaoParaTarefa(s: SituacaoAutorizacao, retirada: Pick<EventoDeDecisao, 'id' | 'canal' | 'em' | 'registradoEm'> | null, criadoEm: Date): SituacaoAutorizacao {
  if (s.tipo === 'vigente' && retirada && criadoEm < retirada.registradoEm) return { tipo: 'retirada', id: retirada.id, em: retirada.em, canal: retirada.canal as CanalAutorizacao };
  return s;
}

/** Dentro de withTenant, com o paciente travado: a situação da autorização para uma tarefa já pedida (RN-100 + RN-108/D14). */
export async function autorizacaoDaTarefa(tx: Tx, t: { patientId: string; criadoEm: Date }, destino: DestinoIA | null): Promise<SituacaoAutorizacao> {
  return situacaoParaTarefa(await autorizacaoDoPaciente(tx, t.patientId, destino), await ultimaRetirada(tx, t.patientId), t.criadoEm);
}

/** RN-100 (parte do paciente, D8): ativo e com a autorização vigente para o uso. No app, no worker e ao aplicar. */
export function motivoDoPaciente(p: Pick<PatientRow, 'status' | 'anonimizadoEm'>, s: SituacaoAutorizacao, uso: UsoIA): MotivoFalha | null {
  if (p.status !== 'ativo' || p.anonimizadoEm) return 'paciente_indisponivel';
  return vigentePara(s, uso) ? null : 'sem_autorizacao';
}

/** Para as telas (exames, exames recebidos): a situação, sem auditoria — não é dado de saúde (AUDIT_EXCEPTIONS). */
export async function situacaoIaDoPaciente(ctx: TenantContext, patientId: string, destino: DestinoIA | null, db: Db = getDb()): Promise<SituacaoAutorizacao> {
  if (!idValido(patientId)) return { tipo: 'nunca' };
  return withTenant(ctx, (tx) => autorizacaoDoPaciente(tx, patientId, destino), db);
}

/**
 * US-109 "Retirada a pedido, pela nutricionista" (RN-108): na MESMA transação, o evento `retirou` (canal `nutricionista`)
 * e o cancelamento da fila e das sugestões prontas do paciente — como o `definirRecusaIa` do Plano 11. Ordem de travas da
 * cota: paciente (carregarPacienteParaEscrita) → tenant (cancelarTarefas) → tarefas → ia_uso → plataforma. Funciona com a
 * IA bloqueada pela admin, desativada ou em emergência (a retirada é sempre possível, US-105). Sem nada a retirar → false.
 */
export async function registrarRetiradaPelaNutri(ctx: TenantContext, patientId: string, deps: { db?: Db; agora?: Date } = {}): Promise<boolean> {
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const s = await autorizacaoDoPaciente(tx, p.id, null);
      if (s.tipo === 'nunca' || s.tipo === 'retirada') return false;
      await tx.insert(iaAutorizacoes).values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'retirou', canal: 'nutricionista', registradoPor: ctx.actorUserId! });
      await cancelarTarefas(tx, { tenantId: ctx.tenantId, patientId: p.id, agora, por: ctx.actorUserId ?? null });
      return true;
    },
    deps.db ?? getDb(),
  );
}
