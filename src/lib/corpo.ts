export class CorpoGrandeError extends Error {
  override name = 'CorpoGrandeError';
}

/** Lê o corpo da requisição parando assim que passar de `max` bytes (não confia no Content-Length). */
export async function lerCorpoLimitado(req: Request, max: number): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0);
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await leitor.cancel();
      throw new CorpoGrandeError();
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}
