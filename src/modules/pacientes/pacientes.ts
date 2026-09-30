import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { patients, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { normalizeEmail } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido, PacienteNaoEncontradoError } from './base';
import { enviarConvitePaciente } from './convite-paciente';
import { dataValida, hojeNoFuso, idadeEm } from './datas';
import { normalizarTelefone } from './telefone';

export const MSG_PACIENTE = {
  nome: 'Informe o nome',
  nascimentoInvalido: 'Informe uma data de nascimento válida',
  menorDeIdade: 'O sistema atende apenas pacientes a partir de 18 anos',
  sexo: 'Selecione o sexo biológico (usado nas fórmulas)',
  email: 'Informe um e-mail válido',
  emailDuplicado: 'Paciente já cadastrado com este e-mail',
  telefone: 'Telefone inválido',
  whatsappSemTelefone: 'Informe o telefone para registrar a autorização de WhatsApp',
  emailBloqueado: 'O paciente já ativou o acesso; o e-mail não pode ser alterado.',
} as const;

export type TenantDoPaciente = Pick<TenantRow, 'fuso' | 'nomeExibicao'>;
export type StatusPaciente = 'ativo' | 'arquivado' | 'bloqueado';
export type ErrosPaciente = Partial<Record<'nome' | 'dataNascimento' | 'sexo' | 'email' | 'telefone' | 'whatsappAutorizado' | 'geral', string>>;

export class PacienteError extends Error {
  override name = 'PacienteError';
  constructor(readonly erros: ErrosPaciente) {
    super('Dados do paciente inválidos');
  }
}

/** US-010 + RN-17. `hoje` = data no fuso do tenant (RN-06): a idade de 18 anos vale no dia do consultório. */
export function pacienteSchema(hoje: string) {
  return z
    .object({
      nome: z.string().trim().min(2, MSG_PACIENTE.nome).max(120, MSG_PACIENTE.nome),
      dataNascimento: z
        .string()
        .trim()
        .superRefine((v, ctx) => {
          if (!dataValida(v)) return void ctx.addIssue({ code: 'custom', message: MSG_PACIENTE.nascimentoInvalido });
          const idade = idadeEm(v, hoje);
          if (idade < 18) ctx.addIssue({ code: 'custom', message: MSG_PACIENTE.menorDeIdade });
          else if (idade > 120) ctx.addIssue({ code: 'custom', message: MSG_PACIENTE.nascimentoInvalido });
        }),
      sexo: z.enum(['F', 'M'], { message: MSG_PACIENTE.sexo }),
      email: z.string().transform(normalizeEmail).pipe(z.email({ message: MSG_PACIENTE.email })),
      telefone: z
        .string()
        .trim()
        .transform((v, ctx) => {
          if (!v) return null;
          const e164 = normalizarTelefone(v);
          if (!e164) {
            ctx.addIssue({ code: 'custom', message: MSG_PACIENTE.telefone });
            return z.NEVER;
          }
          return e164;
        }),
      whatsappAutorizado: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.whatsappAutorizado && !v.telefone) {
        ctx.addIssue({ code: 'custom', path: ['whatsappAutorizado'], message: MSG_PACIENTE.whatsappSemTelefone });
      }
    });
}

type DadosPaciente = z.output<ReturnType<typeof pacienteSchema>>;
type Deps = { db?: Db; now?: Date; appUrl?: string };

function validar(tenant: TenantDoPaciente, input: Record<string, unknown>, now: Date): DadosPaciente {
  const r = pacienteSchema(hojeNoFuso(tenant.fuso, now)).safeParse(input);
  if (!r.success) throw new PacienteError(primeiroErroPorCampo(r.error));
  return r.data;
}

function comoDuplicado(err: unknown): never {
  if (uniqueViolation(err) === 'patients_tenant_email_unique') throw new PacienteError({ email: MSG_PACIENTE.emailDuplicado });
  throw err;
}

/** Autorização presencial (INT-01, `origem = 'nutri'`). O opt-out do próprio paciente nunca é desfeito aqui. */
function autorizacaoWhatsapp(autorizado: boolean, atual: Pick<PatientRow, 'whatsappOptinEm'> | null, now: Date) {
  if (autorizado) return atual?.whatsappOptinEm ? {} : { whatsappOptinEm: now, whatsappOptinOrigem: 'nutri' };
  return { whatsappOptinEm: null, whatsappOptinOrigem: null };
}

