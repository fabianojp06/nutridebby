import { Fragment, type ReactNode } from 'react';

/**
 * D7: subconjunto de markdown das orientações (US-052), renderizado como elementos React — nunca
 * `dangerouslySetInnerHTML`: HTML digitado sai escapado, como texto. Parágrafos (linha em branco separa; quebra simples
 * vira <br>), `**negrito**`, `*itálico*`, títulos `#`–`######` (viram h2/h3: o h1 é o título do conteúdo), listas
 * `-`/`*` e `1.`, links `[texto](https://…)`. Quantificadores limitados (sem retrocesso catastrófico) e profundidade
 * de aninhamento 3.
 */
export type Inline =
  | { t: 'texto'; v: string }
  | { t: 'negrito'; filhos: Inline[] }
  | { t: 'italico'; filhos: Inline[] }
  | { t: 'link'; href: string; filhos: Inline[] };
export type Bloco =
  | { t: 'titulo'; nivel: 2 | 3; filhos: Inline[] }
  | { t: 'paragrafo'; linhas: Inline[][] }
  | { t: 'lista'; ordenada: boolean; itens: Inline[][] };

// O destino do link aceita um nível de parênteses balanceados (`…/Foo_(bar)`, `javascript:alert(1)`): sem isso o
// link inteiro sairia como texto cru em vez de virar só o texto do link. As duas alternativas começam por caracteres
// disjuntos (`(` ou não-parêntese), então não há ambiguidade nem retrocesso exponencial. O texto do link não aceita
// `[`: numa linha de muitos `[` cada posição falha na hora, em vez de varrer 200 caracteres.
const TOKEN =
  /\*\*([^*\n]{1,500})\*\*|\*([^*\n]{1,500})\*|\[([^[\]\n]{1,200})\]\(((?:[^()\s]|\([^()\s]{0,100}\)){1,500})\)/;
// Depois do marcador, só espaço ou tab e o texto começando por não-espaço: as duas partes não se sobrepõem, então a
// linha é varrida uma vez. Com `\s+(.+)$` um U+2028/U+2029 no meio da linha (`\s` casa, `.` não) fazia o motor
// retroceder em tempo quadrático (~0,4 s numa linha de 20000 caracteres).
const TITULO = /^(#{1,6})[ \t]+(\S.*)$/;
const ITEM = /^[ \t]{0,3}(?:([-*])|(\d{1,3})[.)])[ \t]+(\S.*)$/;

/** Link só http(s) absoluto, sem usuário/senha; o resto (javascript:, data:, //, relativo) → null. */
export function hrefSeguro(href: string): string | null {
  try {
    const u = new URL(href);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function lerInline(s: string, profundidade = 0): Inline[] {
  if (profundidade > 3) return [{ t: 'texto', v: s }];
  const out: Inline[] = [];
  let resto = s;
  while (resto) {
    const m = TOKEN.exec(resto);
    if (!m) {
      out.push({ t: 'texto', v: resto });
      break;
    }
    if (m.index > 0) out.push({ t: 'texto', v: resto.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: 'negrito', filhos: lerInline(m[1], profundidade + 1) });
    else if (m[2] !== undefined) out.push({ t: 'italico', filhos: lerInline(m[2], profundidade + 1) });
    else {
      const href = hrefSeguro(m[4]);
      out.push(href ? { t: 'link', href, filhos: lerInline(m[3], profundidade + 1) } : { t: 'texto', v: m[3] });
    }
    resto = resto.slice(m.index + m[0].length);
  }
  return out;
}

export function lerMarkdown(md: string): Bloco[] {
  const blocos: Bloco[] = [];
  let paragrafo: Inline[][] = [];
  let lista: { ordenada: boolean; itens: Inline[][] } | null = null;
  const fechar = () => {
    if (paragrafo.length) blocos.push({ t: 'paragrafo', linhas: paragrafo });
    if (lista) blocos.push({ t: 'lista', ...lista });
    paragrafo = [];
    lista = null;
  };
  // U+2028/U+2029 (comuns em texto colado de PDF ou Word) também quebram a linha, como \r e \r\n.
  for (const bruta of md.replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n')) {
    const linha = bruta.trimEnd();
    if (!linha.trim()) {
      fechar();
      continue;
    }
    const titulo = TITULO.exec(linha);
    if (titulo) {
      fechar();
      blocos.push({ t: 'titulo', nivel: titulo[1].length <= 2 ? 2 : 3, filhos: lerInline(titulo[2].trim()) });
      continue;
    }
    const item = ITEM.exec(linha);
    if (item) {
      const ordenada = item[2] !== undefined;
      if (paragrafo.length || (lista && lista.ordenada !== ordenada)) fechar();
      lista ??= { ordenada, itens: [] };
      lista.itens.push(lerInline(item[3].trim()));
      continue;
    }
    if (lista) fechar();
    paragrafo.push(lerInline(linha.trim()));
  }
  fechar();
  return blocos;
}

// Função simples, não componente: um texto de 18 mil caracteres pode virar milhares de nós, e um componente + um
// Fragment por nó deixava a renderização lenta à toa. Texto puro vai como string (o React escapa).
function inlines(itens: Inline[]): ReactNode[] {
  return itens.map((i, k) => {
    switch (i.t) {
      case 'texto':
        return i.v;
      case 'negrito':
        return <strong key={k}>{inlines(i.filhos)}</strong>;
      case 'italico':
        return <em key={k}>{inlines(i.filhos)}</em>;
      case 'link':
        return (
          <a key={k} href={i.href} target="_blank" rel="noopener noreferrer nofollow">
            {inlines(i.filhos)}
          </a>
        );
    }
  });
}

export function Markdown({ texto, className }: { texto: string; className?: string }) {
  const blocos = lerMarkdown(texto).map((b, k) => {
    if (b.t === 'titulo') {
      const H = b.nivel === 2 ? 'h2' : 'h3';
      return <H key={k}>{inlines(b.filhos)}</H>;
    }
    if (b.t === 'lista') {
      const L = b.ordenada ? 'ol' : 'ul';
      return <L key={k}>{b.itens.map((it, j) => <li key={j}>{inlines(it)}</li>)}</L>;
    }
    return (
      <p key={k}>
        {b.linhas.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inlines(l)}
          </Fragment>
        ))}
      </p>
    );
  });
  return className ? <div className={className}>{blocos}</div> : <>{blocos}</>;
}
