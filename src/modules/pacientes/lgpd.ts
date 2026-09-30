import { and, eq, isNotNull, isNull, lt, max, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { consultations, dataExports, exams, patients, privacyRequests } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { logger } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { carregarPacienteParaEscrita } from './base';
import { apagarConvitesPendentes } from './convite-paciente';
import { formatarData, hojeNoFuso, somarAnos, somarDias } from './datas';

/** P-01: referência da spec (20 anos, Lei 13.787/2018). Validar com CRN/advogado antes do go-live. */
export const PRAZO_GUARDA_ANOS = 20;
/** RNF-08 / §7 privacy_requests: prazo de resposta ao titular. */
export const PRAZO_RESPOSTA_DIAS = 15;

export const MSG_LGPD = {
  confirmarNome: 'Digite o nome do paciente exatamente como está no cadastro para confirmar.',
} as const;

export class LgpdError extends Error {
  override name = 'LgpdError';
}

/** RN-08: o prontuário fica; portal, notificações e audiências leem o status (Planos 05, 06 e 07). */
export async function arquivarPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (p.status !== 'ativo') return;
      await tx.update(patients).set({ status: 'arquivado', updatedAt: new Date() }).where(eq(patients.id, p.id));
      await apagarConvitesPendentes(tx, ctx.tenantId, p.id);
    },
    db,
  );
}

export async function desarquivarPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado → PacienteBloqueadoError
      if (p.status === 'arquivado') await tx.update(patients).set({ status: 'ativo', updatedAt: new Date() }).where(eq(patients.id, p.id));
    },
    db,
  );
}

const nomeParaConferir = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * US-018 "Pedido de exclusão durante o prazo de guarda": o prontuário clínico fica identificado e só
 * para consulta (status `bloqueado`); saem na hora os dados não obrigatórios (opt-ins, convites).
 * `anonimizar_apos` = última consulta (ou hoje) + PRAZO_GUARDA_ANOS. Tudo numa transação, com o
 * e-mail ao paciente na fila. Planos 05 e 06: apagar aqui também inscrições de push e fotos do diário.
 */
export async function atenderPedidoExclusao(
  ctx: TenantContext,
  tenant: { fuso: string; nomeExibicao: string },
  patientId: string,
  nomeDigitado: string,
  deps: { db?: Db; now?: Date } = {},
): Promise<{ anonimizarApos: string }> {
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (!nomeDigitado.trim() || nomeParaConferir(nomeDigitado) !== nomeParaConferir(p.nome)) throw new LgpdError(MSG_LGPD.confirmarNome);
      const hoje = hojeNoFuso(tenant.fuso, now);
      const [{ ultima }] = await tx.select({ ultima: max(consultations.data) }).from(consultations).where(eq(consultations.patientId, p.id));
      const anonimizarApos = somarAnos(ultima ?? hoje, PRAZO_GUARDA_ANOS);

      const [aberto] = await tx
        .select({ id: privacyRequests.id })
        .from(privacyRequests)
        .where(and(eq(privacyRequests.patientId, p.id), eq(privacyRequests.tipo, 'exclusao'), eq(privacyRequests.status, 'aberto')))
        .for('update');
      if (aberto) await tx.update(privacyRequests).set({ status: 'concluido', concluidoEm: now }).where(eq(privacyRequests.id, aberto.id));
      else {
        await tx.insert(privacyRequests).values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          tipo: 'exclusao',
          status: 'concluido',
          prazo: somarDias(hoje, PRAZO_RESPOSTA_DIAS),
          concluidoEm: now,
          createdAt: now,
        });
      }
      await tx
        .update(patients)
        .set({ status: 'bloqueado', bloqueadoEm: now, anonimizarApos, whatsappOptinEm: null, whatsappOptinOrigem: null, whatsappOptoutEm: now, updatedAt: now })
        .where(eq(patients.id, p.id));
      await apagarConvitesPendentes(tx, ctx.tenantId, p.id);
      await recordAudit(tx, { acao: 'bloquear', entidade: 'patients', entidadeId: p.id, patientId: p.id });
      await enqueueEmail(
        { tipo: 'exclusao_atendida', para: p.email, nome: p.nome, nutri: tenant.nomeExibicao, anonimizarApos: formatarData(anonimizarApos) },
        { tenantId: ctx.tenantId, tx },
      );
      return { anonimizarApos };
    },
    deps.db ?? getDb(),
  );
}

/** Arquivos em /data ligados ao paciente: laudos e exportações. */
export async function anexosDoPaciente(tx: Tx, patientId: string): Promise<string[]> {
  const deExames = await tx.select({ c: exams.arquivoPath }).from(exams).where(and(eq(exams.patientId, patientId), isNotNull(exams.arquivoPath)));
  const deExportacoes = await tx.select({ c: dataExports.arquivoPath }).from(dataExports).where(and(eq(dataExports.patientId, patientId), isNotNull(dataExports.arquivoPath)));
  return [...deExames, ...deExportacoes].map((e) => e.c!);
}

/**
 * US-018 "Fim do prazo de guarda": job diário (fila retencao-lgpd). Para cada tenant (§4.1: a varredura
 * parte de `tenants`), anonimiza quem está bloqueado com `anonimizar_apos` já passado no fuso do tenant
 * ("guardado até 15/09/2046; depois dessa data…": no próprio dia 15 ainda não).
 * Primeiro os anexos, com o `rm` confirmado antes do commit (se o arquivo não sair do disco, o registro
 * fica e o dia seguinte tenta de novo), depois a identificação. Um tenant com erro não para os outros.
 */
export async function anonimizarVencidos(db: Db, now: Date, deps: { dataDir?: string } = {}): Promise<{ anonimizados: number }> {
  let anonimizados = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    const hoje = hojeNoFuso(t.fuso, now);
    let vencidos: { id: string }[];
    try {
      vencidos = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: patients.id })
            .from(patients)
            .where(and(eq(patients.status, 'bloqueado'), isNull(patients.anonimizadoEm), lt(patients.anonimizarApos, hoje))),
        db,
      );
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), tenantId: t.id }, 'falha ao listar pacientes a anonimizar');
      continue;
    }
    for (const { id } of vencidos) {
      try {
        for (const caminho of await withTenant(ctx, (tx) => anexosDoPaciente(tx, id), db)) {
          await apagarArquivo(ctx, { caminho }, { db, dataDir: deps.dataDir, removerAntesDoCommit: true });
        }
        const feito = await withTenant(
          ctx,
          async (tx) => {
            const r = await tx
              .update(patients)
              .set({
                nome: 'Paciente anonimizado',
                email: sql`'anonimo-' || ${patients.id}::text || '@anonimizado.invalid'`,
                telefoneE164: null,
                dataNascimento: null,
                userId: null,
                anonimizadoEm: now,
                updatedAt: now,
              })
              .where(and(eq(patients.id, id), isNull(patients.anonimizadoEm)))
              .returning({ id: patients.id });
            if (r.length) await recordAudit(tx, { acao: 'anonimizar', entidade: 'patients', entidadeId: id, patientId: id });
            return r.length > 0;
          },
          db,
        );
        if (feito) anonimizados++;
      } catch (err) {
        // Sem nome nem dado do paciente no log (RNF-11); o próximo dia tenta de novo
        logger.error({ err: err instanceof Error ? err.message : String(err), tenantId: t.id }, 'falha ao anonimizar paciente');
      }
    }
  }
  return { anonimizados };
}