/**
 * US-010: paciente `ativo`, `user_id` nulo. Em corrida, quem decide o e-mail repetido é a UNIQUE
 * (tenant_id, email) em citext — sem pré-checagem.
 */
export async function criarPaciente(ctx: TenantContext, tenant: TenantDoPaciente, input: Record<string, unknown>, deps: Deps = {}): Promise<PatientRow> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const v = validar(tenant, input, now);
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const [p] = await tx
          .insert(patients)
          .values({
            tenantId: ctx.tenantId,
            nome: v.nome,
            dataNascimento: v.dataNascimento,
            sexo: v.sexo,
            email: v.email,
            telefoneE164: v.telefone,
            origem: 'nutri',
            ...autorizacaoWhatsapp(v.whatsappAutorizado, null, now),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        // US-010: convite de 7 dias por e-mail na mesma transação (paciente criado ⇔ convite na fila)
        await enviarConvitePaciente(tx, p, { appUrl: deps.appUrl ?? getEnv().APP_URL, nutri: tenant.nomeExibicao, now });
        return p;
      },
      db,
    );
  } catch (err) {
    return comoDuplicado(err);
  }
}

export async function atualizarPaciente(
  ctx: TenantContext,
  tenant: TenantDoPaciente,
  patientId: string,
  input: Record<string, unknown>,
  deps: Deps = {},
): Promise<PatientRow> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  const v = validar(tenant, input, now);
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const atual = await carregarPacienteParaEscrita(tx, patientId);
        // O login do paciente é pelo e-mail: depois do aceite, trocar aqui separaria conta e prontuário
        if (atual.userId && v.email !== normalizeEmail(atual.email)) throw new PacienteError({ email: MSG_PACIENTE.emailBloqueado });
        const [p] = await tx
          .update(patients)
          .set({
            nome: v.nome,
            dataNascimento: v.dataNascimento,
            sexo: v.sexo,
            email: v.email,
            telefoneE164: v.telefone,
            ...autorizacaoWhatsapp(v.whatsappAutorizado, atual, now),
            updatedAt: now,
          })
          .where(eq(patients.id, patientId))
          .returning();
        // E-mail corrigido antes do aceite: o convite pendente ia para o endereço errado
        if (!p.userId && p.status === 'ativo' && atual.email !== p.email) {
          await enviarConvitePaciente(tx, p, { appUrl: deps.appUrl ?? getEnv().APP_URL, nutri: tenant.nomeExibicao, now });
        }
        return p;
      },
      db,
    );
  } catch (err) {
    return comoDuplicado(err);
  }
}

/** Abrir o prontuário (US-007 "Leitura auditada"): a leitura vai para o audit_log na mesma transação. */
export async function buscarPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<PatientRow | null> {
  if (!idValido(patientId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
      if (!p) return null;
      await auditRead(tx, { entidade: 'patients', entidadeId: p.id, patientId: p.id });
      return p;
    },
    db,
  );
}

export const LIMITE_LISTA = 500;
export type PacienteNaLista = Pick<PatientRow, 'id' | 'nome' | 'email' | 'status' | 'dataNascimento' | 'userId' | 'origem'>;

/**
 * Lista do painel (nome e contato, sem dado clínico — não audita; abrir o prontuário audita).
 * Busca sem acento por nome ou e-mail; `%`, `_` e `\` digitados são literais.
 */
export async function listarPacientes(ctx: TenantContext, filtro: { busca?: string; status?: StatusPaciente }, db: Db = getDb()): Promise<PacienteNaLista[]> {
  const conds: SQL[] = [eq(patients.status, filtro.status ?? 'ativo')];
  const busca = filtro.busca?.trim();
  if (busca) {
    const termo = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(sql`(unaccent(${patients.nome}) ilike unaccent(${termo}) or ${patients.email}::text ilike ${termo})`);
  }
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({
          id: patients.id,
          nome: patients.nome,
          email: patients.email,
          status: patients.status,
          dataNascimento: patients.dataNascimento,
          userId: patients.userId,
          origem: patients.origem,
        })
        .from(patients)
        .where(and(...conds))
        .orderBy(asc(patients.nome))
        .limit(LIMITE_LISTA),
    db,
  );
}
