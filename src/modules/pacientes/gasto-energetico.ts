import { desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { anthropometry, energyCalcs, type EnergyCalcRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arredondar, decimalEntre } from '@/lib/numero';
import { auditRead } from '@/modules/plataforma/audit';
import { MSG_ANTROPO } from './antropometria-constantes';
import { carregarPacienteParaEscrita, idValido, MSG_CADASTRO_INCOMPLETO } from './base';
import { hojeNoFuso, idadeEm } from './datas';
import {
  FATOR_MAX,
  FATOR_MIN,
  FORMULAS_TMB,
  gastoTotal,
  kcal,
  tmb,
  type FormulaTmb,
  type Sexo,
} from './formulas';

export const MSG_GASTO = {
  fator: 'Fator de atividade deve estar entre 1,00 e 2,50',
  formula: 'Escolha a fórmula',
  menor: 'O sistema atende apenas pacientes a partir de 18 anos',
} as const;

export class GastoError extends Error {
  override name = 'GastoError';
  constructor(readonly erros: Record<string, string>) {
    super('Cálculo inválido');
  }
}

const PESO = decimalEntre(MSG_ANTROPO.peso, 1, 400);
const ALTURA = decimalEntre(MSG_ANTROPO.altura, 30, 250);
const FATOR = decimalEntre(MSG_GASTO.fator, FATOR_MIN, FATOR_MAX);

/**
 * US-014. A idade é a do dia do cálculo no fuso do tenant (RN-14); sexo e nascimento vêm do cadastro.
 * Grava o resultado sem arredondar (6 casas); devolve kcal inteiros a partir do mesmo valor, como a lista mostra.
 */
export async function salvarCalculo(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  input: { formula: unknown; pesoKg: unknown; alturaCm: unknown; fator: unknown },
  deps: { db?: Db; now?: Date } = {},
): Promise<{ id: string; tmb: number; get: number }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const erros: Record<string, string> = {};
  const formula = FORMULAS_TMB.some((f) => f.id === input.formula)
    ? (input.formula as FormulaTmb)
    : null;
  if (!formula) erros.formula = MSG_GASTO.formula;
  const peso = PESO.safeParse(input.pesoKg);
  if (!peso.success) erros.pesoKg = peso.error.issues[0].message;
  const altura = ALTURA.safeParse(input.alturaCm);
  if (!altura.success) erros.alturaCm = altura.error.issues[0].message;
  const fator = FATOR.safeParse(input.fator);
  if (!fator.success) erros.fator = fator.error.issues[0].message;
  if (!formula || !peso.success || !altura.success || !fator.success) throw new GastoError(erros);

  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (!p.dataNascimento || !p.sexo) throw new GastoError({ geral: MSG_CADASTRO_INCOMPLETO });
      const idade = idadeEm(p.dataNascimento, hojeNoFuso(tenant.fuso, now));
      // RN-17: menor de 18 (ou nascimento no futuro) não entra na conta; a tabela também recusa (check)
      if (!Number.isFinite(idade) || idade < 18) throw new GastoError({ geral: MSG_GASTO.menor });
      const dados = {
        sexo: p.sexo as Sexo,
        pesoKg: arredondar(peso.data, 2),
        alturaCm: arredondar(altura.data, 1),
        idade,
      };
      const fatorAtividade = arredondar(fator.data, 2);
      const t = tmb(formula, dados);
      const g = gastoTotal(t, fatorAtividade);
      const tGravado = arredondar(t, 6);
      const gGravado = arredondar(g, 6);
      const [row] = await tx
        .insert(energyCalcs)
        .values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          formula,
          ...dados,
          fatorAtividade,
          tmb: tGravado,
          get: gGravado,
          createdAt: now,
        })
        .returning({ id: energyCalcs.id });
      // kcal() do mesmo valor gravado: a mensagem de sucesso e a lista mostram o mesmo inteiro
      return { id: row.id, tmb: kcal(tGravado), get: kcal(gGravado) };
    },
    db,
  );
}

export async function listarCalculos(
  ctx: TenantContext,
  patientId: string,
  db: Db = getDb(),
): Promise<EnergyCalcRow[]> {
  if (!idValido(patientId)) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select()
        .from(energyCalcs)
        .where(eq(energyCalcs.patientId, patientId))
        .orderBy(desc(energyCalcs.createdAt));
      if (r.length)
        await auditRead(tx, { entidade: 'gasto_energetico', entidadeId: null, patientId });
      return r;
    },
    db,
  );
}

/** Peso e altura da avaliação mais recente, para preencher o cálculo (US-014 "com última antropometria"). */
export async function medidasRecentes(
  ctx: TenantContext,
  patientId: string,
  db: Db = getDb(),
): Promise<{ pesoKg: number | null; alturaCm: number | null }> {
  if (!idValido(patientId)) return { pesoKg: null, alturaCm: null };
  return withTenant(
    ctx,
    async (tx) => {
      const [a] = await tx
        .select({ pesoKg: anthropometry.pesoKg, alturaCm: anthropometry.alturaCm })
        .from(anthropometry)
        .where(eq(anthropometry.patientId, patientId))
        .orderBy(desc(anthropometry.data), desc(anthropometry.createdAt))
        .limit(1);
      if (!a) return { pesoKg: null, alturaCm: null };
      await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId });
      return a;
    },
    db,
  );
}
