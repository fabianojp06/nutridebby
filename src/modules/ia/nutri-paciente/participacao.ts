import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { iaNutriParticipacoes, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { carregarPacienteParaEscrita, idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { lerPausa } from '@/modules/plataforma/ia-nutri-pausa';
import type { ConfigIA } from '../modo';
import { IA_NUTRI_ADITIVO_VERSAO_MIN, versaoAtende } from '../textos-legais';
import { MSG_IA_NUTRI } from './constantes';
import { consentimentoVigente, estadoIaNutriDoTenant, ultimoEvento } from './estado';

export class IaNutriError extends Error {
  override name = 'IaNutriError';
  constructor(readonly mensagem: string) {
    super(mensagem);
  }
}
/** D33: liberar para quem tem "Não mostrar peso no app" pede a confirmação da nutricionista (a tela pergunta e reenvia). */
export class ConfirmarPesoOcultoError extends Error {
  override name = 'ConfirmarPesoOcultoError';
}

/**
 * US-170 "Ligar no consultório": só com a IA do consultório liberada pelo suporte e ativa (`ia_liberada`, como as outras
 * IAs) e o aditivo 1.2. Sem trava de texto em produção: o consentimento e o protocolo de risco são finais (★ DO-1 = não,
 * ★ DO-2 trocada, D37 — a IA Nutri liga pela definição da nutricionista). A pausa de emergência não impede ativar, mas o
 * aditivo é conferido À PARTE (/code-review do PR #37): `estadoIaNutriDoTenant` devolve `pausada` (pausa,
 * IA_NUTRI_DESLIGADA ou sem destino) ANTES de olhar o aditivo, e uma aba antiga ou um POST direto durante a pausa gravaria a
 * ativação num consultório só com a 1.1 — que, ao aceitar a 1.2, iria direto a `ativa` sem a tela de ativação (o aviso da
 * fila e o protocolo de risco, US-170, D7). O tenant travado (FOR NO KEY UPDATE, a ordem da cota) serializa com a admin.
 */
export async function ativarIaNutri(ctx: TenantContext, deps: { ia: ConfigIA; db?: Db }): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).for('no key update');
      const e = t ? estadoIaNutriDoTenant(t, deps.ia, await lerPausa(tx)) : 'sem_ia';
      if (!t || e === 'sem_ia') throw new IaNutriError(MSG_IA_NUTRI.naoDisponivel);
      if (e === 'aditivo_desatualizado' || !versaoAtende(t.iaAditivoVersao, IA_NUTRI_ADITIVO_VERSAO_MIN)) throw new IaNutriError(MSG_IA_NUTRI.aditivoNovo);
      await tx.update(tenants).set({ iaNutriAtivadaEm: sql`coalesce(${tenants.iaNutriAtivadaEm}, now())`, updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
    },
    deps.db ?? getDb(),
  );
  // `tenants` não é auditada: a ativação deixa trilha no log (só ids), como ativarIa/desativarIa (D21 da 14A)
  logger.info({ tenantId: ctx.tenantId, actorUserId: ctx.actorUserId ?? null }, 'IA Nutri ativada pela nutricionista');
}

/**
 * US-170 "Desligar no consultório": nenhuma pergunta nova; as que estão na fila são canceladas pelo job (passo 1, portão e
 * passo 6 conferem a ativação) com o estorno, e a varredura cobre o job perdido. A fila de dúvidas continua.
 */
export async function desativarIaNutri(ctx: TenantContext, deps: { db?: Db } = {}): Promise<void> {
  await withTenant(ctx, (tx) => tx.update(tenants).set({ iaNutriAtivadaEm: null, updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId)), deps.db ?? getDb());
  logger.info({ tenantId: ctx.tenantId, actorUserId: ctx.actorUserId ?? null }, 'IA Nutri desativada pela nutricionista');
}

