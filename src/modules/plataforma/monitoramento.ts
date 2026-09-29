import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { systemHeartbeat, user } from '@/db/schema';

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

export async function emailsDosAdmins(db: Db): Promise<string[]> {
  return (await db.select({ email: user.email }).from(user).where(eq(user.appRole, 'admin'))).map((u) => u.email);
}

/** O detalhe do e-mail só cita os tipos; o texto de `backup_runs.detalhe` nunca sai do banco. */
export async function verificarBackups(deps: { db: Db; now: Date; avisar: (detalhe: string) => Promise<void> }): Promise<{ faltando: string[] }> {
  const faltando = await backupsFaltando(deps.db, deps.now);
  if (faltando.length) await deps.avisar(`sem backup concluído com sucesso nas últimas 26 horas: ${faltando.join(' e ')}`);
  return { faltando };
}

/** RNF-13: alerta ao admin com o disco em 70% — no máximo 1 e-mail a cada 24 h. */
export async function verificarDisco(deps: {
  db: Db;
  now: Date;
  statfs: () => Promise<StatFsLike>;
  avisar: (percentual: number) => Promise<void>;
}): Promise<{ percentual: number; alertou: boolean }> {
  const percentual = percentualDisco(await deps.statfs());
  if (percentual < DISCO_LIMITE) return { percentual, alertou: false };
  const [ultimo] = await deps.db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'alerta_disco'));
  if (ultimo && deps.now.getTime() - ultimo.beatAt.getTime() < ALERTA_DISCO_INTERVALO_MS) return { percentual, alertou: false };
  await deps.avisar(percentual);
  await deps.db
    .insert(systemHeartbeat)
    .values({ name: 'alerta_disco', beatAt: deps.now })
    .onConflictDoUpdate({ target: systemHeartbeat.name, set: { beatAt: deps.now } });
  return { percentual, alertou: true };
}
