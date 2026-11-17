import { desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { anthropometry } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarDecimal } from '@/lib/numero';
import { idValido } from '@/modules/pacientes/base';
import { formatarData } from '@/modules/pacientes/datas';
import { auditRead } from '@/modules/plataforma/audit';
import { MSG_FICHA } from './textos';

/** Medidas da última avaliação, já formatadas (pt-BR, RN-275); `null` sem avaliação. */
export type Cabecalho = { data: string; alturaM: string | null; pesoKg: string | null; imc: string | null; gordura: string | null } | null;

const casas = (v: number | null, n: number): string | null => (v === null ? null : formatarDecimal(v, n));

/**
 * Plano 18 (D13, RN-275): a última antropometria do paciente (`data desc, created_at desc`), só as medidas e a data, com
 * UM auditRead (entidade `antropometria`, id da avaliação) na mesma transação; sem avaliação, nenhuma leitura gravada.
 * Na ficha, só por `carregarCabecalho` (`cache()` por id, `src/app/painel/pacientes/[id]/prontuario.ts`): uma linha
 * "Visualizou" por execução do layout.
 */
export async function lerCabecalho(ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<Cabecalho> {
  if (!idValido(patientId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [a] = await tx
        .select({ id: anthropometry.id, data: anthropometry.data, pesoKg: anthropometry.pesoKg, alturaCm: anthropometry.alturaCm, imc: anthropometry.imc, percGordura: anthropometry.percGordura })
        .from(anthropometry)
        .where(eq(anthropometry.patientId, patientId))
        .orderBy(desc(anthropometry.data), desc(anthropometry.createdAt))
        .limit(1);
      if (!a) return null;
      await auditRead(tx, { entidade: 'antropometria', entidadeId: a.id, patientId });
      return {
        data: formatarData(a.data),
        alturaM: casas(a.alturaCm === null ? null : a.alturaCm / 100, 2),
        pesoKg: casas(a.pesoKg, 1),
        imc: casas(a.imc, 1),
        gordura: casas(a.percGordura, 1),
      };
    },
    deps.db ?? getDb(),
  );
}

/** "Última avaliação em 12/10/2026: altura 1,65 m · peso 72,4 kg · IMC 26,6 · gordura 28,1%" (gordura só quando houver). */
export function linhaDoCabecalho(c: Cabecalho): string {
  const t = MSG_FICHA.cabecalho;
  if (!c) return t.semAvaliacao;
  const medidas = [
    c.alturaM === null ? null : t.altura(c.alturaM),
    c.pesoKg === null ? null : t.peso(c.pesoKg),
    c.imc === null ? null : t.imc(c.imc),
    c.gordura === null ? null : t.gordura(c.gordura),
  ].filter((x): x is string => x !== null);
  return t.ultimaAvaliacao(c.data, medidas.join(' · '));
}
