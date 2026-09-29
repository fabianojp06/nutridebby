import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { Db, Queryable, Tx } from '@/db/client';
import { systemHeartbeat, user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import type { EmailMessage } from '@/email/types';
import { logger } from '@/lib/logger';

export const BACKUP_JANELA_MS = 26 * 60 * 60 * 1000; // backup às 03h + folga
export const DISCO_LIMITE = 70; // RNF-13
const ALERTA_DISCO_INTERVALO_MS = 24 * 60 * 60 * 1000;
const TIPOS = ['arquivos', 'banco'] as const;

export type StatFsLike = { blocks: number; bfree: number; bavail: number };

/** Uso do disco com a mesma conta do `df` (blocos reservados ao root não contam como livres). */
export function percentualDisco(s: StatFsLike): number {
  const usados = s.blocks - s.bfree;
  const total = usados + s.bavail;
  return total > 0 ? Math.ceil((usados * 100) / total) : 0; // df arredonda para cima
}

/**
 * Mede o disco onde `dir` ficará. Se a pasta ainda não existe (DATA_DIR antes do primeiro upload),
 * mede o ancestral existente mais próximo, que está no mesmo volume.
 */
export async function statfsDoDiretorio(
  dir: string,
  medir: (p: string) => Promise<StatFsLike> = statfs,
): Promise<StatFsLike> {
  let atual = path.resolve(dir);
  for (;;) {
    try {
      return await medir(atual);
    } catch (err) {
      const pai = path.dirname(atual);
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || pai === atual) throw err;
      atual = pai;
    }
  }
}

export type UltimoBackup = { tipo: (typeof TIPOS)[number]; ok: boolean; concluidoEm: Date; bytes: number | null };

/** Última execução de cada tipo (ok ou falha) concluída até `now`. */
export async function ultimosBackups(db: Db, now: Date = new Date()): Promise<UltimoBackup[]> {
  const r = await db.execute<{ tipo: UltimoBackup['tipo']; ok: boolean; concluido_em: Date; bytes: string | null }>(sql`
    select distinct on (tipo) tipo, ok, concluido_em, bytes
      from backup_runs where concluido_em <= ${now}
     order by tipo, concluido_em desc, id desc`);
  return r.rows.map((x) => ({ tipo: x.tipo, ok: x.ok, concluidoEm: new Date(x.concluido_em), bytes: x.bytes === null ? null : Number(x.bytes) }));
}

/**
 * Tipos com problema: sem execução nas últimas 26 h ou cuja última execução falhou
 * (qualquer etapa com ok=false, inclusive a retenção). Em ordem alfabética.
 */
export async function backupsFaltando(db: Db, now: Date): Promise<string[]> {
  const desde = now.getTime() - BACKUP_JANELA_MS;
  const ultimos = await ultimosBackups(db, now);
  return TIPOS.filter((t) => {
    const u = ultimos.find((x) => x.tipo === t);
    return !u || !u.ok || u.concluidoEm.getTime() <= desde;
  });
}

/** Tabela `user` sem contexto de tenant: exceção listada na regra 1 do CLAUDE.md (destinatários dos alertas, F4). */
export async function emailsDosAdmins(db: Queryable): Promise<string[]> {
  return (await db.select({ email: user.email }).from(user).where(eq(user.appRole, 'admin'))).map((u) => u.email);
}

/**
 * Um e-mail por admin, todos na MESMA transação (F5): se um enfileiramento falhar, nenhum fica
 * na fila e a nova tentativa do job não duplica os que já tinham ido. Devolve quantos enfileirou
 * (0 = nenhum admin cadastrado).
 */
export async function avisarAdmins(
  db: Db,
  montar: (para: string) => EmailMessage,
  enfileirar: (msg: EmailMessage, tx: Tx) => Promise<unknown> = (msg, tx) => enqueueEmail(msg, { tx }),
): Promise<number> {
  const n = await db.transaction(async (tx) => {
    const admins = await emailsDosAdmins(tx);
    for (const para of admins) await enfileirar(montar(para), tx);
    return admins.length;
  });
  if (n === 0) logger.warn('alerta de monitoramento sem destinatário: nenhum admin cadastrado');
  return n;
}

/** O detalhe do e-mail só cita os tipos; o texto de `backup_runs.detalhe` nunca sai do banco. */
export async function verificarBackups(deps: { db: Db; now: Date; avisar: (detalhe: string) => Promise<number> }): Promise<{ faltando: string[] }> {
  const faltando = await backupsFaltando(deps.db, deps.now);
  if (faltando.length) await deps.avisar(`sem backup concluído com sucesso nas últimas 26 horas: ${faltando.join(' e ')}`);
  return { faltando };
}

/** RNF-13: alerta ao admin com o disco em 70% — no máximo 1 e-mail a cada 24 h. */
export async function verificarDisco(deps: {
  db: Db;
  now: Date;
  statfs: () => Promise<StatFsLike>;
  /** Devolve quantos e-mails enfileirou. */
  avisar: (percentual: number) => Promise<number>;
}): Promise<{ percentual: number; alertou: boolean }> {
  const percentual = percentualDisco(await deps.statfs());
  if (percentual < DISCO_LIMITE) return { percentual, alertou: false };
  const [ultimo] = await deps.db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'alerta_disco'));
  if (ultimo && deps.now.getTime() - ultimo.beatAt.getTime() < ALERTA_DISCO_INTERVALO_MS) return { percentual, alertou: false };
  // F6: sem destinatário não grava a marca — senão o alerta ficaria suprimido por 24 h
  if ((await deps.avisar(percentual)) === 0) return { percentual, alertou: false };
  await deps.db
    .insert(systemHeartbeat)
    .values({ name: 'alerta_disco', beatAt: deps.now })
    .onConflictDoUpdate({ target: systemHeartbeat.name, set: { beatAt: deps.now } });
  return { percentual, alertou: true };
}
