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
import { encerrarSentry, iniciarSentry } from '@/lib/sentry';
import { limparPedidosPublicos } from '@/modules/agenda/agendamento-publico';
import { limparLimites } from '@/modules/agenda/limite-ip';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import { montarPdfDigitalizado } from '@/modules/documentos/digitalizada-job';
import { expirarPdfsDeDocumentoPendentes, gerarPdfDoDocumento, limparArquivosOrfaosDeDocumentos } from '@/modules/documentos/documento-pdf-job';
import { limparCodigosDeDocumentoVencidos } from '@/modules/documentos/link-documento';
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
import { anonimizarVencidos, concluirExclusaoAtendida, type DadosExclusaoAtendida } from '@/modules/pacientes/lgpd';
import { limparTmpOrfaos } from '@/modules/plataforma/armazenamento';
import {
  avisarAdmins,
  statfsDoDiretorio,
  verificarBackups,
  verificarDisco,
} from '@/modules/plataforma/monitoramento';
import { tenantIsActive } from '@/modules/plataforma/tenant-status';
import { expirarPdfsPendentes, gerarPdfDoPlano } from '@/modules/plano-alimentar/plano-pdf-job';
import { limparAcessosAntigos } from '@/modules/portal/acesso';
import { converterFotoDoDiario, expirarFotosPendentes, type DadosFotoDiario } from '@/modules/portal/diario-foto-job';
import { recordHeartbeat } from './heartbeat';
import { workSemDetalhe } from './sem-detalhe';
import { rodarComSinais } from './sinais';
import { esperarVersaoDoSchema, versaoAplicada, versaoEsperada } from './versao-schema';
import { urlDoApp } from '@/lib/url-do-app';

