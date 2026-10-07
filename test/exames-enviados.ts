import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { examSubmissionFiles, examSubmissions, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { PDF_MINIMO } from './ia';
import { ctxPaciente } from './pacientes';

/** JPEG mínimo que passa no detectarTipo (não decodifica: só para arquivos que o teste não converte). */
export const JPEG_MINIMO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]);

/** D18: liga o recebimento de exames pelo app no tenant (fora de withTenant, como o seed). */
export async function ligarExames(db: Db, tenantId: string): Promise<void> {
  await db.update(tenants).set({ examesPacienteAtivadoEm: new Date() }).where(eq(tenants.id, tenantId));
}

/**
 * Envio na situação pedida, pelo CAMINHO LEGAL (revisão do plano: o gatilho exam_submissions_nasce só deixa nascer
 * "processando", para qualquer papel): nasce por `ctx` (a equipe, fora das políticas do paciente) e avança com o papel de cada
 * transição — worker (recebido, com `arquivoPath`; falhou; expirado), nutricionista (aceito/recusado, em nome de `revisadoPor`,
 * padrão `ctx.actorUserId`; o ponteiro do PDF limpo sai, como no aceite e na recusa de verdade) e paciente (cancelado, com o
 * ponteiro mantido até a limpeza). Também exercita o gatilho exam_submissions_regras. `createdAt`/`updatedAt` valem do início.
 */
export async function envioNoBanco(db: Db, ctx: TenantContext, patientId: string, o: Partial<typeof examSubmissions.$inferInsert> = {}): Promise<string> {
  const { status = 'recebido', arquivoPath, examId, revisadoPor, revisadoEm, motivoRecusa, motivoRecusaTexto, motivoFalha, updatedAt, ...nasce } = o;
  const quando = updatedAt ? { updatedAt } : {};
  const [e] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(examSubmissions)
        .values({ tenantId: ctx.tenantId, patientId, enviadoPor: randomUUID(), dataColeta: '2026-09-28', nome: 'Hemograma', ...nasce, ...quando, status: 'processando' })
        .returning({ id: examSubmissions.id }),
    db,
  );
  const mudar = (c: TenantContext, set: Partial<typeof examSubmissions.$inferInsert>) =>
    withTenant(c, (tx) => tx.update(examSubmissions).set({ ...set, ...quando }).where(eq(examSubmissions.id, e.id)), db);
  const worker: TenantContext = { tenantId: ctx.tenantId, role: 'worker' };
  if (status === 'processando') return e.id;
  if (status === 'falhou') {
    await mudar(worker, { status: 'falhou', motivoFalha: motivoFalha ?? null });
    return e.id;
  }
  await mudar(worker, { status: 'recebido', arquivoPath: arquivoPath ?? null });
  if (status === 'aceito' || status === 'recusado') {
    const quem = revisadoPor ?? ctx.actorUserId ?? randomUUID();
    await mudar(
      { tenantId: ctx.tenantId, role: 'nutri', actorUserId: quem },
      { status, examId: examId ?? null, revisadoPor: quem, revisadoEm: revisadoEm ?? new Date(), motivoRecusa: motivoRecusa ?? null, motivoRecusaTexto: motivoRecusaTexto ?? null, arquivoPath: null },
    );
  } else if (status === 'cancelado') {
    await mudar(ctxPaciente(ctx.tenantId, patientId), { status: 'cancelado' });
  } else if (status === 'expirado') {
    await mudar(worker, { status: 'expirado', arquivoPath: null });
  }
  return e.id;
}

/** Arquivo do envio de verdade (stored_files + disco, com dono): PDF mínimo para `exame`, JPEG mínimo para os outros. */
export async function arquivoDeEnvio(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  tipo: 'exame' | 'exame_original' | 'exame_pagina',
  dataDir: string,
  conteudo?: Buffer,
): Promise<string> {
  const a = await salvarArquivo(
    ctx,
    { tipo, conteudo: conteudo ?? (tipo === 'exame' ? PDF_MINIMO : JPEG_MINIMO), permitidos: ['pdf', 'jpg', 'png', 'heic'], patientId },
    { db, dataDir },
  );
  return a.caminho;
}

/** Envio "recebido" como o worker deixa: o PDF limpo apontado e `paginas` imagens de página (papel 'pagina'). */
export async function envioRecebido(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  dataDir: string,
  o: { paginas?: number; nome?: string | null; dataColeta?: string; criadoEm?: Date } = {},
): Promise<{ id: string; pdf: string; paginas: string[] }> {
  const pdf = await arquivoDeEnvio(db, ctx, patientId, 'exame', dataDir);
  const id = await envioNoBanco(db, ctx, patientId, {
    status: 'recebido',
    arquivoPath: pdf,
    nome: o.nome === undefined ? 'Hemograma' : o.nome,
    dataColeta: o.dataColeta ?? '2026-09-28',
    ...(o.criadoEm ? { createdAt: o.criadoEm, updatedAt: o.criadoEm } : {}),
  });
  const paginas: string[] = [];
  for (let i = 0; i < (o.paginas ?? 2); i++) {
    const c = await arquivoDeEnvio(db, ctx, patientId, 'exame_pagina', dataDir);
    await withTenant(ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: ctx.tenantId, patientId, submissionId: id, arquivoPath: c, papel: 'pagina', ordem: i + 1 }), db);
    paginas.push(c);
  }
  return { id, pdf, paginas };
}

/** JPEG pequeno cujo cabeçalho (SOF0) declara `largura` × `altura` — o sharp e o pdf-lib leem só o cabeçalho. */
export async function jpegQueDeclara(largura: number, altura: number): Promise<Buffer> {
  const b = Buffer.from(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).jpeg({ mozjpeg: false }).toBuffer());
  for (let i = 2; i + 9 < b.length; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xc0) {
      b.writeUInt16BE(altura, i + 5);
      b.writeUInt16BE(largura, i + 7);
      return b;
    }
  }
  throw new Error('JPEG sem SOF0');
}

/** JPEG válido com `bytes` bytes (zeros depois do fim da imagem): passa no detectarTipo e no metadata() do sharp. */
export async function jpegDe(bytes: number): Promise<Buffer> {
  const base = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  return Buffer.concat([base, Buffer.alloc(Math.max(0, bytes - base.length), 0)]);
}

/**
 * Corridas com duas conexões (revisão do plano): espera outra conexão (mesmo role: o pg_stat_activity mostra o comando) ficar
 * parada numa trava cujo comando contém `trecho`.
 */
export async function esperarNaTrava(db: Db, trecho: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const r = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike ${`%${trecho}%`}`,
    );
    if (r.rows[0].n > 0) return;
    await new Promise((ok) => setTimeout(ok, 25));
  }
  throw new Error(`ninguém parou na trava (${trecho})`);
}