/**
 * US-170 "Liberar um paciente" (D6) e D33 (peso oculto: confirmação). O paciente travado primeiro (ordem da cota); bloqueado
 * por pedido de exclusão ou anonimizado é só leitura (PacienteBloqueadoError). Em nome da nutricionista da sessão
 * (`liberada_por`; o gatilho de auditoria grava a entidade `ia_nutri_liberacao`, RN-183).
 */
export async function liberarPaciente(ctx: TenantContext, patientId: string, o: { confirmarPesoOculto: boolean; db?: Db }): Promise<void> {
  if (ctx.role !== 'nutri' || !ctx.actorUserId) throw new Error('liberarPaciente: só a sessão da nutricionista');
  const nutri = ctx.actorUserId;
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (p.pesoOcultoNoAppEm && !o.confirmarPesoOculto) throw new ConfirmarPesoOcultoError();
      const agora = new Date();
      await tx
        .insert(iaNutriParticipacoes)
        .values({ tenantId: ctx.tenantId, patientId: p.id, liberadaEm: agora, liberadaPor: nutri, updatedAt: agora })
        .onConflictDoUpdate({ target: [iaNutriParticipacoes.tenantId, iaNutriParticipacoes.patientId], set: { liberadaEm: agora, liberadaPor: nutri, bloqueadaEm: null, updatedAt: agora } });
    },
    o.db ?? getDb(),
  );
}

/** US-170 "Bloquear de novo": a entrada some (sem aviso); a pergunta na fila é cancelada pelo job; a conversa fica até o prazo. */
export async function bloquearPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const agora = new Date();
      await tx.update(iaNutriParticipacoes).set({ bloqueadaEm: agora, updatedAt: agora }).where(eq(iaNutriParticipacoes.patientId, p.id));
    },
    db,
  );
}

export type SituacaoNaFicha = { liberacao: 'nao' | 'aguardando' | 'em_uso' | 'bloqueada'; pesoOculto: boolean; podeRegistrarDesativacao: boolean };

/**
 * A aba "IA Nutri" da ficha (T11). Leitura simples por id (R6 do pre-flight): o paciente bloqueado por pedido de exclusão
 * também tem a aba e o "Registrar desativação a pedido do paciente" (DP-17) — carregarPacienteParaEscrita o recusaria.
 * Fora do tenant (a RLS esconde) ou id inválido → PacienteNaoEncontradoError (404).
 */
export async function situacaoNaFicha(ctx: TenantContext, patientId: string, destino: ConfigIA['destino'], db: Db = getDb()): Promise<SituacaoNaFicha> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: patients.id, pesoOcultoNoAppEm: patients.pesoOcultoNoAppEm }).from(patients).where(eq(patients.id, patientId));
      if (!p) throw new PacienteNaoEncontradoError();
      const [x] = await tx.select().from(iaNutriParticipacoes).where(eq(iaNutriParticipacoes.patientId, p.id));
      const ev = await ultimoEvento(tx, p.id);
      const pesoOculto = !!p.pesoOcultoNoAppEm;
      // DP-17: há o que desativar (consentimento em vigor, de qualquer versão ou destino) — vale também para arquivado e bloqueado
      const podeRegistrarDesativacao = ev?.evento === 'aceite';
      if (!x?.liberadaEm) return { liberacao: 'nao', pesoOculto, podeRegistrarDesativacao };
      if (x.bloqueadaEm) return { liberacao: 'bloqueada', pesoOculto, podeRegistrarDesativacao };
      return { liberacao: consentimentoVigente(ev, destino) ? 'em_uso' : 'aguardando', pesoOculto, podeRegistrarDesativacao };
    },
    db,
  );
}

/** A aba "IA Nutri" da ficha aparece com a IA Nutri ativada no consultório ou quando o paciente tem participação (T11). */
export async function temParticipacao(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<boolean> {
  if (!idValido(patientId)) return false;
  const [x] = await withTenant(ctx, (tx) => tx.select({ id: iaNutriParticipacoes.id }).from(iaNutriParticipacoes).where(eq(iaNutriParticipacoes.patientId, patientId)).limit(1), db);
  return !!x;
}
