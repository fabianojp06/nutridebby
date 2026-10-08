import { readFile } from 'node:fs/promises';
import { Document, Image, Page, renderToBuffer } from '@react-pdf/renderer';
import { and, asc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Db, Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { paraJpegSemMetadados } from '@/lib/jpeg';
import { logger } from '@/lib/logger';
import { CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { fotoParaJpeg, FotoInvalidaError, type AbrirHeic } from '@/modules/portal/diario-foto-job';
import { apagarArquivosDoEnvio } from './exames-enviados-arquivos';
import { avisarExamesRecebidos } from './exames-enviados-aviso';
import { ENVIO_LADO_MAX, ENVIO_MAX_PAGINAS, ENVIO_QUALIDADE_JPEG, MAX_PIXELS_IMAGEM_PDF, type MotivoFalhaEnvio } from './exames-enviados-constantes';
import { RasterizacaoError, rasterizarPdf } from './rasterizar-pdf';

// Só o worker importa este arquivo (@react-pdf, sharp, heic-decode, a rasterização): guarda em exames-enviados-guardas.test.ts.

export type DadosEnvio = { tenantId: string; envioId: string };
export type DepsProcessar = {
  db: Db;
  dataDir: string;
  appUrl: string;
  ultimaTentativa: boolean;
  agora?: () => Date;
  abrirHeic?: AbrirHeic;
  rasterizar?: typeof rasterizarPdf;
  renderizar?: typeof renderizarPdfLimpo;
};

/** D23 = a: o PDF LIMPO — só as imagens de página, uma por página A4, na ordem; nada do original (R-170). */
export async function renderizarPdfLimpo(paginas: readonly Buffer[]): Promise<Buffer> {
  return renderToBuffer(
    <Document title="Exame" creator="NutriDebby" producer="NutriDebby">
      {paginas.map((p, i) => (
        <Page key={i} size="A4">
          {/* margem de 24 pt por posição absoluta: com padding + height 100% o @react-pdf avisa "can't wrap between pages" */}
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          <Image src={{ data: p, format: 'jpg' }} style={{ position: 'absolute', top: 24, right: 24, bottom: 24, left: 24, objectFit: 'contain' }} />
        </Page>
      ))}
    </Document>,
  );
}

/**
 * RN-163, a conversão SEM banco (revisão do plano: é o que a medida do RNF-162 do job inteiro mede, num Node novo): cada
 * original vira JPEG de página — a foto pelo pipeline do diário, o PDF rasterizado no processo filho, uma página por vez — e o
 * PDF limpo é montado com eles. Um original por vez (`ler` só quando chega a vez dele); `pdf` nulo se nada virou página.
 */
export async function converterOriginais(
  originais: readonly { ext: string; ler: () => Promise<Buffer> }[],
  deps: Pick<DepsProcessar, 'abrirHeic' | 'rasterizar' | 'renderizar'> = {},
): Promise<{ jpegs: Buffer[]; pdf: Buffer | null }> {
  const jpegs: Buffer[] = [];
  for (const o of originais) {
    if (o.ext === 'pdf') {
      // R-D4: o PDF vai ao processo filho por arquivo; quem lê é a rasterização, que solta o Buffer assim que o grava
      await (deps.rasterizar ?? rasterizarPdf)(o.ler, { limitePaginas: ENVIO_MAX_PAGINAS, ladoMax: ENVIO_LADO_MAX, maxPixelsImagem: MAX_PIXELS_IMAGEM_PDF }, async (p) => {
        // uma página por vez (RNF-162): os pixels saem da memória assim que viram JPEG
        jpegs.push(await paraJpegSemMetadados(sharp(p.rgba, { raw: { width: p.largura, height: p.altura, channels: 4 } }), ENVIO_LADO_MAX, ENVIO_QUALIDADE_JPEG));
      });
    } else {
      jpegs.push(await fotoParaJpeg(await o.ler(), o.ext, { ladoMax: ENVIO_LADO_MAX, qualidade: ENVIO_QUALIDADE_JPEG, abrirHeic: deps.abrirHeic }));
    }
  }
  return { jpegs, pdf: jpegs.length ? await (deps.renderizar ?? renderizarPdfLimpo)(jpegs) : null };
}

class TitularComExclusaoError extends Error {}
class EnvioMudouError extends Error {}

/**
 * Ordem de travas de salvarArquivo: dono (paciente) → registro (envio) → tenant (cota). O paciente vem primeiro porque o INSERT
 * em stored_files pede KEY SHARE nele (FK) — a mesma ordem do diário. Desiste se a exclusão chegou ou o envio mudou.
 */
async function travarParaGravar(tx: Tx, patientId: string, envioId: string): Promise<void> {
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new TitularComExclusaoError();
  const [e] = await tx.select({ id: examSubmissions.id }).from(examSubmissions).where(and(eq(examSubmissions.id, envioId), eq(examSubmissions.status, 'processando'))).for('update');
  if (!e) throw new EnvioMudouError();
}

/**
 * Job `exame-envio` (RN-163, D23 = a). Idempotente:
 * - "processando": cada foto vira JPEG (sem EXIF/GPS, orientação aplicada, ≤ 2000 px, qualidade 85) e o PDF é RASTERIZADO
 *   página a página no processo filho (rasterizar-pdf.ts); o PDF limpo é montado só com essas imagens. Cada imagem de página
 *   entra no SEU salvarArquivo (tipo `exame_pagina`, linha "pagina" no `registrar`) e por último o PDF limpo (tipo `exame`;
 *   `registrar` = envio "recebido" com o `arquivo_path` + o aviso à nutricionista, D10); depois os originais saem por
 *   apagarArquivosDoEnvio. Páginas de uma tentativa anterior que caiu no meio saem antes (D12, `refazer`).
 * - "recebido" com original que sobrou (queda entre gravar o PDF e apagar o original): só apaga o original.
 * - Titular bloqueado ou anonimizado: "ignorado" — os arquivos saem pela rotina da exclusão (§13.3).
 * Falha de conversão, PDF com mais de 10 páginas ou cota esgotada → "falhou" na hora (definitivo; motivo_falha) e todos os
 * arquivos do envio saem (cota devolvida). Erro de infraestrutura → relança (o pg-boss tenta de novo; o worker limpa o
 * detalhe, RNF-11); na última tentativa, "falhou" (conversao). Log só com ids e o motivo.
 */
export async function processarEnvio(data: DadosEnvio, deps: DepsProcessar): Promise<'recebido' | 'falhou' | 'ignorado'> {
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const arquivos = { db: deps.db, dataDir: deps.dataDir };
  const lido = await withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select().from(examSubmissions).where(eq(examSubmissions.id, data.envioId));
      if (!e) return null;
      const linhas = await tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, e.id)).orderBy(asc(examSubmissionFiles.papel), asc(examSubmissionFiles.ordem));
      const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, e.patientId));
      return { e, linhas, titularFora: !p || p.status === 'bloqueado' || !!p.anonimizadoEm };
    },
    deps.db,
  );
  if (!lido) return 'ignorado';
  const { e, linhas } = lido;
  const originais = linhas.filter((l) => l.papel === 'original');
  if (e.status === 'recebido') {
    if (originais.length) await apagarArquivosDoEnvio(ctx, e.id, { ...arquivos, papel: 'original' });
    return 'ignorado';
  }
  if (e.status !== 'processando' || lido.titularFora) return 'ignorado';
  const falhar = async (motivo: MotivoFalhaEnvio): Promise<'falhou'> => {
    logger.warn({ tenantId: data.tenantId, envioId: data.envioId, motivo }, 'exame enviado não processado');
    await withTenant(
      ctx,
      (tx) => tx.update(examSubmissions).set({ status: 'falhou', motivoFalha: motivo, updatedAt: new Date() }).where(and(eq(examSubmissions.id, e.id), eq(examSubmissions.status, 'processando'))),
      deps.db,
    );
    await apagarArquivosDoEnvio(ctx, e.id, arquivos);
    return 'falhou';
  };
  if (linhas.some((l) => l.papel === 'pagina')) await apagarArquivosDoEnvio(ctx, e.id, { ...arquivos, papel: 'pagina', refazer: true });
  try {
    const { jpegs, pdf } = await converterOriginais(
      originais.map((o) => ({ ext: o.arquivoPath.slice(o.arquivoPath.lastIndexOf('.') + 1), ler: () => readFile(resolverCaminho(deps.dataDir, o.arquivoPath)) })),
      deps,
    );
    if (!pdf) return falhar('conversao');
    for (let i = 0; i < jpegs.length; i++) {
      await salvarArquivo(
        ctx,
        {
          tipo: 'exame_pagina',
          conteudo: jpegs[i],
          permitidos: ['jpg'],
          patientId: e.patientId,
          antesDaReserva: (tx) => travarParaGravar(tx, e.patientId, e.id),
          registrar: async (tx, a) => {
            await tx.insert(examSubmissionFiles).values({ tenantId: data.tenantId, patientId: e.patientId, submissionId: e.id, arquivoPath: a.caminho, papel: 'pagina', ordem: i + 1 });
          },
        },
        arquivos,
      );
    }
    const agora = deps.agora?.() ?? new Date();
    await salvarArquivo(
      ctx,
      {
        tipo: 'exame',
        conteudo: pdf,
        permitidos: ['pdf'],
        patientId: e.patientId,
        antesDaReserva: (tx) => travarParaGravar(tx, e.patientId, e.id),
        registrar: async (tx, a) => {
          await tx.update(examSubmissions).set({ status: 'recebido', arquivoPath: a.caminho, updatedAt: agora }).where(eq(examSubmissions.id, e.id));
          await avisarExamesRecebidos(tx, { tenantId: data.tenantId, agora, appUrl: deps.appUrl });
        },
      },
      arquivos,
    );
  } catch (err) {
    if (err instanceof TitularComExclusaoError || err instanceof EnvioMudouError) {
      logger.warn({ tenantId: data.tenantId, envioId: data.envioId, motivo: err instanceof EnvioMudouError ? 'envio_mudou' : 'exclusao' }, 'exame enviado não processado');
      return 'ignorado';
    }
    if (err instanceof RasterizacaoError) return falhar(err.motivo);
    if (err instanceof FotoInvalidaError) return falhar('conversao');
    if (err instanceof CotaEsgotadaError) return falhar('cota');
    logger.warn({ tenantId: data.tenantId, envioId: data.envioId, motivo: 'erro', definitivo: deps.ultimaTentativa }, 'falha ao processar o exame enviado');
    if (!deps.ultimaTentativa) throw err;
    return falhar('conversao');
  }
  // o envio já está "recebido": os originais saem; uma falha aqui fica para a próxima tentativa ou para a varredura
  await apagarArquivosDoEnvio(ctx, e.id, { ...arquivos, papel: 'original' }).catch((err: unknown) =>
    logger.warn({ tenantId: data.tenantId, envioId: data.envioId, motivo: 'original', err: err instanceof Error ? err.name : 'erro' }, 'original do exame enviado não apagado'),
  );
  return 'recebido';
}
