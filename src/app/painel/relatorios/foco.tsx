'use client';

import { useEffect } from 'react';

/**
 * RN-481 (molde do `FocoNoTitulo` do Plano 18): o período inválido chega numa página renderizada no servidor, onde um
 * `role="alert"` que já nasce com o texto não é anunciado. A página só monta este componente quando há erro (com `key`
 * pelo erro e pelo que veio na URL), e na montagem o foco vai para o aviso (`id`, focável por script): o leitor de tela
 * lê o erro e a página rola até ele.
 */
export function FocoNoAviso({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id]);
  return null;
}
