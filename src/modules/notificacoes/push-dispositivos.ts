import { inArray } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { pushSubscriptions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger, nomeDoErro } from '@/lib/logger';
import type { InscricaoPush, ProvedorPush, ResultadoPush } from './push';

/*
 * INT-03 (D14, D19): o envio de um push a todos os dispositivos de um vínculo — o laço de `enviarPush` (enviar.ts),
 * sem o contexto da notificação, para os lembretes de rotina (Plano 17, Tarefa 4) usarem o mesmo caminho. Só no worker
 * (R1: nenhuma rota do Next alcança este arquivo — guarda em push.test.ts).
 */

/**
 * D6 (no máximo uma vez): `enviada` = algum dispositivo recebeu; `incerta` = nenhum recebeu, mas algum pode ter recebido
 * (timeout, conexão caída depois de enviar, exceção do provedor) — nunca repete; `passageira` = nenhum recebeu, nenhum
 * incerto e alguma falha pode passar; `definitiva` = só falhas que não passam; `sem_inscricao` = todas mortas (404/410).
 */
export type ResultadoAoPaciente = 'enviada' | 'sem_inscricao' | 'incerta' | 'passageira' | 'definitiva';
export type InscricaoComId = InscricaoPush & { id: string };

/** As inscrições de push dos pacientes (do tenant do `tx`, pela RLS), agrupadas por paciente. Sem inscrição, o paciente fica fora do mapa. */
export async function inscricoesDosPacientes(tx: Tx, patientIds: string[]): Promise<Map<string, InscricaoComId[]>> {
  const porPaciente = new Map<string, InscricaoComId[]>();
  if (!patientIds.length) return porPaciente;
  const linhas = await tx
    .select({ patientId: pushSubscriptions.patientId, id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.patientId, patientIds));
  for (const { patientId, ...i } of linhas) {
    const lista = porPaciente.get(patientId);
    if (lista) lista.push(i);
    else porPaciente.set(patientId, [i]);
  }
  return porPaciente;
}

/**
 * Envia `payload` a todas as `inscricoes` (lidas numa transação já fechada: uma conexão por transação). As mortas ou
 * inválidas (404/410, endereço recusado, chaves que não cifram) são apagadas depois, numa transação curta aberta só
 * quando há alguma; a falha dessa limpeza só vai para o log (a mensagem já pode ter saído; a próxima limpa).
 * `logCtx` entra nos avisos ao lado do `tenantId` e do nome do erro — nunca endpoint, chave nem payload (RNF-11).
 */
export async function enviarAosDispositivos(a: {
  db: Db;
  tenantId: string;
  inscricoes: InscricaoComId[];
  push: ProvedorPush;
  payload: string;
  ttlS: number;
  logCtx: Record<string, string>;
}): Promise<{ resultado: ResultadoAoPaciente; codigo: string | null }> {
  let entregues = 0;
  let incerta: string | null = null;
  let passageira: string | null = null;
  let definitiva: string | null = null;
  const mortas: string[] = [];
  for (const i of a.inscricoes) {
    const r = await enviarAoDispositivo(a, i);
    if (r.ok) entregues++;
    else if (r.remover) mortas.push(i.id);
    else if (r.incerto) incerta ??= r.codigo;
    else if (r.definitivo) definitiva ??= r.codigo;
    else passageira ??= r.codigo;
  }
  if (mortas.length) {
    try {
      await withTenant({ tenantId: a.tenantId, role: 'worker' }, (tx) => tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, mortas)), a.db);
    } catch (err) {
      // a mensagem já pode ter saído para outro dispositivo: a falha da limpeza não vira nova tentativa (D6); a próxima limpa
      logger.warn({ tenantId: a.tenantId, ...a.logCtx, err: nomeDoErro(err) }, 'falha ao apagar inscrições de push');
    }
  }
  if (entregues) return { resultado: 'enviada', codigo: null };
  if (incerta) return { resultado: 'incerta', codigo: incerta };
  if (passageira) return { resultado: 'passageira', codigo: passageira };
  if (definitiva) return { resultado: 'definitiva', codigo: definitiva };
  return { resultado: 'sem_inscricao', codigo: null }; // todas mortas (404/410)
}

/** O provedor devolve as falhas como resultado; se lançar, não se sabe se saiu: não repete (D6), como o WhatsApp. */
async function enviarAoDispositivo(a: { tenantId: string; push: ProvedorPush; payload: string; ttlS: number; logCtx: Record<string, string> }, i: InscricaoPush): Promise<ResultadoPush> {
  try {
    return await a.push.enviar(i, a.payload, a.ttlS);
  } catch (err) {
    // RNF-11: só o nome do erro — a mensagem pode trazer o endpoint do dispositivo
    logger.warn({ tenantId: a.tenantId, ...a.logCtx, err: nomeDoErro(err) }, 'falha no provedor de push');
    return { ok: false, remover: false, definitivo: true, incerto: true, codigo: 'sem_resposta' };
  }
}
