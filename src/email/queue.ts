import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Tx } from '@/db/client';
import { getBoss } from '@/jobs/boss';
import { sealSecret } from '@/lib/crypto';
import type { EmailJobData, EmailMessage } from './types';

export const EMAIL_FINALIDADE = 'email-job';

/**
 * Enfileira um e-mail (o worker envia). Com `tx`, o job só existe se a transação do negócio
 * for confirmada (ex.: conta criada ⇔ convite enfileirado).
 */
export async function enqueueEmail(
  msg: EmailMessage,
  opts: { tenantId?: string | null; tx?: Tx; boss?: PgBoss } = {},
): Promise<string> {
  const boss = opts.boss ?? (await getBoss());
  const data: EmailJobData = { tenantId: opts.tenantId ?? null, selado: sealSecret(JSON.stringify(msg), EMAIL_FINALIDADE) };
  const id = await boss.send('email', data, opts.tx ? { db: fromDrizzle(opts.tx, sql) } : undefined);
  if (!id) throw new Error('A fila de e-mail recusou o envio');
  return id;
}
