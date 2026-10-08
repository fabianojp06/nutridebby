import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { signedDocuments, storedFiles } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { urlDoApp } from '@/lib/url-do-app';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { apagarArquivo, CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { COR_PADRAO } from '@/modules/plataforma/marca-constantes';
import { buscarTenant, listarTenantsParaVarredura, tenantIsActive } from '@/modules/plataforma/tenant-status';
import { soltarArquivosDoPreparo, travarDocumentoAntesDaCota } from './arquivos-do-preparo';
import { AREA_ASSINATURA, EMITIDOS } from './constantes';
import { renderizarDocumento } from './documento-pdf';
import type { ConteudoDocumento } from './parecer';

/** Só o worker importa este arquivo. */
export type DepsJobDocumento = { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarDocumento };
class JaProntoError extends Error {}
class TitularComExclusaoError extends Error {}

/**
 * US-143: lê o documento em preparo (a cópia congelada, RN-154), gera o PDF com a marca, o carimbo, o quadro "Assinatura
 * digital" e o código/QR (RN-142), e grava o base (SHA-256 e bytes: o prefixo da RN-144 (2)) no `registrar` do
 * salvarArquivo, levando a "Aguardando assinatura". Idempotente (só com pdf_status pendente). Ordem de travas: paciente →
 * documento → tenant (travarDocumentoAntesDaCota: a mesma do soltarArquivosDoPreparo, documento → tenant).
 * Versão lida (correção do /code-review high do PR #18): o `registrar` e o `marcarFalhou` casam id + "preparando" +
 * "pendente" + o CÓDIGO lido — "Voltar a editar" + novo preparo noutra aba troca o código, e o job velho (o PDF com o
 * código e o conteúdo antigos) não grava o base na versão nova nem a marca como "falhou".
 */
export async function gerarPdfDoDocumento(data: { tenantId: string; documentoId: string }, deps: DepsJobDocumento): Promise<'pronto' | 'ignorado' | 'falhou'> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const lido = await withTenant(ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente')));
    return d ?? null;
  }, db);
  if (!lido || !lido.codigo) return 'ignorado';
  const daVersao = and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente'), eq(signedDocuments.codigo, lido.codigo));
  const marcarFalhou = (pdfStatus: 'falhou' | 'sem_cota' = 'falhou') =>
    withTenant(ctx, (tx) => tx.update(signedDocuments).set({ pdfStatus, updatedAt: now }).where(daVersao), db);
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorado';
  }
  try {
    const tenant = (await buscarTenant(db, data.tenantId))!;
    const logo = tenant.logoPath ? await readFile(resolverCaminho(deps.dataDir, tenant.logoPath)).catch(() => null) : null;
    // o Plano 10B (T1) acrescenta aqui o campo pré-criado, se o relatório do spike pedir
    const pdf = await (deps.renderizar ?? renderizarDocumento)({
      conteudo: lido.conteudo as ConteudoDocumento,
      codigo: lido.codigo,
      urlVerificacao: urlDoApp(deps.appUrl, `/v/${lido.codigo}`),
      data: formatarData(hojeNoFuso(tenant.fuso, lido.declaracaoEm ?? now)),
      cor: tenant.corPrimaria ?? COR_PADRAO,
      logo,
      nomeConsultorio: tenant.nomeExibicao,
    });
    const sha = createHash('sha256').update(pdf).digest('hex');
    await salvarArquivo(
      ctx,
      {
        tipo: 'documento_base',
        conteudo: pdf,
        permitidos: ['pdf'],
        patientId: lido.patientId,
        // paciente → versão nova → tenant (P13-16 a): a original não muda com o PDF base
        antesDaReserva: (tx) => travarDocumentoAntesDaCota(tx, lido, { original: false, recusa: () => new TitularComExclusaoError() }),
        registrar: async (tx, arq) => {
          const r = await tx
            .update(signedDocuments)
            .set({ status: 'aguardando_assinatura', pdfStatus: 'pronto', basePdfPath: arq.caminho, basePdfSha256: sha, basePdfBytes: pdf.length, areaAssinatura: AREA_ASSINATURA })
            .where(daVersao)
            .returning({ id: signedDocuments.id });
          if (!r.length) throw new JaProntoError(); // já pronto, ou outra versão (outro código) no meio
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return 'pronto';
  } catch (e) {
    if (e instanceof JaProntoError) return 'ignorado';
    if (e instanceof TitularComExclusaoError) {
      await marcarFalhou();
      return 'ignorado';
    }
    if (e instanceof CotaEsgotadaError || deps.ultimaTentativa) {
      logger.warn({ documentoId: data.documentoId, tenantId: data.tenantId, motivo: e instanceof CotaEsgotadaError ? 'cota' : 'erro' }, 'PDF do documento não gerado');
      await marcarFalhou(e instanceof CotaEsgotadaError ? 'sem_cota' : 'falhou'); // RNF-143: a tela mostra a mensagem da cota
      return 'falhou';
    }
    throw e;
  }
}

export const PDF_DOCUMENTO_PENDENTE_MAX_MS = 3600_000;

/** `o.tenantId`: só os testes (banco compartilhado: varrer todos os tenants com o relógio adiantado mexeria nos documentos de outros testes). */
const tenantsDaVarredura = async (db: Db, o: { tenantId?: string }) => (o.tenantId ? [{ id: o.tenantId }] : await listarTenantsParaVarredura(db));

/**
 * Rede de segurança do "Preparando o PDF…" (como expirarPdfsPendentes do plano) e da digitalização (D24, Minor da revisão
 * de cobertura): "recebendo" ou "pendente" com mais de 1 h viram "falhou" (a tela oferece enviar as fotos de novo; o
 * job atrasado que chegar depois não casa mais). Um tenant com erro não para os outros.
 */
export async function expirarPdfsDeDocumentoPendentes(db: Db, now: Date, o: { tenantId?: string } = {}): Promise<number> {
  const limite = new Date(now.getTime() - PDF_DOCUMENTO_PENDENTE_MAX_MS);
  let n = 0;
  for (const t of await tenantsDaVarredura(db, o)) {
    try {
      const r = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) =>
        tx.update(signedDocuments).set({ pdfStatus: 'falhou', updatedAt: now })
          .where(and(eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente'), lt(sql`coalesce(${signedDocuments.pdfPedidoEm}, ${signedDocuments.updatedAt})`, limite)))
          .returning({ id: signedDocuments.id }), db);
      const dig = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) =>
        tx.update(signedDocuments).set({ digitalizacaoStatus: 'falhou', updatedAt: now })
          .where(and(eq(signedDocuments.status, 'aguardando_assinatura'), inArray(signedDocuments.digitalizacaoStatus, ['recebendo', 'pendente']), lt(sql`coalesce(${signedDocuments.digitalizacaoEm}, ${signedDocuments.updatedAt})`, limite)))
          .returning({ id: signedDocuments.id }), db);
      n += r.length + dig.length;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao expirar PDFs de documento pendentes');
    }
  }
  return n;
}

