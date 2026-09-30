import { PgBoss, type JobWithMetadata } from 'pg-boss';
import { closeDb, getDb } from '@/db/client';
import { processEmailJob } from '@/email/job';
import { enqueueEmail } from '@/email/queue';
import { transportFromEnv } from '@/email/transport';
import type { EmailJobData } from '@/email/types';
import { getWorkerEnv, type WorkerEnv } from '@/env';
import { useBoss } from '@/jobs/boss';
import { ensureQueues } from '@/jobs/queues';
import { logger } from '@/lib/logger';
import {
  expirarExportacao,
  expirarExportacoesVencidas,
  gerarExportacao,
} from '@/modules/pacientes/exportacao-job';
import { anonimizarVencidos } from '@/modules/pacientes/lgpd';
import {
  avisarAdmins,
  statfsDoDiretorio,
  verificarBackups,
  verificarDisco,
} from '@/modules/plataforma/monitoramento';
import { tenantIsActive } from '@/modules/plataforma/tenant-status';
import { recordHeartbeat } from './heartbeat';

export async function startWorker(env: WorkerEnv): Promise<() => Promise<void>> {
  // createSchema: false — ver Plano 01, Tarefa 10 (o schema pgboss é do role da aplicação)
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss',
    createSchema: false,
  });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss erro'));
  await boss.start();
  await ensureQueues(boss);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- não é hook do React: registra a instância do pg-boss
  useBoss(boss); // envios feitos dentro do worker usam esta instância

  await boss.schedule('heartbeat', '* * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('heartbeat', async () => {
    await recordHeartbeat(getDb());
  });

  const transport = transportFromEnv(env);
  await boss.work<EmailJobData>('email', async ([job]) => {
    await processEmailJob(job.data, job.id, {
      transport,
      from: env.EMAIL_FROM,
      tenantAtivo: (tenantId) => tenantIsActive(getDb(), tenantId),
    });
  });

  const painelUrl = `${env.APP_URL.replace(/\/$/, '')}/admin`;
  // F5: todos os e-mails de um alerta numa só transação (com a instância do worker)
  const paraAdmins = (
    montar: (para: string) => Parameters<typeof enqueueEmail>[0],
    aposEnfileirar?: Parameters<typeof avisarAdmins>[3],
  ) => avisarAdmins(getDb(), montar, (msg, tx) => enqueueEmail(msg, { tx, boss }), aposEnfileirar);
  // RNF-05: o backup roda no host às 03h; às 07h o worker confere se ele aconteceu
  await boss.schedule('monitor-backup', '0 7 * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('monitor-backup', async () => {
    await verificarBackups({
      db: getDb(),
      now: new Date(),
      avisar: (detalhe) =>
        paraAdmins((para) => ({ tipo: 'alerta_backup', para, detalhe, painelUrl })),
    });
  });
  // RNF-13: disco da VPS (o volume /data está no disco do host)
  await boss.schedule('monitor-disco', '0 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('monitor-disco', async () => {
    await verificarDisco({
      db: getDb(),
      now: new Date(),
      statfs: () => statfsDoDiretorio(env.DATA_DIR),
      avisar: (percentual, marcar) =>
        paraAdmins((para) => ({ tipo: 'alerta_disco', para, percentual, painelUrl }), marcar),
    });
  });

  // US-018: fim do prazo de guarda — anonimiza os bloqueados vencidos e apaga os anexos
  await boss.schedule('retencao-lgpd', '0 4 * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('retencao-lgpd', async () => {
    // Uma etapa com erro não impede a outra; o erro volta ao pg-boss (nova tentativa) depois das duas
    try {
      const r = await anonimizarVencidos(getDb(), new Date(), { dataDir: env.DATA_DIR });
      logger.info({ anonimizados: r.anonimizados }, 'retenção LGPD concluída');
    } finally {
      const x = await expirarExportacoesVencidas(getDb(), new Date(), { dataDir: env.DATA_DIR });
      logger.info({ expiradas: x.expiradas }, 'exportações vencidas apagadas');
    }
  });

  // US-018: exportação do paciente (ZIP com JSON + PDF) e expiração do link em 24 h
  await boss.work(
    'exportacao-paciente',
    { includeMetadata: true },
    async ([job]: JobWithMetadata<{ tenantId: string; exportId: string }>[]) => {
      await gerarExportacao(job.data, {
        db: getDb(),
        dataDir: env.DATA_DIR,
        appUrl: env.APP_URL,
        boss,
        ultimaTentativa: job.retryCount >= job.retryLimit,
      });
    },
  );
  await boss.work<{ tenantId: string; exportId: string }>('expirar-exportacao', async ([job]) => {
    await expirarExportacao(job.data, { db: getDb(), dataDir: env.DATA_DIR });
  });

  await recordHeartbeat(getDb()); // batida imediata ao subir
  logger.info('worker iniciado');

  let parando: Promise<void> | undefined;
  // Idempotente: SIGTERM seguido de SIGINT não para o pg-boss duas vezes (item adiado do Plano 01)
  return () =>
    (parando ??= (async () => {
      await boss.stop({ graceful: true, timeout: 30_000 });
      await closeDb();
    })());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = getWorkerEnv(); // falha rápido se faltar configuração
  const stop = await startWorker(env);
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'encerrando worker');
    await stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
