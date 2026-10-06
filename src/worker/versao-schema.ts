import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { logger, nomeDoErro } from '@/lib/logger';

/** P09-02 (a) / spec §9.7: quanto o worker espera o app aplicar as migrations (o heartbeat tolera 10 min). */
export const PRAZO_SCHEMA_MS = 5 * 60_000;
export const INTERVALO_SCHEMA_MS = 3_000;

export type VersaoEsperada = { when: number; tag: string };

export class SchemaAtrasadoError extends Error {
  override name = 'SchemaAtrasadoError';
}

/** A última migration do journal que veio com este código (a pasta `drizzle/` é copiada na imagem, Dockerfile). */
export function versaoEsperada(pasta: string = path.join(process.cwd(), 'drizzle')): VersaoEsperada {
  const journal = JSON.parse(readFileSync(path.join(pasta, 'meta', '_journal.json'), 'utf8')) as { entries: VersaoEsperada[] };
  const ultima = journal.entries.at(-1);
  if (!ultima) throw new Error('journal de migrations vazio');
  return { when: ultima.when, tag: ultima.tag };
}

/** O `when` da última migration aplicada, pela função da 0094 (o role da aplicação não lê o schema `drizzle`). */
export async function versaoAplicada(db: Db): Promise<number | null> {
  const r = await db.execute<{ v: string | number | null }>(sql`select app_versao_do_schema() as v`);
  const v = r.rows[0]?.v;
  return v === null || v === undefined ? null : Number(v);
}

/** SQLSTATE (5 caracteres) de um erro do Postgres — nunca a mensagem, que pode citar SQL e parâmetros (regra 3). */
const sqlstate = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c) ? c : undefined;
};

/**
 * O deploy dispara app e worker juntos e as migrations rodam no boot do app (`docker-entrypoint.sh`): o worker novo pode
 * subir antes delas. Nada de consumidor antes de o banco ter, no mínimo, a última migration deste código. Erro na leitura
 * (função ainda inexistente, banco fora) conta como "ainda não". Passou do prazo: lança — o processo sai com erro e o
 * Swarm o reinicia, conferindo de novo.
 */
export async function esperarVersaoDoSchema(deps: {
  esperada: VersaoEsperada;
  aplicada: () => Promise<number | null>;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  prazoMs?: number;
  intervaloMs?: number;
}): Promise<void> {
  const agora = deps.agora ?? Date.now;
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limite = agora() + (deps.prazoMs ?? PRAZO_SCHEMA_MS);
  let esperou = false;
  for (;;) {
    let aplicada: number | null = null;
    let falha: { erro: string; sqlstate: string | undefined } | undefined;
    try {
      aplicada = await deps.aplicada();
    } catch (e) {
      falha = { erro: nomeDoErro(e), sqlstate: sqlstate(e) };
    }
    if (aplicada !== null && aplicada >= deps.esperada.when) {
      if (esperou) logger.info({ migration: deps.esperada.tag }, 'schema do banco em dia; worker seguindo');
      return;
    }
    if (agora() >= limite) {
      logger.error({ migration: deps.esperada.tag, ...falha }, 'schema do banco atrás do worker: o app não aplicou as migrations a tempo');
      throw new SchemaAtrasadoError(`schema do banco atrás do worker (esperada ${deps.esperada.tag})`);
    }
    if (!esperou) logger.warn({ migration: deps.esperada.tag, ...falha }, 'esperando o app aplicar as migrations');
    esperou = true;
    await dormir(deps.intervaloMs ?? INTERVALO_SCHEMA_MS);
  }
}
