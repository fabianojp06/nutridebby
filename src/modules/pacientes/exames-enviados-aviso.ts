import { and, eq, lt } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { examSubmissions, tenants } from '@/db/schema';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { AVISO_EXAMES_INTERVALO_MS, ENVIO_LEMBRETE_DIAS } from './exames-enviados-constantes';

/**
 * RN-168 (D16 = a) e US-165: e-mail genérico às nutricionistas do tenant quando um envio chega a "recebido" — no máximo 1 a
 * cada 6 h por tenant (`tenants.exames_aviso_em`, conferido e gravado com a linha do tenant em FOR NO KEY UPDATE; na transação
 * do "recebido" ela já está nesse modo pela reserva de cota, D10). Nunca FOR UPDATE (revisão do plano): conflita com o KEY
 * SHARE de toda FK tenant_id (o audit_log de qualquer escrita auditada) e fecha deadlock — o molde é src/modules/ia/cota.ts. Leva a frase dos 30 dias quando há envio aguardando há mais que isso (PM-12:
 * o lembrete só sai junto de um aviso). Nada do paciente, do exame ou do arquivo (C-05). Devolve se avisou.
 */
export async function avisarExamesRecebidos(tx: Tx, o: { tenantId: string; agora: Date; appUrl: string }): Promise<boolean> {
  const [t] = await tx.select({ ultimo: tenants.examesAvisoEm }).from(tenants).where(eq(tenants.id, o.tenantId)).for('no key update');
  if (!t || (t.ultimo && o.agora.getTime() - t.ultimo.getTime() < AVISO_EXAMES_INTERVALO_MS)) return false;
  await tx.update(tenants).set({ examesAvisoEm: o.agora }).where(eq(tenants.id, o.tenantId));
  const [antigo] = await tx
    .select({ id: examSubmissions.id })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.status, 'recebido'), lt(examSubmissions.createdAt, new Date(o.agora.getTime() - ENVIO_LEMBRETE_DIAS * 86_400_000))))
    .limit(1);
  const link = urlDoApp(o.appUrl, '/painel/exames-recebidos');
  await avisarNutri(tx, o.tenantId, (para) => ({ tipo: 'exames_recebidos', para, link, pendentesAntigos: !!antigo }));
  return true;
}
