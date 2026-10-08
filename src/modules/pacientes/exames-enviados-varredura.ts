import { and, eq, inArray, isNotNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { Db, Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions, patients, storedFiles } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger, nomeDoErro, sqlstateDoErro } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { avisarEnvioAtualizado } from '@/modules/portal/avisos';
import { apagarArquivosDoEnvio } from './exames-enviados-arquivos';
import { ENVIO_EXPIRA_DIAS } from './exames-enviados-constantes';

/** As tentativas do job `exame-envio` somam poucos minutos (30 s, 60 s de espera + até 300 s cada): 30 min parado é abandono. */
export const ENVIO_PARADO_MAX_MS = 30 * 60_000;
const ORFAO_MIN_MS = 3600_000;
const JOB_VIVO = new Set(['created', 'retry', 'active']);
const DIA_MS = 86_400_000;

/** RN-166: o paciente cancelou; o worker apaga o PDF limpo e as páginas (a sessão de paciente não apaga stored_files). Idempotente. */
export function limparEnvio(data: { tenantId: string; envioId: string }, deps: { db: Db; dataDir: string }): Promise<number> {
  return apagarArquivosDoEnvio({ tenantId: data.tenantId, role: 'worker' }, data.envioId, deps);
}

/**
 * Fila `expirar-exame-envio`, de 15 em 15 min (RN-163, RN-167; molde de expirarFotosPendentes e de
 * limparArquivosOrfaosDeDocumentos):
 * 1. "processando" parado há mais de 30 min sem job vivo → "falhou" (interrompido) e os arquivos saem. Não reprocessa: se a
 *    queda foi falta de memória com este arquivo, cada varredura derrubaria o worker outra vez (D12).
 * 2. "recebido" há 90 dias → "expirado" (D15 = b): o PDF limpo sai no apagarArquivo cujo naMesmaTransacao marca o envio e
 *    grava o push neutro; as páginas logo depois. O lembrete dos 30 dias vai no e-mail de envio novo (PM-12).
 * 3. Sobras: arquivo de envio que já não está vivo (cancelado cujo job de limpeza falhou, páginas de aceito ou recusado,
 *    original de um "recebido") e, por defesa, arquivo de envio sem linha que aponte para ele, com mais de 1 h — inclusive o PDF
 *    limpo (`exame`) que nenhum exame nem envio aponta (revisão do plano).
 * Um tenant com erro não para os outros, e um envio ou arquivo com erro não para o resto do tenant (o próximo ciclo tenta de novo);
 * log só com contagens, ids e o nome/SQLSTATE do erro, nunca a mensagem (RNF-11). `o.tenantId`: só os testes.
 */
