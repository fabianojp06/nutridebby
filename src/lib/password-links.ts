export type PasswordLink = { email: string; url: string };
export type PasswordLinkSink = (link: PasswordLink) => Promise<void> | void;

const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');

const defaultSink: PasswordLinkSink = ({ email }) => {
  // Plano 02 (P02-01) troca por envio de e-mail. Nunca registrar a URL (contém token).
  console.warn(`[password-links] envio de e-mail ainda não configurado; link não enviado para ${maskEmail(email)}`);
};

let sink: PasswordLinkSink = defaultSink;

/** Troca o destino dos links (CLI e testes). Retorna função que restaura o anterior. */
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
