import { customType } from 'drizzle-orm/pg-core';

/**
 * SUS-121 (regra 3 do CLAUDE.md): o `jsonb` das tabelas passa por aqui na escrita. Um surrogate UTF-16 sem par num
 * texto dentro do jsonb dá 22P02 e o Postgres põe o trecho do JSON no CONTEXT (`JSON data, line 1: {"t":"…`) — no
 * log do banco e no erro do app; o NUL dá 22P05. Em `text` o NUL dá 22021 sem o valor, e o driver troca o surrogate
 * por U+FFFD: o risco de vazar é o jsonb. Toda string do valor, inclusive as chaves dos objetos, sai sem o NUL e sem o
 * surrogate sem par (como `semInvalidosNoBanco`, `src/lib/texto-seguro.ts`); os pares válidos (emoji) e todo o resto
 * ficam. Sem imports com alias: o drizzle-kit carrega `src/db/schema` sem os aliases do tsconfig.
 */

/** `JSON.stringify` escreve o NUL como `\u0000` e o surrogate sem par como `\udXXX` (os pares válidos saem literais). */
const ESCAPE_SUSPEITO = /\\u(?:0000|d[89a-f])/i;
/** Os escapes do texto JSON, um a um, da esquerda para a direita (`\\` consumido inteiro: `\\u0000` é texto). */
const ESCAPE_NUL = /\\(?:u0000|u[0-9a-f]{4}|[^u])/gi;
/** Par escapado (fica), surrogate escapado sozinho (sai) ou outro escape (fica). */
const ESCAPE_SURROGATE = /\\u(?:d[89ab][0-9a-f]{2}\\ud[c-f][0-9a-f]{2}|(d[89a-f][0-9a-f]{2})|[0-9a-f]{4})|\\[^u]/gi;

/**
 * O texto JSON que vai para uma coluna jsonb, sem NUL e sem surrogate sem par em nenhuma string nem chave — o mesmo
 * resultado de aplicar `semInvalidosNoBanco` a cada string e chave do valor e serializar (prova por amostragem em
 * `jsonb-seguro.test.ts`). Mesma semântica do `JSON.stringify` (o `toDriver` do jsonb do Drizzle): `toJSON` (Date),
 * `undefined` some dos objetos e vira `null` nos arrays.
 *
 * Saída rápida: sem escape suspeito no texto, ele vai como está (custo do `JSON.stringify` mais um teste de regex).
 * Com escape, os escapes saem do próprio texto JSON em duas passadas, como em `semInvalidosNoBanco`: primeiro o NUL,
 * depois o surrogate sem par (um par que o NUL separava volta a ser par). Chave que fica repetida depois da limpeza: o
 * Postgres guarda a última, como o `JSON.parse`. Para escrita crua em jsonb fora do tipo da coluna:
 * `sql\`${paraJsonbSeguro(valor)}::jsonb\``.
 */
export function paraJsonbSeguro(valor: unknown): string {
  const texto = JSON.stringify(valor) as string | undefined;
  if (texto === undefined || !ESCAPE_SUSPEITO.test(texto)) return texto as string;
  return texto
    .replace(ESCAPE_NUL, (e) => (e === '\\u0000' ? '' : e))
    .replace(ESCAPE_SURROGATE, (e, sozinho: string | undefined) => (sozinho ? '' : e));
}

/**
 * A coluna jsonb do schema (`src/db/schema/*.ts`): mesmo tipo SQL e a mesma leitura do `jsonb` do Drizzle; na
 * escrita, `paraJsonbSeguro`. Aceita `.$type<T>()`, `.notNull()`, `.default(...)` como o `jsonb`. A guarda
 * `jsonb-seguro.test.ts` quebra o CI se aparecer `jsonb(` do `drizzle-orm/pg-core` no schema.
 */
export const jsonbSeguro = customType<{ data: unknown; driverData: string }>({
  dataType: () => 'jsonb',
  toDriver: (valor) => paraJsonbSeguro(valor),
  fromDriver: (valor) => {
    if (typeof valor === 'string') {
      try {
        return JSON.parse(valor) as unknown;
      } catch {
        return valor;
      }
    }
    return valor;
  },
});
