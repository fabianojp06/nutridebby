/**
 * Plano 22 (RN-395, EP-D31): a marcação mínima das orientações (receita e solicitação). PURO e SEM imports: roda no
 * worker (PDF), no editor (prévia, 'use client') e na página do documento. Devolve blocos para quem desenha montar
 * componentes — **nunca** HTML: `<`, `>`, `&` e qualquer tag, link, imagem ou título ficam como texto nos trechos.
 *
 * - parágrafo: separado por linha em branco; uma quebra simples fica dentro do parágrafo (`\n` no texto);
 * - lista: linhas seguidas que começam com "- ";
 * - negrito: `**…**`, sem aninhar; asterisco solto, `**` sem par e `****` vazio ficam como estão.
 */
export type Trecho = { texto: string; negrito: boolean };
export type Bloco = { tipo: 'paragrafo'; trechos: Trecho[] } | { tipo: 'lista'; itens: Trecho[][] };

const MARCA = '**';

/** Os trechos de uma linha (ou parágrafo): pares de `**` em ordem; o que não fecha fica literal. */
function trechos(texto: string): Trecho[] {
  const out: Trecho[] = [];
  const literal = (t: string) => {
    if (!t) return;
    const ultimo = out.at(-1);
    if (ultimo && !ultimo.negrito) ultimo.texto += t;
    else out.push({ texto: t, negrito: false });
  };
  let i = 0;
  while (i < texto.length) {
    const abre = texto.indexOf(MARCA, i);
    if (abre < 0) break;
    const fecha = texto.indexOf(MARCA, abre + MARCA.length);
    if (fecha < 0) break;
    const dentro = texto.slice(abre + MARCA.length, fecha);
    if (!dentro) {
      // "****": nada para negritar — fica literal e a leitura segue depois dele
      literal(texto.slice(i, fecha + MARCA.length));
      i = fecha + MARCA.length;
      continue;
    }
    literal(texto.slice(i, abre));
    out.push({ texto: dentro, negrito: true });
    i = fecha + MARCA.length;
  }
  literal(texto.slice(i));
  return out;
}

const ehItem = (linha: string) => linha.startsWith('- ');

export function lerMarcacao(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  const normalizado = texto.replace(/\r\n?/g, '\n');
  for (const grupo of normalizado.split(/\n[ \t]*\n/)) {
    const linhas = grupo.split('\n').filter((l) => l.trim() !== '');
    let paragrafo: string[] = [];
    let lista: Trecho[][] = [];
    const fecharParagrafo = () => {
      if (paragrafo.length) blocos.push({ tipo: 'paragrafo', trechos: trechos(paragrafo.join('\n').trim()) });
      paragrafo = [];
    };
    const fecharLista = () => {
      if (lista.length) blocos.push({ tipo: 'lista', itens: lista });
      lista = [];
    };
    for (const linha of linhas) {
      if (ehItem(linha)) {
        fecharParagrafo();
        lista.push(trechos(linha.slice(2).trim()));
      } else {
        fecharLista();
        paragrafo.push(linha);
      }
    }
    fecharParagrafo();
    fecharLista();
  }
  return blocos;
}
