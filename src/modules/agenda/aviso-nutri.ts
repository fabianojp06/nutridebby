import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import type { EmailMessage } from '@/email/types';
import { urlDoApp } from '@/lib/url-do-app';
import { quandoComFuso } from './fuso';

export type EventoAgenda = Extract<EmailMessage, { tipo: 'aviso_agenda' }>['evento'];

/**
 * D18 / CLAUDE.md regra 1: a tabela `user` do Better Auth é lida aqui, fora do withTenant, só para o e-mail
 * da(s) nutricionista(s) do tenant nos avisos da agenda e do WhatsApp — e, no Plano 25 (RN-458), no aviso "Mensagens novas
 * de pacientes" (`avisarNutriDeMensagem`, src/modules/mensagens/avisos.ts, na transação do envio do paciente). Nada além do
 * e-mail sai daqui.
 */
export async function emailsDaNutri(tx: Tx, tenantId: string): Promise<string[]> {
  const us = await tx.select({ email: user.email }).from(user).where(and(eq(user.tenantId, tenantId), eq(user.appRole, 'nutri')));
  return us.map((u) => u.email);
}

/** Um e-mail por nutricionista do tenant, na mesma transação do evento (o e-mail só existe se o evento existir). */
export async function avisarNutri(tx: Tx, tenantId: string, montar: (para: string) => EmailMessage): Promise<void> {
  for (const para of await emailsDaNutri(tx, tenantId)) await enqueueEmail(montar(para), { tenantId, tx });
}

/** D18: aviso de um evento da agenda feito pelo paciente (nome, quando no fuso do tenant e o link da consulta no painel). */
export async function avisarNutriDaConsulta(
  tx: Tx,
  tenant: { id: string; fuso: string },
  c: { id: string; inicio: Date; paciente: string },
  evento: EventoAgenda,
  appUrl: string,
): Promise<void> {
  const quando = quandoComFuso(c.inicio, tenant.fuso);
  const link = urlDoApp(appUrl, `/painel/agenda/consultas/${c.id}`);
  await avisarNutri(tx, tenant.id, (para) => ({ tipo: 'aviso_agenda', para, evento, paciente: c.paciente, quando, link }));
}
