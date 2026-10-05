import { and, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { getDb } from '@/db/client';
import { patients, signedDocuments } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { confirmarCodigo2fa, liberarCodigo2fa } from '@/lib/confirmar-2fa';
import { detectarTipo } from '@/lib/file-type';
import { logger } from '@/lib/logger';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { apagarArquivo, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import { travarDocumentoAntesDaCota } from './arquivos-do-preparo';
import { envioEmCurso, MAX_PIXELS_FOTO } from './constantes';
import { DocumentoNaoEncontradoError, MSG_RECUSA, RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import type { ConteudoReceita } from './prescricao';
import { exigirHabilitacaoAtual, type AcessoAssinatura, type DepsAssinar } from './registrar-assinatura';

export const MAX_FOTOS = 5;
export const MAX_FOTOS_BYTES = 10 * 1024 * 1024;
/** US-144 (texto exato da spec v0.3) e os novos deste plano. */
export const MSG_DIGITALIZADA = {
  aviso: 'O sistema não confere o conteúdo de documentos digitalizados. Envie fotos das páginas do PDF preparado, assinadas e sem alterações.',
  fotos: MSG_RECUSA.fotos, // a mesma do 413 da rota e da recusa `fotos`
  montando: 'Montando o PDF digitalizado…',
  falhou: 'Não foi possível montar o PDF. Envie as fotos de novo.',
} as const;

/**
 * RN-157 / D4: só fotos (JPEG/PNG, tipo pelo conteúdo, 1 a 5, 10 MB no total) e o código do 2FA em TODO envio (sem
 * certificado, é o que liga a autoria, D13). As fotos vão para stored_files (`documento_digitalizado`, fora da política do
 * paciente) e o worker monta o PDF novo — o arquivo enviado nunca é entregue como veio.
 * Ordem: fotos conferidas → versão lida (código) e habilitação (Minor 9) → 2FA → TRAVA "recebendo" (D24: um envio por
 * vez; o segundo recebe 409) → fotos antigas apagadas e as novas gravadas, cada uma amarrada à versão + "recebendo" →
 * "pendente" e o job na mesma transação. Qualquer erro depois da trava → "falhou" (a tela pede as fotos de novo); da trava
 * em diante, um erro também devolve a marca anti-repetição do código (liberarCodigo2fa, I3 do PR #19).
 */
export async function receberDigitalizada(a: AcessoAssinatura, docId: string, imagens: Buffer[], codigo2fa: unknown, deps: DepsAssinar & { boss?: PgBoss }): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (!a.user.twoFactorEnabled) throw new RecusaAssinaturaError('sem_2fa');
  const total = imagens.reduce((s, b) => s + b.length, 0);
  if (!imagens.length || imagens.length > MAX_FOTOS || total > MAX_FOTOS_BYTES) throw new RecusaAssinaturaError('fotos', 'quantidade_ou_tamanho');
  if (!imagens.every((b) => ['jpg', 'png'].includes(detectarTipo(b)?.ext ?? ''))) throw new RecusaAssinaturaError('imagens', 'tipo');
  // US-144: "foto acima de 40 megapixels é recusada com 'Envie de 1 a 5 fotos, até 10 MB no total.'"
  // RN-157: bomba de pixels (PNG de poucos MB que declara 30.000 × 30.000) recusada pelo cabeçalho — decodificada no
  // worker, derrubaria o processo e o pg-boss repetiria o job em laço (e-mails, push e exportações de todos parados)
  for (const img of imagens) {
    const m = await sharp(img, { limitInputPixels: MAX_PIXELS_FOTO, failOn: 'error' }).metadata().catch(() => null);
    if (!m?.width || !m.height || m.width * m.height > MAX_PIXELS_FOTO) throw new RecusaAssinaturaError('fotos', 'pixels');
  }
  const lida = await withTenant(a.ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(eq(signedDocuments.id, docId));
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'aguardando_assinatura' || !d.codigo || envioEmCurso(d, agora)) throw new TransicaoInvalidaError();
    const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId));
    if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
    return { patientId: d.patientId, codigo: d.codigo, conteudo: d.conteudo as ConteudoReceita };
  }, db);
  exigirHabilitacaoAtual(a.tenant, lida.conteudo);
  const r = await (deps.confirmar2fa ?? ((e) => confirmarCodigo2fa(e, { db })))({ userId: a.user.id, codigo: codigo2fa, headers: deps.headers });
  if (r === 'bloqueado') throw new RecusaAssinaturaError('tentativas_2fa');
  if (r === 'invalido') {
    await withTenant(a.ctx, (tx) => recordAudit(tx, { acao: 'criar', entidade: 'tentativa_assinatura', entidadeId: docId, patientId: lida.patientId }), db);
    logger.warn({ tenantId: a.ctx.tenantId, documentoId: docId }, 'código do 2FA recusado ao assinar');
    throw new RecusaAssinaturaError('codigo_2fa');
  }
  // I3 do PR #19: daqui em diante, uma falha (409, 507, gravação) devolve a marca anti-repetição do código — o envio não
  // aconteceu, e o mesmo código certo reenviado não pode virar "Código inválido" nem contar para o bloqueio
  const liberar2fa = () => (deps.liberar2fa ?? ((e) => liberarCodigo2fa(e, { db })))({ userId: a.user.id, codigo: codigo2fa }).catch(() => undefined);
  // D24: a trava. Versão lida (o código) + nenhum envio em curso; "Voltar a editar" + novo preparo no meio troca o código
  const antigas = await withTenant(a.ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(eq(signedDocuments.id, docId)).for('update');
    if (!d || d.status !== 'aguardando_assinatura' || d.codigo !== lida.codigo || envioEmCurso(d, agora)) throw new TransicaoInvalidaError();
    await tx.update(signedDocuments).set({ digitalizacaoStatus: 'recebendo', digitalizacaoEm: agora }).where(eq(signedDocuments.id, docId));
    return d.digitalizacao ?? [];
  }, db).catch(async (e: unknown) => {
    await liberar2fa();
    throw e;
  });
  const daVersao = and(eq(signedDocuments.id, docId), eq(signedDocuments.status, 'aguardando_assinatura'), eq(signedDocuments.codigo, lida.codigo), eq(signedDocuments.digitalizacaoStatus, 'recebendo'));
  try {
    // regra 9: as fotos de um envio anterior (que falhou) saem cada uma no seu apagarArquivo, com o ponteiro na mesma
    // transação. Erro aqui SOBE (o catch marca "falhou"): engolido, o ponteiro antigo ficaria e o PDF somaria as páginas
    // dos dois envios (D24) — revisão da T9
    for (const c of antigas)
      await apagarArquivo(a.ctx, { caminho: c }, {
        db, dataDir: deps.dataDir,
        naMesmaTransacao: async (tx) => (await tx.update(signedDocuments).set({ digitalizacao: sql`coalesce(${signedDocuments.digitalizacao}, '[]'::jsonb) - ${c}::text` }).where(daVersao).returning({ id: signedDocuments.id })).length > 0,
      });
    for (const img of imagens) {
      await salvarArquivo(a.ctx, {
        tipo: 'documento_digitalizado', conteudo: img, permitidos: ['jpg', 'png'], patientId: lida.patientId,
        antesDaReserva: (tx) => travarDocumentoAntesDaCota(tx, docId), // documento → tenant (I2 do PR #19)
        registrar: async (tx, arq) => {
          const ok = await tx
            .update(signedDocuments)
            .set({ digitalizacao: sql`coalesce(${signedDocuments.digitalizacao}, '[]'::jsonb) || jsonb_build_array(${arq.caminho}::text)` })
            .where(daVersao)
            .returning({ id: signedDocuments.id });
          if (!ok.length) throw new TransicaoInvalidaError();
        },
      }, { db, dataDir: deps.dataDir });
    }
    const boss = deps.boss ?? (await getBoss());
    await withTenant(a.ctx, async (tx) => {
      // D24: só as fotos deste envio (nenhuma sobra de um envio anterior) vão para o PDF
      const soEste = sql`jsonb_array_length(coalesce(${signedDocuments.digitalizacao}, '[]'::jsonb)) = ${imagens.length}`;
      const ok = await tx.update(signedDocuments).set({ digitalizacaoStatus: 'pendente' }).where(and(daVersao, soEste)).returning({ id: signedDocuments.id });
      if (!ok.length) throw new TransicaoInvalidaError();
      await boss.send('documento-digitalizado', { tenantId: a.ctx.tenantId, documentoId: docId, userId: a.user.id }, { db: fromDrizzle(tx, sql) });
    }, db);
  } catch (e) {
    await withTenant(a.ctx, (tx) => tx.update(signedDocuments).set({ digitalizacaoStatus: 'falhou' }).where(daVersao), db).catch(() => undefined);
    await liberar2fa();
    throw e;
  }
  logger.info({ tenantId: a.ctx.tenantId, documentoId: docId, fotos: imagens.length }, 'digitalização recebida');
}
