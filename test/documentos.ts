import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { AREA_ASSINATURA, type StatusDocumento, type TipoAssinatura } from '@/modules/documentos/constantes';
import { novoPaciente, novoTenant } from './pacientes';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const codigoAleatorio = () => Array.from({ length: 12 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join('');

/**
 * Documento gravado direto no banco (sem o fluxo), no estado pedido. Emitido = com o stored_files do PDF assinado (FK NO
 * ACTION), SHA-256 e assinatura digitalizada (a única do 10A; o 10B passa `assinaturaTipo: 'govbr'` nos testes dele).
 * O gatilho de imutabilidade (0091) não olha INSERT.
 */
export async function documentoNoBanco(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  o: { status?: StatusDocumento; conteudo?: Record<string, unknown>; assinaturaTipo?: TipoAssinatura } = {},
): Promise<{ id: string; codigo: string | null; pdfPath: string | null }> {
  const status = o.status ?? 'rascunho';
  const emitido = ['assinado', 'substituido', 'cancelado'].includes(status);
  const codigo = status === 'rascunho' ? null : codigoAleatorio();
  const pdfPath = emitido ? `${ctx.tenantId}/documento_assinado/${randomUUID()}.pdf` : null;
  const id = randomUUID();
  await withTenant(ctx, async (tx) => {
    if (pdfPath)
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${ctx.tenantId}, 'documento_assinado', ${pdfPath}, 100, 'application/pdf', ${patientId})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, pdf_path, pdf_sha256, assinado_em, assinatura_tipo, assinante_nome, entregue_em)
      values (${id}, ${ctx.tenantId}, ${patientId}, ${status}, ${codigo}, ${JSON.stringify(o.conteudo ?? { versao: 1, tipo: 'receita', itens: [], orientacoes: '' })}::jsonb,
              ${pdfPath}, ${emitido ? 'a'.repeat(64) : null}, ${emitido ? new Date() : null}, ${emitido ? (o.assinaturaTipo ?? 'digitalizada') : null}, ${emitido && (o.assinaturaTipo ?? 'digitalizada') !== 'digitalizada' ? 'DEBBY SILVA' : null}, ${emitido ? new Date() : null})`);
  }, db);
  return { id, codigo, pdfPath };
}

/**
 * Um PDF mínimo válido pelo conteúdo (detectarTipo vê "%PDF-"). No Plano 10A ele faz o papel do PDF preparado e do PDF
 * assinado; o Plano 10B passa o PDF base dos testes dele em `outroDocumento(…, { base })`.
 */
export function pdfDeTeste(texto = 'base de teste'): Buffer {
  return Buffer.from(`%PDF-1.3\n% ${texto}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

/** D20: liga o interruptor do admin (o `novoTenant` nasce com `documentos_liberados = false`, como em produção). */
export const liberarDocumentos = (db: Db, tenantId: string) => db.update(tenants).set({ documentosLiberados: true }).where(eq(tenants.id, tenantId));

/** Consultório completo (perfil e documentos liberados) e a pasta de dados do teste. */
export async function novoConsultorio(db: Db) {
  const T = await novoTenant(db);
  await db.update(tenants).set({ crn: 'CRN-3 12345', nomeProfissional: 'Débora Silva Santos', contatoEmail: 'd@x.com', contatoTelefoneE164: '+5511912345678', documentosLiberados: true }).where(eq(tenants.id, T.tenantId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'assinar-'));
  const acesso = { ctx: T.ctx, tenant: tenant as TenantRow, user: { id: T.nutriId, email: 'd@x.com', twoFactorEnabled: true } };
  return { T, dataDir, acesso };
}
export type Consultorio = Awaited<ReturnType<typeof novoConsultorio>>;

const COPIA_TESTE = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Um documento em "Aguardando assinatura" com o base no disco (como depois da T7), num paciente novo do consultório. */
export async function outroDocumento(c: Consultorio, db: Db, o: { base?: Buffer; conteudo?: Record<string, unknown> } = {}) {
  const BASE_DOC = o.base ?? pdfDeTeste();
  const p = await novoPaciente(db, c.T.ctx);
  const base = `${c.T.tenantId}/documento_base/${randomUUID()}.pdf`;
  await mkdir(path.join(c.dataDir, path.dirname(base)), { recursive: true });
  await writeFile(path.join(c.dataDir, base), BASE_DOC);
  const id = randomUUID();
  const conteudo = o.conteudo ?? { versao: 1, tipo: 'receita', itens: [], orientacoes: '', copia: { profissional: COPIA_TESTE, paciente: { nome: 'Ana Souza' } } };
  const codigo = codigoAleatorio();
  await withTenant(c.T.ctx, async (tx) => {
    await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${c.T.tenantId}, 'documento_base', ${base}, ${BASE_DOC.length}, 'application/pdf', ${p.id})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em) values (${id}, ${c.T.tenantId}, ${p.id}, 'preparando', ${codigo}, ${JSON.stringify(conteudo)}::jsonb, now())`);
  }, db);
  await withTenant({ tenantId: c.T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${sha256(BASE_DOC)}, base_pdf_bytes = ${BASE_DOC.length}, area_assinatura = ${JSON.stringify(AREA_ASSINATURA)}::jsonb where id = ${id}`), db);
  return { ...c, p, id, base, codigo, baseSha256: sha256(BASE_DOC) };
}

/**
 * "Voltar a editar" + novo preparo + o worker com OUTRO base, direto no banco (o mesmo caminho que o gatilho aceita):
 * o documento volta a "aguardando_assinatura" com outro código e outro SHA-256. Para o teste da versão lida (T8, T9 e 10B).
 * O base antigo fica sem referência e a varredura da T7 o apaga (como na vida real, o `voltarAEditar` o apagaria).
 */
export async function novoPreparoNoBanco(x: Awaited<ReturnType<typeof outroDocumento>>, db: Db) {
  const outro = pdfDeTeste(`outra versão ${randomUUID()}`);
  const base = `${x.T.tenantId}/documento_base/${randomUUID()}.pdf`;
  await mkdir(path.join(x.dataDir, path.dirname(base)), { recursive: true });
  await writeFile(path.join(x.dataDir, base), outro);
  const codigo = codigoAleatorio();
  await withTenant(x.T.ctx, async (tx) => {
    await tx.execute(sql`update signed_documents set status = 'rascunho', codigo = null, declaracao_em = null, base_pdf_path = null, base_pdf_sha256 = null, base_pdf_bytes = null, area_assinatura = null, digitalizacao = null, digitalizacao_status = null, digitalizacao_em = null where id = ${x.id}`);
    await tx.execute(sql`update signed_documents set status = 'preparando', codigo = ${codigo}, declaracao_em = now() where id = ${x.id}`);
    await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${x.T.tenantId}, 'documento_base', ${base}, ${outro.length}, 'application/pdf', ${x.p.id})`);
  }, db);
  await withTenant({ tenantId: x.T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${sha256(outro)}, base_pdf_bytes = ${outro.length}, area_assinatura = ${JSON.stringify(AREA_ASSINATURA)}::jsonb where id = ${x.id}`), db);
}