/**
 * RN-140 (b) e RN-157: (1) o PDF base e as fotos da digitalizada sem documento que aponte para eles, com mais de 1 h, saem
 * do disco e da cota (a referência é conferida de novo no naMesmaTransacao); (2) regra 9: o que a assinatura deixou
 * apontado num documento emitido (o soltarArquivosDoPreparo logo depois dela falhou) sai pelo mesmo soltarArquivosDoPreparo.
 */
export async function limparArquivosOrfaosDeDocumentos(db: Db, now: Date, dataDir: string, o: { tenantId?: string } = {}): Promise<number> {
  const limite = new Date(now.getTime() - PDF_DOCUMENTO_PENDENTE_MAX_MS);
  let n = 0;
  for (const t of await tenantsDaVarredura(db, o)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    const semReferencia = sql`not exists (select 1 from signed_documents d where d.tenant_id = ${storedFiles.tenantId} and (d.base_pdf_path = ${storedFiles.caminho} or d.digitalizacao ? ${storedFiles.caminho}))`;
    try {
      const orfaos = await withTenant(ctx, (tx) =>
        tx.select({ caminho: storedFiles.caminho }).from(storedFiles)
          .where(and(inArray(storedFiles.tipo, ['documento_base', 'documento_digitalizado']), lt(storedFiles.createdAt, limite), semReferencia)), db);
      for (const o of orfaos) {
        const ok = await apagarArquivo(ctx, { caminho: o.caminho }, {
          db, dataDir,
          naMesmaTransacao: async (tx) => (await tx.select({ c: storedFiles.caminho }).from(storedFiles).where(and(eq(storedFiles.caminho, o.caminho), semReferencia))).length > 0,
        });
        if (ok) n++;
      }
      const sobras = await withTenant(ctx, (tx) =>
        tx.select({ id: signedDocuments.id }).from(signedDocuments)
          .where(and(inArray(signedDocuments.status, [...EMITIDOS]), or(isNotNull(signedDocuments.basePdfPath), isNotNull(signedDocuments.digitalizacao)))), db);
      for (const s of sobras) n += await soltarArquivosDoPreparo(ctx, s.id, EMITIDOS, { db, dataDir });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao limpar arquivos órfãos de documentos');
    }
  }
  return n;
}
