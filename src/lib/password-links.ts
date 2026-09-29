import { getDb } from '@/db/client';
import { enqueueEmail } from '@/email/queue';
import { tenantIsActive } from '@/modules/plataforma/tenant-status';
import { logger, nomeDoErro } from './logger';

/** `tenantId` da usuária (null = admin, sem tenant). */
export type PasswordLink = { email: string; url: string; tenantId: string | null };
export type PasswordLinkSink = (link: PasswordLink) => Promise<void> | void;

type DepsEnfileirar = {
  enfileirar: typeof enqueueEmail;
  tenantAtivo: (tenantId: string) => Promise<boolean>;
};

/**
 * Enfileira o e-mail de redefinição com o `tenantId` da usuária. RN-15 (F2): tenant suspenso
 * (ou inexistente) não recebe nada — o worker também descarta, mas aqui o job nem nasce.
 * Nunca lança (F3): falha da fila vira log só com o nome do erro (RNF-11).
 */
export async function enfileirarLinkDeSenha(
  { email, url, tenantId }: PasswordLink,
  deps: DepsEnfileirar = { enfileirar: enqueueEmail, tenantAtivo: (id) => tenantIsActive(getDb(), id) },
): Promise<void> {
  try {
    if (tenantId && !(await deps.tenantAtivo(tenantId))) return;
    await deps.enfileirar({ tipo: 'redefinir_senha', para: email, link: url }, { tenantId });
  } catch (err) {
    logger.error({ err: nomeDoErro(err) }, 'falha ao enfileirar o e-mail de redefinição de senha');
  }
}

/**
 * Destino padrão (P02-01): e-mail pela fila, com o link cifrado dentro do job.
 * F3 (US-002 "mesma resposta"): o enfileiramento sai do caminho da resposta — nem a latência
 * nem uma falha da fila distinguem um e-mail cadastrado de um inexistente.
 */
export const emailPasswordLinkSink: PasswordLinkSink = (link) => {
  void enfileirarLinkDeSenha(link);
};

let sink: PasswordLinkSink = emailPasswordLinkSink;

/** Troca o destino dos links (CLI `admin:criar` e testes). Retorna função que restaura o anterior. */
export function setPasswordLinkSink(fn: PasswordLinkSink): () => void {
  const prev = sink;
  sink = fn;
  return () => {
    sink = prev;
  };
}

/** Nunca lança: o endpoint do Better Auth responde igual, com ou sem falha na entrega. */
export async function deliverPasswordLink(link: PasswordLink): Promise<void> {
  try {
    await sink(link);
  } catch (err) {
    logger.error({ err: nomeDoErro(err) }, 'falha ao entregar o link de definição de senha');
  }
}
