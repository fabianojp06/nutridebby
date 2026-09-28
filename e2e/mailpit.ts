const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

type Resumo = { ID: string; Subject: string; Created: string };

/** Espera (polling) o e-mail mais recente para `para` no Mailpit. */
export async function esperarEmail(
  para: string,
  opts: { assunto?: string; depoisDe?: Date; timeoutMs?: number } = {},
): Promise<{ assunto: string; texto: string; html: string }> {
  const limite = opts.timeoutMs ?? 30_000;
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}&limit=20`);
    const { messages } = (await r.json()) as { messages: Resumo[] };
    const m = messages.find(
      (x) =>
        (!opts.assunto || x.Subject === opts.assunto) &&
        (!opts.depoisDe || new Date(x.Created).getTime() >= opts.depoisDe.getTime() - 1000),
    );
    if (m) {
      const d = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Subject: string; Text: string; HTML: string };
      return { assunto: d.Subject, texto: d.Text, html: d.HTML };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`Nenhum e-mail para ${para} em ${limite} ms`);
}

/** Primeiro link absoluto do texto que contém `trecho`. */
export function primeiroLink(texto: string, trecho: string): string {
  const escapado = trecho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = texto.match(new RegExp(`https?://\\S*${escapado}\\S*`));
  if (!m) throw new Error(`Nenhum link com "${trecho}" no e-mail`);
  return m[0];
}
