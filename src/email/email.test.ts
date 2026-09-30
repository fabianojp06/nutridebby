import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getBoss, stopBoss } from '@/jobs/boss';
import { openSecret } from '@/lib/crypto';
import { tenantIsActive } from '@/modules/plataforma/tenant-status';
import { processEmailJob } from './job';
import { EMAIL_FINALIDADE, enqueueEmail } from './queue';
import type { EmailJobData } from './types';
import type { EmailTransport, OutgoingEmail } from './transport';

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

function fakeTransport() {
  const enviados: OutgoingEmail[] = [];
  const t: EmailTransport = { send: async (e) => void enviados.push(e) };
  return { t, enviados };
}

async function jobData(id: string): Promise<EmailJobData> {
  const [job] = await (await getBoss()).findJobs<EmailJobData>('email', { id });
  return job.data;
}

describe('fila de e-mail (INT-02)', () => {
  it('o job guarda só o tenant e a mensagem cifrada', async () => {
    const link = 'http://localhost:3000/convite/segredo-do-token';
    const id = await enqueueEmail({ tipo: 'convite_nutri', para: 'debby@exemplo.com', nome: 'Debby', link });
    const data = await jobData(id);
    expect(JSON.stringify(data)).not.toContain('segredo-do-token');
    expect(JSON.stringify(data)).not.toContain('debby@exemplo.com');
    expect(JSON.parse(openSecret(data.selado, EMAIL_FINALIDADE))).toMatchObject({ link });
  });

  it('o worker abre, renderiza e envia com a chave de idempotência do job', async () => {
    const id = await enqueueEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'http://x.dev/r/1' });
    const { t, enviados } = fakeTransport();
    const r = await processEmailJob(await jobData(id), id, { transport: t, from: 'NutriDebby <n@x.dev>', tenantAtivo: async () => true });
    expect(r).toBe('enviado');
    expect(enviados).toEqual([expect.objectContaining({ to: 'a@b.dev', subject: 'Redefinição de senha', idempotencyKey: id })]);
  });

  it('tenant suspenso: o job é concluído sem enviar (RN-15)', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `s-${randomUUID().slice(0, 8)}`, nomeExibicao: 'S', status: 'suspensa' }).returning();
    const id = await enqueueEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'http://x.dev/r/2' }, { tenantId: t.id });
    const { t: tr, enviados } = fakeTransport();
    const r = await processEmailJob(await jobData(id), id, { transport: tr, from: 'n@x.dev', tenantAtivo: (tid) => tenantIsActive(getDb(), tid) });
    expect(r).toBe('ignorado');
    expect(enviados).toHaveLength(0);
    await getDb().update(tenants).set({ status: 'ativa' }).where(eq(tenants.id, t.id));
    expect(await tenantIsActive(getDb(), t.id)).toBe(true);
  });

  it('enfileirar dentro de uma transação que é desfeita não deixa job', async () => {
    let id = '';
    await expect(
      getDb().transaction(async (tx) => {
        id = await enqueueEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'http://x.dev/r/3' }, { tx });
        throw new Error('desfaz');
      }),
    ).rejects.toThrow('desfaz');
    expect(id).not.toBe('');
    expect(await (await getBoss()).findJobs('email', { id })).toEqual([]);
  });

  it('a fila tem 3 novas tentativas com backoff exponencial', async () => {
    expect(await (await getBoss()).getQueue('email')).toMatchObject({ retryLimit: 3, retryDelay: 60, retryBackoff: true });
  });
});
