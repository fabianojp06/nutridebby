import { and, asc, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { patientCadastro, patients, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { normalizeEmail } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { agendarConviteWhatsapp } from '@/modules/notificacoes/agendar';
import { auditRead } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita, idValido, PacienteError, PacienteNaoEncontradoError } from './base';
import { CAMPOS_DO_CADASTRO, CpfRepetidoError, formaDoCadastro, gravarCadastro, type CadastroComplementar } from './cadastro';
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
  conviteSemAutorizacao: 'Marque que o paciente autorizou o WhatsApp',
  emailBloqueado: 'O paciente já ativou o acesso; o e-mail não pode ser alterado.',
} as const;

export type TenantDoPaciente = Pick<TenantRow, 'fuso' | 'nomeExibicao'>;
export type StatusPaciente = 'ativo' | 'arquivado' | 'bloqueado';
export { PacienteError, type ErrosPaciente } from './base';

/**
 * US-010 + RN-17. `hoje` = data no fuso do tenant (RN-06): a idade de 18 anos vale no dia do consultório. Plano 18
 * (US-260, D23): os campos do cadastro complementar entram opcionais, validados pelas regras de `cadastro.ts` (as dos
 * CHECKs de `patient_cadastro`, uma fonte só); os erros saem junto com os do paciente, um por campo.
 */
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
      /** US-010: só no cadastro (a edição ignora). */
      enviarConviteWhatsapp: z.boolean().default(false),
      ...formaDoCadastro(),
    })
    .superRefine((v, ctx) => {
      if (v.whatsappAutorizado && !v.telefone) {
        ctx.addIssue({ code: 'custom', path: ['whatsappAutorizado'], message: MSG_PACIENTE.whatsappSemTelefone });
      }
      if (v.enviarConviteWhatsapp && !v.whatsappAutorizado) {
        ctx.addIssue({ code: 'custom', path: ['enviarConviteWhatsapp'], message: MSG_PACIENTE.conviteSemAutorizacao });
      }
    });
}

type DadosPaciente = z.output<ReturnType<typeof pacienteSchema>>;
type Deps = { db?: Db; now?: Date; appUrl?: string };

/**
 * O cadastro complementar grava só os campos que vieram (o formulário em seções manda todos, vazio = ''): chave ausente
 * mantém o que está gravado — quem chama sem eles (testes e chamadores de antes do Plano 18) ou com parte deles não apaga
 * em silêncio o resto (`gravarCadastro`).
 */
function validar(
  tenant: TenantDoPaciente,
  input: Record<string, unknown>,
  now: Date,
): { v: DadosPaciente; cadastro: Partial<CadastroComplementar> | null } {
  const r = pacienteSchema(hojeNoFuso(tenant.fuso, now)).safeParse(input);
  if (!r.success) throw new PacienteError(primeiroErroPorCampo(r.error));
  const enviados = CAMPOS_DO_CADASTRO.filter((c) => input[c] !== undefined);
  return { v: r.data, cadastro: enviados.length ? (Object.fromEntries(enviados.map((c) => [c, r.data[c]])) as Partial<CadastroComplementar>) : null };
}

function comoDuplicado(err: unknown): never {
  const indice = uniqueViolation(err);
  if (indice === 'patients_tenant_email_unique') throw new PacienteError({ email: MSG_PACIENTE.emailDuplicado });
  // D23: a pré-checagem sob trava (`gravarCadastro`) evita este caminho; o índice é a última defesa
  if (indice === 'patient_cadastro_cpf_unico') throw new CpfRepetidoError(null);
  throw err;
}

/**
 * Autorização presencial (INT-01, `origem = 'nutri'`). Nunca desfaz uma escolha do paciente: o opt-out
 * dele vale sobre o formulário da nutricionista, e desmarcar só apaga o opt-in de origem 'nutri'.
 */
function autorizacaoWhatsapp(
  autorizado: boolean,
  atual: Pick<PatientRow, 'whatsappOptinEm' | 'whatsappOptinOrigem' | 'whatsappOptoutEm'> | null,
  now: Date,
) {
  if (autorizado) return atual?.whatsappOptinEm || atual?.whatsappOptoutEm ? {} : { whatsappOptinEm: now, whatsappOptinOrigem: 'nutri' };
  return atual?.whatsappOptinOrigem === 'nutri' || !atual ? { whatsappOptinEm: null, whatsappOptinOrigem: null } : {};
}

/**
 * US-010: paciente `ativo`, `user_id` nulo. Em corrida, quem decide o e-mail repetido é a UNIQUE
 * (tenant_id, email) em citext — sem pré-checagem. "Enviar convite por WhatsApp": um aviso sem link (o link vai só
 * no e-mail), numa linha do motor de envio na mesma transação; o e-mail sai qualquer que seja o resultado do WhatsApp.
 */
