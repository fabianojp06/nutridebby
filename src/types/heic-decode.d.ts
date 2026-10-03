declare module 'heic-decode' {
  type Pixels = { width: number; height: number; data: Uint8ClampedArray };
  type Imagem = { width: number; height: number; decode: () => Promise<Pixels> };
  /** Decodifica a imagem inteira — NÃO usar no job (aloca antes de conferir o tamanho). */
  function decode(o: { buffer: Buffer | ArrayBuffer }): Promise<Pixels>;
  namespace decode {
    /**
     * Só abre o contêiner: `width`/`height` do cabeçalho; os pixels só no `decode()` de cada imagem.
     * `dispose()` libera a memória do decodificador (WASM) — obrigatório depois do uso (README do pacote).
     */
    function all(o: { buffer: Buffer | ArrayBuffer }): Promise<Imagem[] & { dispose: () => void }>;
  }
  export default decode;
}
