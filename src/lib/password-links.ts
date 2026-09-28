import { enqueueEmail } from '@/email/queue';

export type PasswordLink = { email: string; url: string };
export type PasswordLinkSink = (link: PasswordLink) => Promise<void> | void;

/** Destino padrão (P02-01): e-mail pela fila, com o link cifrado dentro do job. */
export const emailPasswordLinkSink: PasswordLinkSink = async ({ email, url }) => {
  await enqueueEmail({ tipo: 'redefinir_senha', para: email, link: url });
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

export async function deliverPasswordLink(link: PasswordLink): Promise<void> {
  await sink(link);
}
