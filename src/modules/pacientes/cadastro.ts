import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import {
  ESCOLARIDADES as VALORES_ESCOLARIDADE,
  ESTADOS_CIVIS as VALORES_ESTADO_CIVIL,
  IDENTIDADES_DE_GENERO as VALORES_IDENTIDADE,
  patientCadastro,
  patients,
  UFS as VALORES_UF,
  type PatientCadastroRow,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { auditRead } from '@/modules/plataforma/audit';
import { idValido, PacienteError } from './base';
import { cpfValido, normalizarCpf } from './cpf';
import { normalizarTelefone } from './telefone';

/**
 * Plano 18 (US-260, RN-260, RN-261, RN-262, D4, D23): cadastro complementar do paciente (Res. CFN 594/2017), gravado em
 * `patient_cadastro` na mesma transação de `patients`. Toda regra dos CHECKs da tabela é conferida aqui, antes de gravar
 * (o 23514 levaria a linha inteira ao log do Postgres), e a repetição do CPF é conferida sob trava antes do INSERT (o
 * 23505 levaria o CPF ao log). Nenhuma mensagem repete o valor digitado; nada daqui vai para log (RNF-262).
 */

export type IdentidadeDeGenero = (typeof VALORES_IDENTIDADE)[number];
export type EstadoCivil = (typeof VALORES_ESTADO_CIVIL)[number];
export type Escolaridade = (typeof VALORES_ESCOLARIDADE)[number];
export type Uf = (typeof VALORES_UF)[number];

export type CadastroComplementar = {
  /** Só os 11 dígitos. */
  cpf: string | null;
  nomeSocial: string | null;
  identidadeGenero: IdentidadeDeGenero | null;
  estadoCivil: EstadoCivil | null;
  escolaridade: Escolaridade | null;
  ocupacao: string | null;
  nacionalidade: string | null;
  naturalidade: string | null;
  /** E.164. */
  telefoneFixo: string | null;
  /** Só os 8 dígitos. */
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: Uf | null;
  observacao: string | null;
};
export type CampoDoCadastro = keyof CadastroComplementar;

/** Os campos do formulário, na ordem da tela (§8.4). */
export const CAMPOS_DO_CADASTRO = [
  'nomeSocial',
  'identidadeGenero',
  'estadoCivil',
  'escolaridade',
  'ocupacao',
  'nacionalidade',
  'naturalidade',
  'cpf',
  'telefoneFixo',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
  'observacao',
] as const satisfies readonly CampoDoCadastro[];
// todos os campos do tipo estão na lista (o `satisfies` acima confere o contrário)
const _todos: Exclude<CampoDoCadastro, (typeof CAMPOS_DO_CADASTRO)[number]> extends never ? true : never = true;
void _todos;

export const CADASTRO_VAZIO: CadastroComplementar = Object.freeze(
  Object.fromEntries(CAMPOS_DO_CADASTRO.map((c) => [c, null])) as CadastroComplementar,
) as CadastroComplementar;

/** Textos exatos da spec (US-260, §8.4). */
export const MSG_CADASTRO = {
  cpfInvalido: 'CPF inválido. Confira os números.',
  cpfRepetido: 'Já existe um paciente com este CPF neste consultório.',
  abrirExistente: 'Abrir o cadastro existente (abre em nova aba)',
  escolhaDaLista: 'Escolha uma opção da lista',
  ufDaLista: 'Selecione um estado da lista',
  telefoneFixo: 'Telefone fixo inválido',
  cepInvalido: 'CEP inválido. Use os 8 números.',
  observacaoMaximo: 'Use no máximo 1.000 caracteres',
  tamanho: (min: number, max: number) => `Use entre ${min} e ${max} caracteres`,
  avisoObservacao:
    'O paciente pode receber uma cópia deste campo se pedir os dados dele (LGPD). Para anotações só suas, use as notas privadas do atendimento.',
  contadorObservacao: (n: number) => `${n.toLocaleString('pt-BR')} de 1.000 caracteres`,
  secoes: {
    dadosGerais: 'Dados gerais',
    contatoEEndereco: 'Contato e endereço',
    observacao: 'Observação',
    acessoAoApp: 'Acesso ao app',
    etiquetas: 'Etiquetas',
  },
  legendaEndereco: 'Endereço (opcional)',
  selecione: 'Selecione',
  rotulos: {
    nome: 'Nome completo',
    nomeSocial: 'Nome social (opcional)',
    dataNascimento: 'Data de nascimento',
    identidadeGenero: 'Identidade de gênero (opcional)',
    estadoCivil: 'Estado civil (opcional)',
    escolaridade: 'Escolaridade (opcional)',
    ocupacao: 'Ocupação (opcional)',
    nacionalidade: 'Nacionalidade (opcional)',
    naturalidade: 'Naturalidade (opcional)',
    cpf: 'CPF (opcional)',
    email: 'E-mail',
    telefone: 'Celular / WhatsApp (opcional)',
    telefoneFixo: 'Telefone fixo (opcional)',
    cep: 'CEP',
    logradouro: 'Rua',
    numero: 'Número',
    complemento: 'Complemento',
    bairro: 'Bairro',
    cidade: 'Cidade',
    uf: 'Estado',
    observacao: 'Observação (opcional)',
  },
  dicas: {
    nomeSocial: 'Preencha só a pedido do paciente. Aparece no painel junto do nome completo.',
    identidadeGenero: 'Como o paciente se identifica. As fórmulas usam o sexo biológico.',
    ocupacao: 'Profissão ou atividade principal.',
    nacionalidade: 'Ex.: brasileira',
    naturalidade: 'Cidade e estado onde nasceu. Ex.: Campinas (SP)',
    cpf: 'Para identificar o paciente sem engano. Não aparece na lista nem no app.',
    telefone: 'Ex.: (11) 91234-5678. Aceita fixo, mas os avisos de WhatsApp só saem para celular, se o paciente autorizar.',
    telefoneFixo: 'Ex.: (11) 3123-4567',
  },
} as const;

type Opcao<V extends string> = { valor: V; rotulo: string };
const opcoes = <V extends string>(valores: readonly V[], rotulos: Record<V, string>): readonly Opcao<V>[] =>
  Object.freeze(valores.map((valor) => Object.freeze({ valor, rotulo: rotulos[valor] })));

/** Listas fechadas da US-260 com os rótulos da tela (§8.4); os valores vêm do schema (os mesmos dos CHECKs). */
export const IDENTIDADES_DE_GENERO = opcoes(VALORES_IDENTIDADE, {
  mulher: 'Mulher',
  homem: 'Homem',
  nao_binario: 'Não binário',
  outra: 'Outra',
  prefere_nao_informar: 'Prefere não informar',
});
export const ESTADOS_CIVIS = opcoes(VALORES_ESTADO_CIVIL, {
  solteiro: 'Solteiro(a)',
  casado: 'Casado(a)',
  uniao_estavel: 'União estável',
  separado: 'Separado(a)',
  divorciado: 'Divorciado(a)',
  viuvo: 'Viúvo(a)',
});
export const ESCOLARIDADES = opcoes(VALORES_ESCOLARIDADE, {
  sem_escolaridade: 'Sem escolaridade',
  fundamental_incompleto: 'Ensino fundamental incompleto',
  fundamental_completo: 'Ensino fundamental completo',
  medio_incompleto: 'Ensino médio incompleto',
  medio_completo: 'Ensino médio completo',
  superior_incompleto: 'Ensino superior incompleto',
  superior_completo: 'Ensino superior completo',
  pos_graduacao: 'Pós-graduação',
});
export const UFS = opcoes(VALORES_UF, {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
});

/** As regras de cada campo: uma fonte só (as faixas e listas dos CHECKs de `patient_cadastro`). */
type Regra =
  | { tipo: 'texto'; min: number; max: number }
  | { tipo: 'lista'; valores: readonly string[]; erro: string }
  | { tipo: 'cpf' }
  | { tipo: 'cep' }
  | { tipo: 'telefone' };

const REGRAS: Record<CampoDoCadastro, Regra> = {
  cpf: { tipo: 'cpf' },
  nomeSocial: { tipo: 'texto', min: 2, max: 120 },
  identidadeGenero: { tipo: 'lista', valores: VALORES_IDENTIDADE, erro: MSG_CADASTRO.escolhaDaLista },
  estadoCivil: { tipo: 'lista', valores: VALORES_ESTADO_CIVIL, erro: MSG_CADASTRO.escolhaDaLista },
  escolaridade: { tipo: 'lista', valores: VALORES_ESCOLARIDADE, erro: MSG_CADASTRO.escolhaDaLista },
  ocupacao: { tipo: 'texto', min: 2, max: 80 },
  nacionalidade: { tipo: 'texto', min: 2, max: 60 },
  naturalidade: { tipo: 'texto', min: 2, max: 80 },
  telefoneFixo: { tipo: 'telefone' },
  cep: { tipo: 'cep' },
  logradouro: { tipo: 'texto', min: 2, max: 120 },
  numero: { tipo: 'texto', min: 1, max: 10 },
  complemento: { tipo: 'texto', min: 1, max: 60 },
  bairro: { tipo: 'texto', min: 2, max: 60 },
  cidade: { tipo: 'texto', min: 2, max: 60 },
  uf: { tipo: 'lista', valores: VALORES_UF, erro: MSG_CADASTRO.ufDaLista },
  observacao: { tipo: 'texto', min: 1, max: 1000 },
};

function erroDaRegra(campo: CampoDoCadastro, r: Regra): string {
  switch (r.tipo) {
    case 'texto':
      return campo === 'observacao' ? MSG_CADASTRO.observacaoMaximo : MSG_CADASTRO.tamanho(r.min, r.max);
    case 'lista':
      return r.erro;
    case 'cpf':
      return MSG_CADASTRO.cpfInvalido;
    case 'cep':
      return MSG_CADASTRO.cepInvalido;
    case 'telefone':
      return MSG_CADASTRO.telefoneFixo;
  }
}

/** Os mesmos padrões dos CHECKs (`patient_cadastro_*_check`), conferidos de novo depois de normalizar. */
const E164 = /^\+[1-9][0-9]{7,14}$/;
const OITO_DIGITOS = /^[0-9]{8}$/;

/**
 * Um campo: ausente, nulo, vazio ou só espaços → `null`; senão, o valor normalizado ou a mensagem do campo. O tamanho
 * conta caracteres como o `char_length` do Postgres (code points, não unidades UTF-16 do JS).
 */
function validarCampo(campo: CampoDoCadastro, bruto: unknown): { ok: true; valor: string | null } | { ok: false; erro: string } {
  if (bruto === undefined || bruto === null) return { ok: true, valor: null };
  const regra = REGRAS[campo];
  const erro = { ok: false as const, erro: erroDaRegra(campo, regra) };
  if (typeof bruto !== 'string') return erro;
  const t = bruto.trim();
  if (!t) return { ok: true, valor: null };
  // o NUL derrubaria o INSERT (texto do Postgres não aceita) — recusado como valor fora da regra
  if (t.includes('\u0000')) return erro;
  switch (regra.tipo) {
    case 'texto': {
      const n = Array.from(t).length;
      return n >= regra.min && n <= regra.max ? { ok: true, valor: t } : erro;
    }
    case 'lista':
      return regra.valores.includes(t) ? { ok: true, valor: t } : erro;
    case 'cpf': {
      const d = normalizarCpf(t);
      return d && cpfValido(d) ? { ok: true, valor: d } : erro;
    }
    case 'cep': {
      const d = t.replace(/-/g, '');
      return OITO_DIGITOS.test(d) ? { ok: true, valor: d } : erro;
    }
    case 'telefone': {
      const e164 = normalizarTelefone(t);
      return e164 && E164.test(e164) ? { ok: true, valor: e164 } : erro;
    }
  }
}

/** Confere todas as regras dos CHECKs (D23). Campo ausente conta como vazio. */
export function validarCadastro(
  input: Record<string, unknown>,
): { ok: true; valor: CadastroComplementar } | { ok: false; erros: Partial<Record<CampoDoCadastro, string>> } {
  const valor: Record<string, string | null> = {};
  const erros: Partial<Record<CampoDoCadastro, string>> = {};
  for (const campo of CAMPOS_DO_CADASTRO) {
    const r = validarCampo(campo, input[campo]);
    if (r.ok) valor[campo] = r.valor;
    else erros[campo] = r.erro;
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, valor: valor as CadastroComplementar };
}

/**
 * Os campos do cadastro como chaves do `pacienteSchema` (zod), pela mesma `validarCampo`: os erros saem junto com os do
 * paciente, um por campo, sem repetir tamanhos e listas no zod.
 */
const campoZod = <K extends CampoDoCadastro>(campo: K) =>
  z
    .unknown()
    .optional()
    .transform((v, ctx): CadastroComplementar[K] => {
      const r = validarCampo(campo, v);
      if (!r.ok) {
        ctx.addIssue({ code: 'custom', message: r.erro });
        return z.NEVER;
      }
      return r.valor as CadastroComplementar[K];
    });
export const formaDoCadastro = () =>
  Object.fromEntries(CAMPOS_DO_CADASTRO.map((c) => [c, campoZod(c)])) as { [K in CampoDoCadastro]: ReturnType<typeof campoZod<K>> };

/** RN-261: o outro paciente com o mesmo CPF. `outroId` nulo quando ele está bloqueado (sem o link "Abrir o cadastro existente"). */
export class CpfRepetidoError extends PacienteError {
  override name = 'CpfRepetidoError';
  constructor(readonly outroId: string | null) {
    super({ cpf: MSG_CADASTRO.cpfRepetido });
  }
}

const colunasDo = (v: CadastroComplementar) => ({
  cpf: v.cpf,
  nomeSocial: v.nomeSocial,
  identidadeGenero: v.identidadeGenero,
  estadoCivil: v.estadoCivil,
  escolaridade: v.escolaridade,
  ocupacao: v.ocupacao,
  nacionalidade: v.nacionalidade,
  naturalidade: v.naturalidade,
  telefoneFixoE164: v.telefoneFixo,
  cep: v.cep,
  logradouro: v.logradouro,
  numero: v.numero,
  complemento: v.complemento,
  bairro: v.bairro,
  cidade: v.cidade,
  uf: v.uf,
  observacao: v.observacao,
});

const doBanco = (c: PatientCadastroRow): CadastroComplementar => ({
  cpf: c.cpf,
  nomeSocial: c.nomeSocial,
  identidadeGenero: c.identidadeGenero as IdentidadeDeGenero | null,
  estadoCivil: c.estadoCivil as EstadoCivil | null,
  escolaridade: c.escolaridade as Escolaridade | null,
  ocupacao: c.ocupacao,
  nacionalidade: c.nacionalidade,
  naturalidade: c.naturalidade,
  telefoneFixo: c.telefoneFixoE164,
  cep: c.cep,
  logradouro: c.logradouro,
  numero: c.numero,
  complemento: c.complemento,
  bairro: c.bairro,
  cidade: c.cidade,
  uf: c.uf as Uf | null,
  observacao: c.observacao,
});

/**
 * D23: a repetição do CPF é conferida antes do INSERT, sob uma trava por consultório e CPF — dois cadastros com o mesmo
 * CPF ao mesmo tempo se enfileiram, e o segundo acha o primeiro já gravado (READ COMMITTED: foto nova a cada comando).
 * Assim o 23505 (que leva o CPF ao log do Postgres) não acontece no caminho normal; o índice único fica como última defesa.
 */
async function conferirCpf(tx: Tx, tenantId: string, patientId: string, cpf: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('patient_cadastro_cpf'), hashtext(${`${tenantId}:${cpf}`}))`);
  const [outro] = await tx
    .select({ id: patients.id, status: patients.status, anonimizadoEm: patients.anonimizadoEm })
    .from(patientCadastro)
    .innerJoin(patients, and(eq(patients.tenantId, patientCadastro.tenantId), eq(patients.id, patientCadastro.patientId)))
    .where(and(eq(patientCadastro.tenantId, tenantId), eq(patientCadastro.cpf, cpf), ne(patientCadastro.patientId, patientId)))
    .limit(1);
  if (outro) throw new CpfRepetidoError(outro.status === 'bloqueado' || outro.anonimizadoEm ? null : outro.id);
}

/**
 * RN-260: grava o cadastro complementar na transação do paciente (quem chama já travou ou criou o paciente). A linha só
 * nasce com algum campo preenchido; depois de nascer, esvaziar tudo grava a linha com tudo nulo (o DELETE é só da
 * anonimização). `valor` vem de `validarCadastro`/`pacienteSchema` (as regras dos CHECKs já conferidas).
 */
export async function gravarCadastro(
  tx: Tx,
  a: { tenantId: string; patientId: string; valor: CadastroComplementar; now?: Date },
): Promise<void> {
  const now = a.now ?? new Date();
  const colunas = { ...colunasDo(a.valor), updatedAt: now };
  const doPaciente = and(eq(patientCadastro.tenantId, a.tenantId), eq(patientCadastro.patientId, a.patientId));
  if (CAMPOS_DO_CADASTRO.every((c) => a.valor[c] === null)) {
    await tx.update(patientCadastro).set(colunas).where(doPaciente);
    return;
  }
  if (a.valor.cpf) await conferirCpf(tx, a.tenantId, a.patientId, a.valor.cpf);
  try {
    await tx
      .insert(patientCadastro)
      .values({ tenantId: a.tenantId, patientId: a.patientId, ...colunas, createdAt: now })
      .onConflictDoUpdate({ target: [patientCadastro.tenantId, patientCadastro.patientId], set: colunas });
  } catch (err) {
    // última defesa: CPF gravado por fora da trava entre a conferência e o INSERT
    if (uniqueViolation(err) === 'patient_cadastro_cpf_unico') throw new CpfRepetidoError(null);
    throw err;
  }
}

/**
 * A aba Perfil (D20: o único lugar que lê os valores): o cadastro complementar do paciente, com a leitura auditada como
 * "Cadastro do paciente" (entidade `patients`, `entidade_id` = id da linha, como a trilha das escritas). Sem linha (nunca
 * preenchido), outro tenant ou id malformado → `null`, sem auditar.
 */
export async function cadastroDoPaciente(ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<CadastroComplementar | null> {
  if (!idValido(patientId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx
        .select()
        .from(patientCadastro)
        .where(and(eq(patientCadastro.tenantId, ctx.tenantId), eq(patientCadastro.patientId, patientId)));
      if (!c) return null;
      await auditRead(tx, { entidade: 'patients', entidadeId: c.id, patientId });
      return doBanco(c);
    },
    deps.db ?? getDb(),
  );
}
