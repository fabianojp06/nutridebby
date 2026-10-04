import { sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { notifications, patients } from '@/db/schema';
import { dispararEnvio, emHorarioSilencioso, fimDoSilencio } from '@/modules/notificacoes/agendar';
import { naAudiencia } from './audiencia';
import type { Visibilidade } from './constantes';

/** US-053: "no máximo 1 push de conteúdo por paciente a cada 24 h". */
export const JANELA_AVISO_MS = 24 * 3_600_000;

/**
 * US-053 "Aviso de novo conteúdo" (D4, D5), na transação da publicação: um push `conteudo_novo` (texto neutro, motor do
 * Plano 05) para cada paciente ativo, não anonimizado, com conta no portal, na audiência AGORA e sem outro
 * `conteudo_novo` criado nas 24 h anteriores — os demais conteúdos ficam no feed com "Novo". Um INSERT … SELECT só,
 * serializado por tenant (duas publicações ao mesmo tempo não avisam a mesma pessoa duas vezes). No horário
 * silencioso (21h–8h no fuso do tenant) a linha sai às 08:00 pela varredura; fora dele, o envio é disparado já.
 * Devolve quantos pacientes serão avisados.
 */
export async function avisarConteudoNovo(tx: Tx, o: { tenantId: string; contentId: string; visibilidade: Visibilidade; fuso: string }, agora: Date): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('conteudo_novo'), hashtext(${o.tenantId}))`);
  const quando = emHorarioSilencioso(agora, o.fuso) ? fimDoSilencio(agora, o.fuso) : agora;
  const desde = new Date(agora.getTime() - JANELA_AVISO_MS);
  const r = await tx.execute(sql`
    insert into ${notifications} (tenant_id, patient_id, canal, tipo, agendada_para, created_at, updated_at)
    select ${patients.tenantId}, ${patients.id}, 'push', 'conteudo_novo', ${quando.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz
      from ${patients}
     where ${patients.tenantId} = ${o.tenantId}
       and ${patients.userId} is not null
       and ${naAudiencia(o.contentId, o.visibilidade)}
       and not exists (
         select 1 from ${notifications} n
          where n.tenant_id = ${patients.tenantId} and n.patient_id = ${patients.id}
            and n.tipo = 'conteudo_novo' and n.created_at > ${desde.toISOString()}::timestamptz)`);
  const avisados = r.rowCount ?? 0;
  if (avisados && quando.getTime() === agora.getTime()) await dispararEnvio(tx, o.tenantId);
  return avisados;
}