export async function criarPaciente(ctx: TenantContext, tenant: TenantDoPaciente, input: Record<string, unknown>, deps: Deps = {}): Promise<PatientRow> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const { v, cadastro } = validar(tenant, input, now);
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
        // Plano 18 (RN-260): o cadastro complementar na mesma transação (a linha só nasce com algum campo preenchido)
        if (cadastro) await gravarCadastro(tx, { tenantId: ctx.tenantId, patientId: p.id, valor: cadastro, now });
        // US-010: convite de 7 dias por e-mail na mesma transação (paciente criado ⇔ convite na fila)
        await enviarConvitePaciente(tx, p, { appUrl: deps.appUrl ?? getEnv().APP_URL, nutri: tenant.nomeExibicao, now });
        // US-010 "Convite também por WhatsApp": aviso sem link, só com a autorização registrada (INT-01: opt-in antes de qualquer mensagem)
        if (v.enviarConviteWhatsapp && p.whatsappOptinEm && !p.whatsappOptoutEm) await agendarConviteWhatsapp(tx, { tenantId: ctx.tenantId, patientId: p.id }, now);
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
  const { v, cadastro } = validar(tenant, input, now);
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
        // Plano 18 (RN-260): depois de travar o paciente (carregarPacienteParaEscrita), na mesma transação
        if (cadastro) await gravarCadastro(tx, { tenantId: ctx.tenantId, patientId, valor: cadastro, now });
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

export type PacienteDaFicha = PatientRow & { nomeSocial: string | null };

/**
 * Abrir o prontuário (US-007 "Leitura auditada"): a leitura vai para o audit_log na mesma transação. Plano 18 (D7, D20):
 * do cadastro complementar, só o nome social (por projeção; CPF, endereço e observação ficam só na aba Perfil).
 */
export async function buscarPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<PacienteDaFicha | null> {
  if (!idValido(patientId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx
        .select({ ...getTableColumns(patients), nomeSocial: patientCadastro.nomeSocial })
        .from(patients)
        .leftJoin(patientCadastro, and(eq(patientCadastro.tenantId, patients.tenantId), eq(patientCadastro.patientId, patients.id)))
        .where(eq(patients.id, patientId));
      if (!p) return null;
      await auditRead(tx, { entidade: 'patients', entidadeId: p.id, patientId: p.id });
      return p;
    },
    db,
  );
}

export const LIMITE_LISTA = 500;

/** Plano 18 (RN-270): as abas da lista; `bloqueados` é o "Ver bloqueados" (`?situacao=bloqueados`), fora das abas. */
export type AbaDaLista = 'ativos' | 'inativos' | 'todos' | 'bloqueados';
/** Plano 18 (RN-271): a ordem é a do nome exibido (o social, quando há). */
export type OrdemDaLista = 'nome' | 'nome_desc' | 'recentes' | 'antigos';
/** `registro`: só para quem mostra o nome de registro (a agenda, D7); `filtroDaUrl` nunca devolve. */
export type OrdemInterna = OrdemDaLista | 'registro';
export type FiltroDaLista = {
  /** Padrão: `ativos`. */
  aba?: AbaDaLista;
  busca?: string;
  etiquetaId?: string;
  /** Padrão: `nome`. */
  ordem?: OrdemInterna;
  // Ponto de extensão (Plano 18, D11): outros planos acrescentam aqui campos opcionais (o local de atendimento, Plano 23).
};
export type PacienteNaLista = Pick<PatientRow, 'id' | 'nome' | 'email' | 'status' | 'dataNascimento' | 'userId' | 'origem' | 'createdAt'> & {
  nomeSocial: string | null;
};

const ABAS_DA_URL: readonly AbaDaLista[] = ['ativos', 'inativos', 'todos'];
const ORDENS_DA_URL: readonly OrdemDaLista[] = ['nome', 'nome_desc', 'recentes', 'antigos'];
const STATUS_DA_ABA: Record<AbaDaLista, StatusPaciente[]> = {
  ativos: ['ativo'],
  inativos: ['arquivado'],
  todos: ['ativo', 'arquivado'],
  bloqueados: ['bloqueado'],
};

/**
 * Plano 18 (RN-270, RN-271): o filtro da lista a partir da URL (ou dos campos ocultos do menu da linha). `?aba=` só aceita
 * as três abas; `?situacao=bloqueados` vale como `bloqueados`; o link antigo `?status=arquivado` vale como `inativos` e
 * `?status=bloqueado` como `bloqueados`; valor desconhecido (ou repetido) cai no padrão. `registro` nunca sai daqui.
 */