export async function startWorker(env: WorkerEnv, sinal?: AbortSignal): Promise<() => Promise<void>> {
  iniciarSentry({ dsn: env.SENTRY_DSN, ambiente: env.SENTRY_ENVIRONMENT ?? 'producao', papel: 'worker' });
  // P09-02 (a) / spec §9.7: o deploy sobe app e worker juntos e as migrations rodam no boot do app. Nenhum consumidor nem
  // agendamento antes de o banco ter a última migration deste código (espera até PRAZO_SCHEMA_MS; depois sai com erro).
  // O sinal de encerramento corta a espera (code review do PR #22, item 4: rodarComSinais).
  await esperarVersaoDoSchema({ esperada: versaoEsperada(), aplicada: () => versaoAplicada(getDb()), sinal });
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
  // RNF-11 / regra 3: todo job registra por aqui — o erro relançado ao pg-boss (output do job) leva só a fila e o código
  const work = workSemDetalhe(boss);

  await boss.schedule('heartbeat', '* * * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('heartbeat', async () => {
    await recordHeartbeat(getDb());
  });

  const transport = transportFromEnv(env);
  await work<EmailJobData>('email', async ([job]) => {
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
  await work<{ tenantId?: string }>('notificacoes', async ([job]) => {
    await processarNotificacoes(depsEnvio, { tenantId: job.data?.tenantId });
  });
  // US-004: o admin suspende/reativa e só enfileira; aqui o worker troca os lembretes dentro do withTenant
  await work<{ tenantId: string; evento: 'suspenso' | 'reativado' }>('agenda-tenant', async ([job]) => {
    if (job.data.evento === 'suspenso') await ignorarPendentesDoTenant(getDb(), job.data.tenantId, new Date());
    else await reagendarTenantReativado(getDb(), job.data.tenantId, new Date());
  });

  // INT-01/D5: eventos do webhook do WhatsApp (conexão, status de entrega, resposta "1"/"2"), já reduzidos e cifrados pela rota
  // (revisão 1 da T12: ERROR antes de o envio gravar o id volta para a fila; na última tentativa, desiste em silêncio)
  await work('whatsapp-evento', { includeMetadata: true }, async ([job]: JobWithMetadata<{ selado: string }>[]) => {
    const ev = JSON.parse(openSecret(job.data.selado, FINALIDADE_EVENTO)) as EventoWhatsapp;
    await processarEventoWhatsapp(ev, { db: getDb(), appUrl: env.APP_URL, ultimaTentativa: job.retryCount >= job.retryLimit });
  });

  // RN-16 / LGPD (minimização): pedidos da página pública (contato e código) somem em 24 h; contadores de limite, em 1 dia
  await boss.schedule('agenda-limpeza', '30 4 * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('agenda-limpeza', async () => {
    const pedidos = await limparPedidosPublicos(getDb(), new Date());
    const limites = await limparLimites(getDb(), new Date());
    const acessos = await limparAcessosAntigos(getDb(), new Date()); // D13: retenção dos acessos ao portal
    const codigos = await limparCodigosDeDocumentoVencidos(getDb(), new Date()); // RN-158 / §10: códigos do link do documento
    logger.info({ pedidos, limites, acessos, codigos }, 'limpeza da agenda pública');
  });

  const painelUrl = urlDoApp(env.APP_URL, '/admin');
  // F5: todos os e-mails de um alerta numa só transação (com a instância do worker)
  const paraAdmins = (
    montar: (para: string) => Parameters<typeof enqueueEmail>[0],
    aposEnfileirar?: Parameters<typeof avisarAdmins>[3],
  ) => avisarAdmins(getDb(), montar, (msg, tx) => enqueueEmail(msg, { tx, boss }), aposEnfileirar);
  // RNF-05: o backup roda no host às 03h; às 07h o worker confere se ele aconteceu
  await boss.schedule('monitor-backup', '0 7 * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('monitor-backup', async () => {
    await verificarBackups({
      db: getDb(),
      now: new Date(),
      avisar: (detalhe) =>
        paraAdmins((para) => ({ tipo: 'alerta_backup', para, detalhe, painelUrl })),
    });
  });
  // RNF-13: disco da VPS (o volume /data está no disco do host)
  await boss.schedule('monitor-disco', '0 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('monitor-disco', async () => {
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
  await work('retencao-lgpd', async () => {
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
  await work(
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
  await work<{ tenantId: string; exportId: string }>('expirar-exportacao', async ([job]) => {
    await expirarExportacao(job.data, { db: getDb(), dataDir: env.DATA_DIR });
  });
  // US-018 / F-13: fotos do diário apagadas e, só depois, o e-mail "pedido de exclusão atendido"
  await work('exclusao-atendida', { includeMetadata: true }, async ([job]: JobWithMetadata<DadosExclusaoAtendida>[]) => {
    await concluirExclusaoAtendida(job.data, { db: getDb(), dataDir: env.DATA_DIR, boss, ultimaTentativa: job.retryCount >= job.retryLimit });
  });

  // US-026: PDF do plano alimentar na publicação (≤ 30 s) e limpeza diária dos .tmp órfãos de /data
  await work(
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
  await work('diario-foto', { includeMetadata: true }, async ([job]: JobWithMetadata<DadosFotoDiario>[]) => {
    await converterFotoDoDiario(job.data, { db: getDb(), dataDir: env.DATA_DIR, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
  await boss.schedule('expirar-diario-foto', '*/15 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('expirar-diario-foto', async () => {
    await expirarFotosPendentes({ db: getDb(), dataDir: env.DATA_DIR, boss }, new Date());
  });
  await boss.schedule('expirar-plano-pdf', '*/15 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('expirar-plano-pdf', async () => {
    await expirarPdfsPendentes(getDb(), new Date());
  });
  // Plano 10A (US-143): PDF preparado da receita; a cada 15 min, pendente esquecido (PDF ou digitalização) → falhou e PDF base/fotos órfãos apagados
  await work('documento-pdf', { includeMetadata: true }, async ([job]: JobWithMetadata<{ tenantId: string; documentoId: string }>[]) => {
    await gerarPdfDoDocumento(job.data, { db: getDb(), dataDir: env.DATA_DIR, appUrl: env.APP_URL, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
  // RN-157 (D4): o PDF novo com as fotos da digitalizada, assinado como "digitalizada" (foto ilegível ou cota: falha já)
  await work('documento-digitalizado', { includeMetadata: true }, async ([job]: JobWithMetadata<{ tenantId: string; documentoId: string; userId: string }>[]) => {
    await montarPdfDigitalizado(job.data, { db: getDb(), dataDir: env.DATA_DIR, appUrl: env.APP_URL, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
  await boss.schedule('expirar-documento-pdf', '*/15 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('expirar-documento-pdf', async () => {
    await expirarPdfsDeDocumentoPendentes(getDb(), new Date());
    await limparArquivosOrfaosDeDocumentos(getDb(), new Date(), env.DATA_DIR);
  });
  await boss.schedule('limpar-tmp', '0 4 * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('limpar-tmp', async () => {
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
      await encerrarSentry();
      await closeDb();
    })());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = getWorkerEnv(); // falha rápido se faltar configuração
  // item 4 do code review do PR #22: SIGTERM/SIGINT ouvidos antes da espera pelo schema (sinais.ts)
  await rodarComSinais({
    iniciar: (sinal) => startWorker(env, sinal),
    fechar: async () => {
      await encerrarSentry();
      await closeDb();
    },
  });
}