export async function varrerEnvios(
  deps: { db: Db; dataDir: string; boss: Pick<PgBoss, 'findJobs'> },
  agora: Date,
  o: { tenantId?: string } = {},
): Promise<{ interrompidos: number; expirados: number; arquivos: number }> {
  const r = { interrompidos: 0, expirados: 0, arquivos: 0 };
  const arquivos = { db: deps.db, dataDir: deps.dataDir };
  const falha = (err: unknown, tenantId: string, etapa: string, id?: string) =>
    logger.error({ err: nomeDoErro(err), sqlstate: sqlstateDoErro(err), tenantId, ...(id ? { id } : {}), etapa }, 'falha ao varrer os envios de exame');
  /** Isola cada item: o erro de um envio (ou arquivo) não impede os outros nem as etapas seguintes do tenant. */
  const cadaUm = async <T>(itens: readonly T[], tenantId: string, etapa: string, id: (i: T) => string, fn: (i: T) => Promise<void>) => {
    for (const i of itens) await fn(i).catch((err: unknown) => falha(err, tenantId, etapa, id(i)));
  };
  for (const t of o.tenantId ? [{ id: o.tenantId }] : await listarTenantsParaVarredura(deps.db)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    try {
      const parados = await withTenant(
        ctx,
        (tx) => tx.select({ id: examSubmissions.id }).from(examSubmissions).where(and(eq(examSubmissions.status, 'processando'), lt(examSubmissions.updatedAt, new Date(agora.getTime() - ENVIO_PARADO_MAX_MS)))),
        deps.db,
      );
      await cadaUm(parados, t.id, 'interrompido', (e) => e.id, async (e) => {
        const jobs = await deps.boss.findJobs<{ envioId: string }>('exame-envio', { data: { envioId: e.id } });
        if (jobs.some((j) => JOB_VIVO.has(j.state))) return;
        const marcado = await withTenant(
          ctx,
          (tx) =>
            tx
              .update(examSubmissions)
              .set({ status: 'falhou', motivoFalha: 'interrompido', updatedAt: agora })
              .where(and(eq(examSubmissions.id, e.id), eq(examSubmissions.status, 'processando')))
              .returning({ id: examSubmissions.id }),
          deps.db,
        );
        if (marcado.length) r.interrompidos++;
        r.arquivos += await apagarArquivosDoEnvio(ctx, e.id, arquivos);
      });

      const vencidos = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: examSubmissions.id, patientId: examSubmissions.patientId, pdf: examSubmissions.arquivoPath })
            .from(examSubmissions)
            .where(and(eq(examSubmissions.status, 'recebido'), lt(examSubmissions.createdAt, new Date(agora.getTime() - ENVIO_EXPIRA_DIAS * DIA_MS)))),
        deps.db,
      );
      await cadaUm(vencidos, t.id, 'expiracao', (v) => v.id, async (v) => {
        const expirar = async (tx: Tx): Promise<boolean> => {
          // revisão do plano: paciente → envio → tenant, a ordem do aceite e da recusa (travarEnvioRecebido) e do
          // travarParaGravar — o INSERT do push (notifications → patients) pede KEY SHARE no paciente; sem esta trava, a expiração
          // seguraria o envio e esperaria o paciente travado pelo aceite, que espera o envio (40P01). Não recusa o bloqueado.
          await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, v.patientId)).for('update');
          const u = await tx
            .update(examSubmissions)
            .set({ status: 'expirado', arquivoPath: null, updatedAt: agora })
            .where(and(eq(examSubmissions.id, v.id), eq(examSubmissions.status, 'recebido')))
            .returning({ id: examSubmissions.id });
          if (!u.length) return false;
          await avisarEnvioAtualizado(tx, { tenantId: t.id, patientId: v.patientId, tipo: 'exame_expirado' }, agora);
          return true;
        };
        const ok = v.pdf ? await apagarArquivo(ctx, { caminho: v.pdf }, { ...arquivos, naMesmaTransacao: expirar }) : await withTenant(ctx, expirar, deps.db);
        if (ok) {
          r.expirados++;
          if (v.pdf) r.arquivos++;
        }
        r.arquivos += await apagarArquivosDoEnvio(ctx, v.id, arquivos);
      });

      const sobras = await withTenant(
        ctx,
        (tx) =>
          tx
            .selectDistinct({ id: examSubmissions.id })
            .from(examSubmissions)
            .leftJoin(examSubmissionFiles, eq(examSubmissionFiles.submissionId, examSubmissions.id))
            .where(and(notInArray(examSubmissions.status, ['processando', 'recebido']), or(isNotNull(examSubmissions.arquivoPath), isNotNull(examSubmissionFiles.id)))),
        deps.db,
      );
      await cadaUm(sobras, t.id, 'sobras', (s) => s.id, async (s) => void (r.arquivos += await apagarArquivosDoEnvio(ctx, s.id, arquivos)));
      const originaisDeRecebido = await withTenant(
        ctx,
        (tx) =>
          tx
            .selectDistinct({ id: examSubmissions.id })
            .from(examSubmissions)
            .innerJoin(examSubmissionFiles, eq(examSubmissionFiles.submissionId, examSubmissions.id))
            .where(and(eq(examSubmissions.status, 'recebido'), eq(examSubmissionFiles.papel, 'original'))),
        deps.db,
      );
      await cadaUm(originaisDeRecebido, t.id, 'originais', (s) => s.id, async (s) => void (r.arquivos += await apagarArquivosDoEnvio(ctx, s.id, { ...arquivos, papel: 'original' })));

      // revisão do plano: também o PDF limpo (`exame`) que nenhum exame nem envio aponta — o ponteiro do envio cancelado agora
      // sobrevive até a limpeza, e um `exame` solto não pode ficar contando na cota
      const semDono = sql`((${storedFiles.tipo} in ('exame_original', 'exame_pagina')
          and not exists (select 1 from exam_submission_files f where f.tenant_id = ${storedFiles.tenantId} and f.arquivo_path = ${storedFiles.caminho}))
        or (${storedFiles.tipo} = 'exame'
          and not exists (select 1 from exams x where x.tenant_id = ${storedFiles.tenantId} and x.arquivo_path = ${storedFiles.caminho})
          and not exists (select 1 from exam_submissions s where s.tenant_id = ${storedFiles.tenantId} and s.arquivo_path = ${storedFiles.caminho})))`;
      const orfaos = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: storedFiles.id, caminho: storedFiles.caminho })
            .from(storedFiles)
            .where(and(inArray(storedFiles.tipo, ['exame_original', 'exame_pagina', 'exame']), lt(storedFiles.createdAt, new Date(agora.getTime() - ORFAO_MIN_MS)), semDono)),
        deps.db,
      );
      // log com o id do stored_files, nunca o caminho (que leva o tenant e o paciente)
      await cadaUm(orfaos, t.id, 'orfaos', (f) => f.id, async (f) => {
        const ok = await apagarArquivo(ctx, { caminho: f.caminho }, {
          ...arquivos,
          naMesmaTransacao: async (tx) => (await tx.select({ c: storedFiles.caminho }).from(storedFiles).where(and(eq(storedFiles.caminho, f.caminho), semDono))).length > 0,
        });
        if (ok) r.arquivos++;
      });
    } catch (err) {
      falha(err, t.id, 'tenant');
    }
  }
  if (r.interrompidos || r.expirados || r.arquivos) logger.info(r, 'varredura dos envios de exame');
  return r;
}
