import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { iaAutorizacoes, iaTarefas, patients, storedFiles, tenants, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { criarExame } from '@/modules/pacientes/exames';
import { eq } from 'drizzle-orm';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { novoPaciente } from './pacientes';

/** Bytes que o detectarTipo aceita como PDF (para exames cujo conteúdo não é lido). Para um PDF de verdade, `pdfDeTeste`. */
export const PDF_MINIMO = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20)]);

/** A IA liberada pela admin e ativada pela nutricionista, com o aditivo atual (T2 cria IA_ADITIVO_VERSAO). */
export async function iaPronta(db: Db, tenantId: string, o: { cotaUsd?: number; aditivo?: string } = {}): Promise<void> {
  await db
    .update(tenants)
    .set({ iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: o.aditivo ?? '0.1-provisorio', iaCotaMensalUsd: o.cotaUsd ?? 15 })
    .where(eq(tenants.id, tenantId));
}

/** Paciente com a ciência do aviso de IA registrada em mãos (US-104). */
export async function pacienteInformado(db: Db, ctx: TenantContext, extra: Partial<typeof patients.$inferInsert> = {}): Promise<PatientRow> {
  return novoPaciente(db, ctx, { iaAvisoVersao: '0.1-provisorio', iaAvisoEm: new Date('2026-10-01T12:00:00Z'), iaAvisoCanal: 'em_maos', ...extra });
}

/** Exame com laudo gravado pelo caminho real (salvarArquivo). */
export async function exameComLaudo(
  db: Db,
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  o: { dataDir: string; conteudo?: Buffer; valores?: unknown[]; data?: string; now?: Date },
): Promise<string> {
  return criarExame(ctx, tenant, patientId, { titulo: 'Hemograma', data: o.data ?? '2026-09-01', valores: o.valores ?? [], arquivo: o.conteudo ?? PDF_MINIMO }, { db, dataDir: o.dataDir, now: o.now ?? new Date('2026-10-01T15:00:00Z') });
}

/** Tarefa gravada direto (sem reserva nem fila), para testes de banco e de tela. */
export async function tarefaNoBanco(db: Db, ctx: TenantContext, patientId: string, examId: string | null, o: Partial<typeof iaTarefas.$inferInsert> = {}): Promise<string> {
  const [t] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(iaTarefas)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          tipo: 'leitura_exame',
          status: 'na_fila',
          examId,
          pedidoPor: ctx.actorUserId ?? randomUUID(),
          modelo: 'claude-opus-5-5',
          promptVersao: 'teste',
          reservaMicroUsd: 0,
          ...o,
        })
        .returning({ id: iaTarefas.id }),
    db,
  );
  return t.id;
}

/** PDF de verdade (abre no pdf-lib), com texto por página e, se pedido, metadados com o "nome do paciente". */
export async function pdfDeTeste(o: { paginas?: number; textos?: string[]; titulo?: string; xmp?: string } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (o.paginas ?? 1); i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(o.textos?.[i] ?? `Glicose de jejum 92 mg/dL (página ${i + 1})`, { x: 50, y: 780, size: 11, font: fonte });
  }
  if (o.titulo) {
    doc.setTitle(o.titulo);
    doc.setAuthor(o.titulo);
    doc.setSubject(o.titulo);
    doc.setKeywords([o.titulo]);
  }
  if (o.xmp) doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(o.xmp, { Type: 'Metadata', Subtype: 'XML' })));
  return Buffer.from(await doc.save());
}

/** Foto "de celular": JPEG com EXIF (orientação e um texto no Copyright) — o preparo tem de girar e tirar tudo. */
export async function fotoDeTeste(o: { largura?: number; altura?: number; orientacao?: number; copyright?: string } = {}): Promise<Buffer> {
  const img = sharp({ create: { width: o.largura ?? 4000, height: o.altura ?? 3000, channels: 3, background: '#f0f0f0' } });
  return img.jpeg().withMetadata({ orientation: o.orientacao ?? 6, exif: { IFD0: { Copyright: o.copyright ?? 'Ana Souza' } } }).toBuffer();
}

/**
 * Plano 14A: um evento de autorização gravado pela sessão de paciente SEM conta (canal `link`, como o link do e-mail): o
 * único caminho de teste que a política paciente_autorizacao_propria e o gatilho ia_autorizacoes_regras (0108) aceitam
 * sem conta de login. `registrado_em` e `em` vêm do gatilho. Padrões: autorizou, versão 0.1-provisorio, os usos da 0.1 (só `leitura_laudos`, F2),
 * destino `teste` (o dos provedores sandbox/fake).
 */
export async function autorizacaoNoBanco(
  db: Db,
  tenantId: string,
  patientId: string,
  o: { evento?: 'autorizou' | 'retirou'; versao?: string; usos?: string[]; destino?: string; emailHmac?: string } = {},
): Promise<string> {
  const evento = o.evento ?? 'autorizou';
  const autorizou = evento === 'autorizou';
  const [r] = await withTenant(
    { tenantId, role: 'paciente', patientId, semConta: true },
    (tx) =>
      tx
        .insert(iaAutorizacoes)
        .values({
          tenantId, patientId, evento, canal: 'link', emailHmac: o.emailHmac ?? 'hmac-de-teste',
          versao: autorizou ? (o.versao ?? '0.1-provisorio') : null,
          usos: autorizou ? (o.usos ?? ['leitura_laudos']) : null,
          destino: autorizou ? (o.destino ?? 'teste') : null,
        })
        .returning({ id: iaAutorizacoes.id }),
    db,
  );
  return r.id;
}

/** Plano 14A: a linha de stored_files de um termo em papel (sem arquivo no disco; os testes de banco só precisam da FK). */
export async function termoNoDisco(db: Db, ctx: TenantContext, patientId: string): Promise<string> {
  const caminho = `${ctx.tenantId}/ia_autorizacao_termo/${randomUUID()}.pdf`;
  await withTenant(ctx, (tx) => tx.insert(storedFiles).values({ tenantId: ctx.tenantId, tipo: 'ia_autorizacao_termo', caminho, bytes: 100, mime: 'application/pdf', patientId }), db);
  return caminho;
}
