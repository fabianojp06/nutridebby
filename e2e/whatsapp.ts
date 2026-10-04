import type { APIRequestContext } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { instanciaDoTenant } from '@/modules/notificacoes/whatsapp/conexao';
import { assinarJwtWebhook, chaveDoWebhook } from '@/modules/notificacoes/whatsapp/jwt';
import { buscarTenantPorSlug } from '@/modules/plataforma/tenant-status';

// CI: as variáveis do job; local: os padrões do .env.example (o Playwright não lê o .env.local)
const SEGREDO = process.env.EVOLUTION_WEBHOOK_SECRET ?? 'dev-webhook-secret-com-pelo-menos-32-caracteres';
const BANCO = process.env.DATABASE_URL ?? 'postgres://nutri_app:dev-app@localhost:54329/nutri';

async function comBanco<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: BANCO, max: 1 });
  try {
    return await fn(drizzle({ client: pool, schema }));
  } finally {
    await pool.end();
  }
}

/** Id do consultório do E2E — pela mesma função da plataforma (CLAUDE.md regra 1: `tenants` só por src/modules/plataforma). */
export async function idDoTenant(slug: string): Promise<string> {
  const t = await comBanco((db) => buscarTenantPorSlug(db, slug));
  if (!t) throw new Error(`consultório ${slug} não existe (rode pnpm e2e:seed)`);
  return t.id;
}

/** Simula a Evolution chamando o webhook do app (sandbox do E2E): JWT HS256 com o `jwt_key` da instância do corpo (D4 a). */
export async function webhookAssinado(request: APIRequestContext, corpo: { instance: string } & Record<string, unknown>) {
  const jwt = assinarJwtWebhook(chaveDoWebhook(SEGREDO, corpo.instance), new Date());
  return request.post('/api/webhooks/whatsapp', { data: corpo, headers: { authorization: `Bearer ${jwt}` } });
}

/**
 * R7: o lembrete de 24 h por WhatsApp da consulta vence agora e o worker é chamado já (a varredura imediata do tenant,
 * a mesma do `dispararEnvio`). A linha fica como a nova tentativa de um envio que falhou de passagem (`tentativas: 1`):
 * nova tentativa não espera o fim do horário silencioso (D7) — o teste roda a qualquer hora do dia.
 */
export async function lembreteDeWhatsappAgora(tenantId: string, appointmentId: string): Promise<void> {
  const alterados = await comBanco((db) =>
    withTenant(
      { tenantId, role: 'worker' },
      (tx) =>
        tx
          .update(schema.notifications)
          .set({ status: 'pendente', motivoIgnorada: null, agendadaPara: new Date(), tentativas: 1, erro: 'indisponivel', updatedAt: new Date() })
          .where(and(eq(schema.notifications.appointmentId, appointmentId), eq(schema.notifications.canal, 'whatsapp'), eq(schema.notifications.tipo, 'lembrete_24h')))
          .returning({ id: schema.notifications.id }),
      db,
    ),
  );
  if (alterados.length !== 1) throw new Error(`a consulta deveria ter um lembrete de 24 h por WhatsApp (achei ${alterados.length})`);
  const boss = new PgBoss({ connectionString: BANCO, schema: 'pgboss', createSchema: false, migrate: false, supervise: false, schedule: false });
  await boss.start();
  try {
    if (!(await boss.send('notificacoes', { tenantId }))) throw new Error('a fila de notificações recusou o envio');
  } finally {
    await boss.stop({ graceful: false });
  }
}

/**
 * Estado da conexão do WhatsApp do consultório gravado direto (como o `conexaoDeTeste` do Vitest): o teste não depende do
 * webhook de outro teste nem dispara o e-mail de desconexão.
 */
export async function conexaoDoConsultorio(tenantId: string, estado: 'conectada' | 'desconectada'): Promise<void> {
  await comBanco((db) =>
    withTenant(
      { tenantId, role: 'worker' },
      (tx) =>
        tx
          .insert(schema.whatsappConexoes)
          .values({ tenantId, instancia: instanciaDoTenant(tenantId), estado, numeroE164: '+5511900001111', conectadaEm: new Date() })
          .onConflictDoUpdate({ target: schema.whatsappConexoes.tenantId, set: { estado, updatedAt: new Date() } }),
      db,
    ),
  );
}
