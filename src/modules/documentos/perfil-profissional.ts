import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { formatarTelefone, normalizarTelefone } from '@/modules/pacientes/telefone';
import { recordAudit } from '@/modules/plataforma/audit';
import { DocumentoError } from './erros';

/** US-140 (texto exato da spec v0.3). */
export const MSG_PERFIL_PROF = {
  nome: 'Informe seu nome completo (5 a 120 caracteres)',
  email: 'Informe um e-mail profissional válido',
  telefone: 'Informe um telefone válido com DDD',
  registro: 'Informe o registro da sua habilitação em Fitoterapia no CRN',
  declaracao: 'Confirme a declaração para continuar.',
  incompleto: 'Complete seu perfil profissional (nome completo, CRN e contato) antes de preparar documentos.',
  salvo: 'Dados para documentos salvos.',
  habilitada: 'Habilitação em Fitoterapia registrada no perfil.',
  retirada: 'Habilitação em Fitoterapia retirada do perfil.',
} as const;
export const ROTULO_HABILITACAO = 'Tenho habilitação em Fitoterapia registrada no CRN (Resolução CFN nº 680/2021)';
/** D6 da spec: o termo da autodeclaração é versionado (como o DPA); versão nova = texto novo. */
export const TERMO_FITOTERAPIA = { versao: '2026-10-05', texto: 'Declaro, sob minha responsabilidade, que a habilitação está registrada no CRN.' } as const;

export class PerfilIncompletoError extends Error {
  override name = 'PerfilIncompletoError';
  constructor() {
    super(MSG_PERFIL_PROF.incompleto);
  }
}

/** SUS-109: sem NUL (22021 em `tenants`) nem surrogate sem par (a cópia vai ao jsonb do documento). */
const espacos = (s: string) => semInvalidosNoBanco(s).trim().replace(/\s+/g, ' ');
const dadosSchema = z.object({
  nomeProfissional: z.string().transform(espacos).pipe(z.string().min(5, MSG_PERFIL_PROF.nome).max(120, MSG_PERFIL_PROF.nome)),
  contatoEmail: z.string().trim().toLowerCase().pipe(z.email(MSG_PERFIL_PROF.email).max(254, MSG_PERFIL_PROF.email)),
  contatoTelefone: z.string().transform((t, c) => normalizarTelefone(t) ?? (c.addIssue({ code: 'custom', message: MSG_PERFIL_PROF.telefone }), z.NEVER)),
});

export type CopiaProfissional = { nomeCompleto: string; crn: string; email: string; telefone: string; endereco: string | null; fitoterapia: boolean };
/**
 * RN-154: a cópia congelada no preparo, igual nos dois tipos. Plano 13: `retificacao` (a versão e o código da versão que
 * esta substitui) entra no preparo de uma versão nova, para o PDF imprimir "Versão {n} — substitui o documento {código}".
 */
export type CopiaDoDocumento = { profissional: CopiaProfissional; paciente: { nome: string }; retificacao?: { versao: number; substitui: string } };

export function perfilCompleto(t: Pick<TenantRow, 'nomeProfissional' | 'crn' | 'contatoEmail' | 'contatoTelefoneE164'>): boolean {
  return !!(t.nomeProfissional && t.crn && t.contatoEmail && t.contatoTelefoneE164);
}

/** RN-154: a cópia congelada no conteúdo ao preparar (o PDF e o portal leem a cópia, nunca o perfil atual). */
export function copiaDoPerfil(t: TenantRow): CopiaProfissional {
  if (!perfilCompleto(t)) throw new PerfilIncompletoError();
  return {
    nomeCompleto: t.nomeProfissional!,
    crn: t.crn!,
    email: t.contatoEmail!,
    telefone: formatarTelefone(t.contatoTelefoneE164!),
    endereco: t.enderecoConsultorio ?? null,
    fitoterapia: !!t.fitoterapiaRegistro,
  };
}

/** `tenants` não tem RLS e não tem gatilho de auditoria: o tenant vem da sessão e a auditoria é explícita (§10 da spec). */
export async function salvarDadosParaDocumentos(ctx: TenantContext, input: Record<string, unknown>, db: Db = getDb()): Promise<void> {
  const p = dadosSchema.safeParse({ nomeProfissional: input.nomeProfissional ?? '', contatoEmail: input.contatoEmail ?? '', contatoTelefone: input.contatoTelefone ?? '' });
  if (!p.success) throw new DocumentoError(primeiroErroPorCampo(p.error));
  await withTenant(ctx, async (tx) => {
    await tx
      .update(tenants)
      .set({ nomeProfissional: p.data.nomeProfissional, contatoEmail: p.data.contatoEmail, contatoTelefoneE164: p.data.contatoTelefone, updatedAt: new Date() })
      .where(eq(tenants.id, ctx.tenantId));
    await recordAudit(tx, { acao: 'alterar', entidade: 'perfil_profissional', entidadeId: ctx.tenantId, patientId: null });
  }, db);
}

export async function declararFitoterapia(ctx: TenantContext, input: Record<string, unknown>, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  const registro = typeof input.registro === 'string' ? espacos(input.registro) : '';
  const erros: Record<string, string> = {};
  if (!registro || registro.length > 60) erros.registro = MSG_PERFIL_PROF.registro;
  if (input.confirmo !== 'on') erros.confirmo = MSG_PERFIL_PROF.declaracao;
  if (Object.keys(erros).length) throw new DocumentoError(erros);
  const agora = deps.agora ?? new Date();
  await withTenant(ctx, async (tx) => {
    await tx
      .update(tenants)
      .set({ fitoterapiaRegistro: registro, fitoterapiaDeclaradaEm: agora, fitoterapiaTermoVersao: TERMO_FITOTERAPIA.versao, updatedAt: agora })
      .where(eq(tenants.id, ctx.tenantId));
    // D6: a declaração fica no audit_log com a versão do termo aceito; a retirada zera `tenants`, e é este registro
    // (com a data em `criado_em`) que prova quando ela se declarou e qual termo aceitou
    await recordAudit(tx, { acao: 'criar', entidade: 'perfil_profissional', entidadeId: `fitoterapia:${TERMO_FITOTERAPIA.versao}`, patientId: null });
  }, deps.db ?? getDb());
}

export async function retirarFitoterapia(ctx: TenantContext, deps: { db?: Db } = {}): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const retirada = await tx
      .update(tenants)
      .set({ fitoterapiaRegistro: null, fitoterapiaDeclaradaEm: null, fitoterapiaTermoVersao: null, updatedAt: new Date() })
      .where(and(eq(tenants.id, ctx.tenantId), isNotNull(tenants.fitoterapiaRegistro)))
      .returning({ id: tenants.id });
    // sem habilitação (duas abas, clique duplo), não há o que retirar nem registrar
    if (retirada.length) await recordAudit(tx, { acao: 'excluir', entidade: 'perfil_profissional', entidadeId: 'fitoterapia', patientId: null });
  }, deps.db ?? getDb());
}