export function filtroDaUrl(sp: Record<string, string | string[] | undefined>): FiltroDaLista {
  const v = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const aba: AbaDaLista =
    v('situacao') === 'bloqueados' || v('status') === 'bloqueado'
      ? 'bloqueados'
      : (ABAS_DA_URL as readonly string[]).includes(v('aba'))
        ? (v('aba') as AbaDaLista)
        : v('status') === 'arquivado'
          ? 'inativos'
          : 'ativos';
  const ordem: OrdemDaLista = (ORDENS_DA_URL as readonly string[]).includes(v('ordem')) ? (v('ordem') as OrdemDaLista) : 'nome';
  return { aba, ...(v('busca') ? { busca: v('busca') } : {}), ...(v('etiqueta') ? { etiquetaId: v('etiqueta') } : {}), ordem };
}

/** Classe dos curingas do LIKE (`\`, `%`, `_`) e a troca de cada um por ele mesmo escapado, para o `regexp_replace`. */
const CURINGAS_DO_LIKE = '([\\\\%_])';
const CURINGA_ESCAPADO = '\\\\\\1';

/**
 * Lista do painel (nome e contato; abrir o prontuário audita). Busca sem acento pelo nome, pelo nome social ou pelo
 * e-mail; `%`, `_` e `\` digitados são literais. Com `etiquetaId`, a lista diz quem tem "diabetes", "gestante": é dado de
 * saúde (regra 8), então cada paciente devolvido gera uma leitura auditada de "Etiquetas". Plano 18 (RN-272, D20): do
 * cadastro complementar, só o nome social (por projeção, `left join`); a ordem é pelo nome exibido
 * (`coalesce(nome_social, nome)`), sem acento e sem diferença de maiúsculas, com empate pelo id.
 */
export async function listarPacientes(ctx: TenantContext, filtro: FiltroDaLista, db: Db = getDb()): Promise<PacienteNaLista[]> {
  if (filtro.etiquetaId !== undefined && !idValido(filtro.etiquetaId)) return [];
  const conds: SQL[] = [inArray(patients.status, STATUS_DA_ABA[filtro.aba ?? 'ativos'])];
  if (filtro.etiquetaId) {
    conds.push(sql`exists (select 1 from patient_tag_links l where l.patient_id = ${patients.id} and l.tag_id = ${filtro.etiquetaId})`);
  }
  const busca = filtro.busca?.trim();
  if (busca) {
    // SUS-115: o escape vem depois do unaccent, que leva "％", "＿" e "＼" de largura cheia a "%", "_" e "\".
    const termoSemAcento = sql`'%' || regexp_replace(unaccent(${busca}::text), ${CURINGAS_DO_LIKE}, ${CURINGA_ESCAPADO}, 'g') || '%'`;
    const termo = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(
      sql`(unaccent(${patients.nome}) ilike ${termoSemAcento} or unaccent(${patientCadastro.nomeSocial}) ilike ${termoSemAcento} or ${patients.email}::text ilike ${termo})`,
    );
  }
  const exibido = sql`unaccent(lower(coalesce(${patientCadastro.nomeSocial}, ${patients.nome})))`;
  const ordem: Record<OrdemInterna, SQL[]> = {
    nome: [asc(exibido), asc(patients.id)],
    nome_desc: [desc(exibido), asc(patients.id)],
    recentes: [desc(patients.createdAt), asc(patients.id)],
    antigos: [asc(patients.createdAt), asc(patients.id)],
    registro: [asc(sql`unaccent(lower(${patients.nome}))`), asc(patients.id)],
  };
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({
          id: patients.id,
          nome: patients.nome,
          nomeSocial: patientCadastro.nomeSocial,
          email: patients.email,
          status: patients.status,
          dataNascimento: patients.dataNascimento,
          userId: patients.userId,
          origem: patients.origem,
          createdAt: patients.createdAt,
        })
        .from(patients)
        .leftJoin(patientCadastro, and(eq(patientCadastro.tenantId, patients.tenantId), eq(patientCadastro.patientId, patients.id)))
        .where(and(...conds))
        .orderBy(...ordem[filtro.ordem ?? 'nome'])
        .limit(LIMITE_LISTA);
      // Um INSERT só para a lista toda (até LIMITE_LISTA linhas)
      if (filtro.etiquetaId && r.length) await auditRead(tx, r.map((p) => ({ entidade: 'etiquetas', entidadeId: null, patientId: p.id })));
      return r;
    },
    db,
  );
}
