import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mealPlans, type PatientRow } from '@/db/schema';
import { TenantContextError, withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { MSG_FICHA } from './textos';

/** Cartão Resumo do Início (RN-276), já formatado (pt-BR). Só estas chaves (RNF-263 c). */
export type CartaoResumo = { aniversario: string | null; pacienteDesde: string; planoPublicadoEm: string | null };

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** 'AAAA-MM-DD' → "{dia} de {mês}" (sem o ano: o cartão diz quando faz aniversário, não a idade, que já está no cabeçalho). */
const diaEMes = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
};

/**
 * Plano 18 (RN-276): o cartão Resumo — aniversário e "Paciente desde" (do paciente que `carregarProntuario` já leu e
 * auditou) e a data de publicação do plano publicado (RN-01: no máximo um por paciente). Sem auditRead: é uma data, como
 * as seções do Início. Só a sessão da nutricionista.
 */
export async function cartaoResumo(
  ctx: TenantContext,
  fuso: string,
  paciente: Pick<PatientRow, 'id' | 'dataNascimento' | 'createdAt'>,
  deps: { db?: Db } = {},
): Promise<CartaoResumo> {
  if (ctx.role !== 'nutri') throw new TenantContextError('o Início da ficha é só da sessão da nutricionista');
  const base = {
    aniversario: paciente.dataNascimento ? diaEMes(paciente.dataNascimento) : null,
    pacienteDesde: formatarDataNoFuso(paciente.createdAt, fuso),
  };
  if (!idValido(paciente.id)) return { ...base, planoPublicadoEm: null };
  const publicadoEm = await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx
        .select({ publicadoEm: mealPlans.publicadoEm })
        .from(mealPlans)
        .where(and(eq(mealPlans.patientId, paciente.id), eq(mealPlans.status, 'publicado')))
        .limit(1);
      return p?.publicadoEm ?? null;
    },
    deps.db ?? getDb(),
  );
  return { ...base, planoPublicadoEm: publicadoEm ? formatarDataNoFuso(publicadoEm, fuso) : null };
}

/** As linhas do cartão, na ordem da spec §8.3 (sem nascimento, sem a linha do aniversário). */
export function linhasDoResumo(c: CartaoResumo): string[] {
  const t = MSG_FICHA.resumo;
  return [
    ...(c.aniversario ? [t.aniversario(c.aniversario)] : []),
    t.desde(c.pacienteDesde),
    c.planoPublicadoEm ? t.planoPublicadoEm(c.planoPublicadoEm) : t.nenhumPlano,
  ];
}
