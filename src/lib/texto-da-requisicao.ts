import { semInvalidosNoBanco } from './texto-seguro';

/**
 * SUS-121 (regra 3): o texto livre que chega pela URL (`?busca=`, `?q=`) ou por um formulário, sem o NUL — num parâmetro
 * de texto, 22021 (um 500). O `URLSearchParams` e o `FormData` guardam USVString (o surrogate sem par já chega como
 * U+FFFD); o objeto montado à mão pode trazê-lo, e ele também sai (`semInvalidosNoBanco`). Não apara nem normaliza (quem
 * chama decide); com `max`, corta e limpa de novo (o corte pode deixar meio emoji no fim). As buscas leem `busca`/`q` só
 * por aqui: guarda em `texto-da-requisicao.test.ts`.
 */
export type ParametrosDaUrl = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

const limpar = (v: string, max?: number) => (max === undefined ? semInvalidosNoBanco(v) : semInvalidosNoBanco(semInvalidosNoBanco(v).slice(0, max)));

/** O valor de `chave` na URL (o primeiro, se repetido, como o `URLSearchParams.get`); ausente → ''. */
export function textoDaBusca(sp: ParametrosDaUrl, chave: string, max?: number): string {
  const bruto = sp instanceof URLSearchParams ? sp.get(chave) : sp[chave];
  const v = Array.isArray(bruto) ? bruto[0] : bruto;
  return typeof v === 'string' ? limpar(v, max) : '';
}

/** O valor de texto de `chave` no formulário; ausente ou arquivo → ''. */
export function textoDoForm(fd: FormData, chave: string, max?: number): string {
  const v = fd.get(chave);
  return typeof v === 'string' ? limpar(v, max) : '';
}
