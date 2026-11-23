/**
 * Rodada da T6b (I4): a Server Action chamada pelo cliente rejeita quando a rede cai (o `fetch` dela falha). Sem isto, a
 * rejeição vai para o error boundary e o que estava escrito se perde. Com isto, a falha vira um estado comum do formulário
 * (`aoFalhar`, com o texto de volta). Os "erros" de controle do Next (redirect, notFound) seguem adiante. Puro (cliente).
 */
export function seguraFalhaDeRede<S, R>(acao: (anterior: S, dados: FormData) => Promise<R>, aoFalhar: (dados: FormData) => R): (anterior: S, dados: FormData) => Promise<R> {
  return async (anterior, dados) => {
    try {
      return await acao(anterior, dados);
    } catch (err) {
      const digest = (err as { digest?: unknown } | null)?.digest;
      if (typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest)) throw err;
      return aoFalhar(dados);
    }
  };
}
