export class CorpoGrandeError extends Error {
  override name = 'CorpoGrandeError';
}

/** O corpo não chegou inteiro dentro do `prazoMs` (envio lento ou de propósito devagar): a leitura foi cancelada. */
export class CorpoLentoError extends Error {
  override name = 'CorpoLentoError';
}

/**
 * Lê o corpo da requisição parando assim que passar de `max` bytes (não confia no Content-Length).
 * `prazoMs`: tempo máximo para o corpo inteiro chegar; estourou → cancela o leitor e lança `CorpoLentoError` (quem segura
 * uma vaga limitada enquanto lê não pode ficar nela pelos 300 s do `requestTimeout` do Node).
 */
export async function lerCorpoLimitado(req: Request, max: number, opcoes: { prazoMs?: number } = {}): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0);
  const leitor = req.body.getReader();
  let estourou = false;
  // cancelar o leitor resolve a leitura pendente com `done`: o `estourou` diz que não foi o fim do corpo
  const prazo = opcoes.prazoMs
    ? setTimeout(() => {
        estourou = true;
        leitor.cancel().catch(() => undefined);
      }, opcoes.prazoMs)
    : undefined;
  try {
    const partes: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (estourou) throw new CorpoLentoError();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await leitor.cancel();
        throw new CorpoGrandeError();
      }
      partes.push(value);
    }
    return Buffer.concat(partes);
  } finally {
    clearTimeout(prazo);
  }
}
