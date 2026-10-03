import { PgBoss, type JobWithMetadata } from 'pg-boss';
import { closeDb, getDb } from '@/db/client';
import { processEmailJob } from '@/email/job';
import { enqueueEmail } from '@/email/queue';
import { transportFromEnv } from '@/email/transport';
import type { EmailJobData } from '@/email/types';
import { getWorkerEnv, type WorkerEnv } from '@/env';
import { useBoss } from '@/jobs/boss';
import { ensureQueues } from '@/jobs/queues';
import { encryptionKey, openSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { limparPedidosPublicos } from '@/modules/agenda/agendamento-publico';
import { limparLimites } from '@/modules/agenda/limite-ip';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import { ignorarPendentesDoTenant, reagendarTenantReativado } from '@/modules/notificacoes/agendar';
import { processarNotificacoes, type DepsEnvio } from '@/modules/notificacoes/enviar';
import { pushDoAmbiente } from '@/modules/notificacoes/push';
import { provedorDoAmbiente } from '@/modules/notificacoes/whatsapp/ambiente';
import { FINALIDADE_EVENTO, processarEventoWhatsapp, type EventoWhatsapp } from '@/modules/notificacoes/whatsapp/webhook';
import {
  expirarExportacao,
  expirarExportacoesVencidas,
  gerarExportacao,
} from '@/modules/pacientes/exportacao-job';
import { anonimizarVencidos } from '@/modules/pacientes/lgpd';
import { limparTmpOrfaos } from '@/modules/plataforma/armazenamento';
import {
  avisarAdmins,
  statfsDoDiretorio,
  verificarBackups,
  verificarDisco,
} from '@/modules/plataforma/monitoramento';
import { tenantIsActive } from '@/modules/plataforma/tenant-status';
import { expirarPdfsPendentes, gerarPdfDoPlano } from '@/modules/plano-alimentar/plano-pdf-job';
import { converterFotoDoDiario, type DadosFotoDiario } from '@/modules/portal/diario-foto-job';
import { recordHeartbeat } from './heartbeat';
import { urlDoApp } from '@/lib/url-do-app';

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

  // RN-05 / D6: motor de lembretes. Cron de 1 min para todos os tenants; `{ tenantId }` = envio imediato de um tenant
  const depsEnvio: DepsEnvio = {
    db: getDb(),
    agora: () => new Date(),
    appUrl: env.APP_URL,
    chaveLinks: chaveDosLinks(encryptionKey()),
    email: { transport, from: env.EMAIL_FROM },
    whatsapp: provedorDoAmbiente(env),
    push: pushDoAmbiente(env), // INT-03 / D19: web-push só aqui no worker (R1)
  };
  logger.info({ whatsapp: depsEnvio.whatsapp?.nome ?? 'desligado' }, 'canal de WhatsApp'); // só o modo: nunca URL nem chave
  logger.info({ push: depsEnvio.push ? 'ligado' : 'desligado' }, 'canal de push'); // nunca as chaves do VAPID
  // D16 (fila serial): um job de `notificacoes` por vez neste worker (padrão do boss.work: localConcurrency 1)
  await boss.schedule('notificacoes', '* * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work<{ tenantId?: string }>('notificacoes', async ([job]) => {
    await processarNotificacoes(depsEnvio, { tenantId: job.data?.tenantId });
  });
  // US-004: o admin suspende/reativa e só enfileira; aqui o worker troca os lembretes dentro do withTenant
  await boss.work<{ tenantId: string; evento: 'suspenso' | 'reativado' }>('agenda-tenant', async ([job]) => {
    if (job.data.evento === 'suspenso') await ignorarPendentesDoTenant(getDb(), job.data.tenantId, new Date());
    else await reagendarTenantReativado(getDb(), job.data.tenantId, new Date());
  });

  // INT-01/D5: eventos do webhook do WhatsApp (conexão, status de entrega, resposta "1"/"2"), já reduzidos e cifrados pela rota
  // (revisão 1 da T12: ERROR antes de o envio gravar o id volta para a fila; na última tentativa, desiste em silêncio)
  await boss.work('whatsapp-evento', { includeMetadata: true }, async ([job]: JobWithMetadata<{ selado: string }>[]) => {
    const ev = JSON.parse(openSecret(job.data.selado, FINALIDADE_EVENTO)) as EventoWhatsapp;
    await processarEventoWhatsapp(ev, { db: getDb(), appUrl: env.APP_URL, ultimaTentativa: job.retryCount >= job.retryLimit });
  });

  // RN-16 / LGPD (minimização): pedidos da página pública (contato e código) somem em 24 h; contadores de limite, em 1 dia
  await boss.schedule('agenda-limpeza', '30 4 * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('agenda-limpeza', async () => {
    const pedidos = await limparPedidosPublicos(getDb(), new Date());
    const limites = await limparLimites(getDb(), new Date());
    logger.info({ pedidos, limites }, 'limpeza da agenda pública');
  });

  const painelUrl = urlDoApp(env.APP_URL, '/admin');
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

  // US-026: PDF do plano alimentar na publicação (≤ 30 s) e limpeza diária dos .tmp órfãos de /data
  await boss.work(
    'plano-pdf',
    { includeMetadata: true },
    async ([job]: JobWithMetadata<{ tenantId: string; planId: string }>[]) => {
      await gerarPdfDoPlano(job.data, {
        db: getDb(),
        dataDir: env.DATA_DIR,
        ultimaTentativa: job.retryCount >= job.retryLimit,
      });
    },
  );
  // US-042 / RN-07: foto do diário convertida no worker (sharp + heic-decode)
  await boss.work('diario-foto', { includeMetadata: true }, async ([job]: JobWithMetadata<DadosFotoDiario>[]) => {
    await converterFotoDoDiario(job.data, { db: getDb(), dataDir: env.DATA_DIR, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
  await boss.schedule('expirar-plano-pdf', '*/15 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('expirar-plano-pdf', async () => {
    await expirarPdfsPendentes(getDb(), new Date());
  });
  await boss.schedule('limpar-tmp', '0 4 * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('limpar-tmp', async () => {
    const n = await limparTmpOrfaos(env.DATA_DIR, new Date());
    if (n) logger.info({ apagados: n }, 'arquivos .tmp órfãos removidos');
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
