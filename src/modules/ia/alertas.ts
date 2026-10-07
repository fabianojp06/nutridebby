import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { systemHeartbeat } from '@/db/schema';
import type { EmailMessage } from '@/email/types';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarAdmins } from '@/modules/plataforma/monitoramento';
import { FUSO_DA_PLATAFORMA, mesNoFuso } from './cota';

/** RN-105 / US-102: e-mails aos admins com marca em system_heartbeat (como o alerta de disco), na mesma transação dos e-mails. */
async function avisarComMarca(db: Db, nome: string, agora: Date, deveAvisar: (ultimo: Date | null) => boolean, montar: (para: string) => EmailMessage): Promise<number> {
  const [u] = await db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, nome));
  if (!deveAvisar(u?.beatAt ?? null)) return 0;
  return avisarAdmins(db, montar, undefined, (tx) =>
    tx.insert(systemHeartbeat).values({ name: nome, beatAt: agora }).onConflictDoUpdate({ target: systemHeartbeat.name, set: { beatAt: agora } }),
  );
}

/** 401/402/403 ou chave ausente no worker: no máximo um e-mail por hora. */
export function avisarCredencialInvalida(db: Db, agora: Date, appUrl: string): Promise<number> {
  return avisarComMarca(db, 'alerta_ia_credencial', agora, (u) => !u || agora.getTime() - u.getTime() >= 3_600_000, (para) => ({
    tipo: 'alerta_ia', para, motivo: 'credencial', painelUrl: urlDoApp(appUrl, '/admin'),
  }));
}

/** Teto global do mês atingido (ou limite de gasto do Console): um e-mail por mês de Brasília. */
export function avisarTetoGlobal(db: Db, agora: Date, appUrl: string): Promise<number> {
  return avisarComMarca(db, 'alerta_ia_teto', agora, (u) => !u || mesNoFuso(u, FUSO_DA_PLATAFORMA) !== mesNoFuso(agora, FUSO_DA_PLATAFORMA), (para) => ({
    tipo: 'alerta_ia', para, motivo: 'teto', painelUrl: urlDoApp(appUrl, '/admin'),
  }));
}
