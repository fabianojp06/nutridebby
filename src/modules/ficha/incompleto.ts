import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { patientCadastro, patients } from '@/db/schema';
import { TenantContextError, withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { MSG_FICHA } from './textos';

/** Os campos da nota "Cadastro incompleto" (D17, RN-269), na ordem da spec §8.3. Fora da lista: nome social, CPF, observação, complemento. */
const CAMPOS = ['dataNascimento', 'sexo', 'identidadeGenero', 'estadoCivil', 'nacionalidade', 'naturalidade', 'escolaridade', 'ocupacao', 'endereco', 'telefone'] as const;
export type PresencaDoCadastro = Record<(typeof CAMPOS)[number], boolean>;

const presente = (coluna: AnyColumn): SQL<boolean> => sql<boolean>`${coluna} is not null`;

/**
 * Plano 18 (RN-269): a PRESENÇA de cada campo da lista fechada — só expressões `campo is not null`, nunca o valor (D20:
 * só a aba Perfil lê os valores) — e sem auditRead. Endereço: CEP, rua, número, bairro, cidade e UF (o complemento não
 * conta); telefone: o celular (`patients`) ou o fixo. Paciente que a sessão não vê (outro tenant) → tudo ausente.
 */
export async function presencaDoCadastro(tx: Tx, patientId: string): Promise<PresencaDoCadastro> {
  const c = patientCadastro;
  const [p] = await tx
    .select({
      dataNascimento: presente(patients.dataNascimento),
      sexo: presente(patients.sexo),
      identidadeGenero: presente(c.identidadeGenero),
      estadoCivil: presente(c.estadoCivil),
      nacionalidade: presente(c.nacionalidade),
      naturalidade: presente(c.naturalidade),
      escolaridade: presente(c.escolaridade),
      ocupacao: presente(c.ocupacao),
      endereco: sql<boolean>`(${presente(c.cep)} and ${presente(c.logradouro)} and ${presente(c.numero)} and ${presente(c.bairro)} and ${presente(c.cidade)} and ${presente(c.uf)})`,
      telefone: sql<boolean>`(${presente(patients.telefoneE164)} or ${presente(c.telefoneFixoE164)})`,
    })
    .from(patients)
    .leftJoin(c, and(eq(c.tenantId, patients.tenantId), eq(c.patientId, patients.id)))
    .where(eq(patients.id, patientId));
  return Object.fromEntries(CAMPOS.map((k) => [k, p?.[k] === true])) as PresencaDoCadastro;
}

/**
 * O texto da nota (RN-269, spec §8.3): até 3 itens, "Cadastro incompleto: faltam {itens}." (minúsculas, vírgula e "e");
 * 4 ou mais, "Cadastro incompleto: faltam {n} dados."; nada faltando → `null`.
 */
export function textoDoIncompleto(p: PresencaDoCadastro): string | null {
  const t = MSG_FICHA.incompleto;
  const faltam = CAMPOS.filter((k) => !p[k]).map((k) => t.itens[k]);
  if (!faltam.length) return null;
  if (faltam.length > 3) return t.quantidade(faltam.length);
  const itens = faltam.length === 1 ? faltam[0] : `${faltam.slice(0, -1).join(', ')} e ${faltam[faltam.length - 1]}`;
  return t.itensFaltando(itens);
}

/**
 * A nota do cartão Resumo do Início (RN-276): o texto de `textoDoIncompleto` lido numa transação da sessão da
 * nutricionista, sem auditRead (só presença). Id malformado → `null`, sem consultar.
 */
export async function cadastroIncompleto(ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<string | null> {
  if (ctx.role !== 'nutri') throw new TenantContextError('o Início da ficha é só da sessão da nutricionista');
  if (!idValido(patientId)) return null;
  const presenca = await withTenant(ctx, (tx) => presencaDoCadastro(tx, patientId), deps.db ?? getDb());
  return textoDoIncompleto(presenca);
}
