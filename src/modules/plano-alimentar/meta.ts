import { getDb, type Db } from '@/db/client';
import type { TenantContext } from '@/db/tenant';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { kcal } from '@/modules/pacientes/formulas';
import { listarCalculos, medidasRecentes } from '@/modules/pacientes/gasto-energetico';

export type ContextoPaciente = { pesoKg: number | null; calculos: { id: string; rotulo: string; kcal: number }[] };

const NOME_FORMULA: Record<string, string> = { harris_benedict: 'Harris-Benedict', mifflin: 'Mifflin-St Jeor', fao_oms: 'FAO/OMS' };

/** Peso para g/kg (D15) e cálculos de GET para "Usar como meta do plano". As duas leituras já são auditadas. */
export async function contextoDoPaciente(ctx: TenantContext, patientId: string, fuso: string, db: Db = getDb()): Promise<ContextoPaciente> {
  const [{ pesoKg }, calculos] = await Promise.all([medidasRecentes(ctx, patientId, db), listarCalculos(ctx, patientId, db)]);
  return {
    pesoKg,
    calculos: calculos.map((c) => ({
      id: c.id,
      kcal: kcal(c.get),
      rotulo: `${NOME_FORMULA[c.formula] ?? c.formula} · ${formatarDataNoFuso(c.createdAt, fuso)} · ${kcal(c.get)} kcal`, // data no fuso do tenant (RN-06)
    })),
  };
}
