import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plano 26 (I-1 da re-revisão do rebase do PR 2): a custom rls_recepcao refaz por CREATE OR REPLACE funções de outros planos
 * — os quatro gatilhos do chat do Plano 25 (bloco 6, CH-D71) e o app_appointments_regras_pedido do Plano 23 (RE-D59) —
 * copiando o corpo e mudando só os pontos do papel. Este PR entra por último no trem e a custom é renumerada na vez do merge
 * (docs/operacao/sessoes-paralelas.md §5): se um PR anterior refizer uma dessas funções, a custom devolveria o corpo velho sem
 * erro nenhum. Aqui, cada corpo da custom tem de ser o da ÚLTIMA definição ANTERIOR a ela na ordem do _journal.json, com só
 * as trocas listadas. Só lê arquivos (sem banco).
 */

type Migration = { tag: string; sql: string };
type Troca = readonly [de: string, para: string];

const PASTA = path.resolve('drizzle');

/** As migrations na ordem em que rodam (idx do _journal.json). */
function migrationsNaOrdem(): Migration[] {
  const journal = JSON.parse(readFileSync(path.join(PASTA, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => ({ tag, sql: readFileSync(path.join(PASTA, `${tag}.sql`), 'utf8') }));
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Os corpos (do CREATE ao `END $$;`) de cada definição da função no SQL, na ordem do arquivo. */
function definicoes(sql: string, funcao: string): string[] {
  return sql.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${escapar(funcao)}\\(\\)[\\s\\S]*?END \\$\\$;`, 'g')) ?? [];
}

const ocorrencias = (texto: string, trecho: string) => texto.split(trecho).length - 1;

/**
 * O corpo esperado na custom: a última definição da função numa migration anterior à custom, com cada troca aplicada (cada
 * `de` tem de aparecer uma vez só no original). Devolve também a migration de onde o corpo veio, para a mensagem.
 */
function esperado(migrations: Migration[], custom: string, funcao: string, trocas: readonly Troca[]): { origem: string; corpo: string } {
  const i = migrations.findIndex((m) => m.tag === custom);
  expect(i, `custom ${custom} no _journal.json`).toBeGreaterThan(0);
  const anterior = migrations
    .slice(0, i)
    .flatMap((m) => definicoes(m.sql, funcao).map((corpo) => ({ origem: m.tag, corpo })))
    .at(-1);
  expect(anterior, `${funcao}: nenhuma definição antes da ${custom}`).toBeDefined();
  let corpo = anterior!.corpo;
  for (const [de, para] of trocas) {
    expect(ocorrencias(corpo, de), `${funcao} (${anterior!.origem}): «${de}» uma vez só`).toBe(1);
    corpo = corpo.replace(de, para);
  }
  return { origem: anterior!.origem, corpo };
}

/** O corpo da função na custom (uma definição só). */
function naCustom(migrations: Migration[], custom: string, funcao: string): string {
  const m = migrations.find((x) => x.tag === custom);
  const corpos = definicoes(m!.sql, funcao);
  expect(corpos, `${funcao}: uma definição só na ${custom}`).toHaveLength(1);
  return corpos[0];
}

const LISTA_DO_CHAT: Troca = [`('publico', 'conta')`, `('publico', 'conta', 'recepcao')`];

/** Cada função refeita pela custom e as únicas trocas que ela faz no corpo copiado. */
const COPIADAS: Record<string, readonly Troca[]> = {
  // bloco 6 (Plano 25, CH-D71): a `recepcao` na lista (iii) dos papéis que a RLS nega
  app_chat_conversas_regras: [LISTA_DO_CHAT],
  app_chat_mensagens_regras: [LISTA_DO_CHAT],
  app_chat_leituras_regras: [LISTA_DO_CHAT],
  app_recados_regras: [LISTA_DO_CHAT],
  // bloco 4 (Plano 23, RE-D59): a recepção aceita e recusa o pedido
  app_appointments_regras_pedido: [
    [`r IS DISTINCT FROM 'nutri' THEN`, `r NOT IN ('nutri', 'recepcao') THEN`],
    [
      `OR (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('nutri'::text, 'pedido_recusado'::text) THEN`,
      `OR (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('nutri'::text, 'pedido_recusado'::text)\n         OR (r, NEW.cancelado_por) IS NOT DISTINCT FROM ('recepcao'::text, 'pedido_recusado'::text) THEN`,
    ],
  ],
};

describe('funções refeitas pela custom rls_recepcao: cópia da última definição anterior (I-1, bloco 6 e RE-D59)', () => {
  const migrations = migrationsNaOrdem();
  const customs = migrations.filter((m) => /^\d{4}_rls_recepcao$/.test(m.tag));
  it('há uma custom rls_recepcao no _journal.json', () => expect(customs).toHaveLength(1));
  const custom = customs[0]?.tag ?? '';

  for (const [funcao, trocas] of Object.entries(COPIADAS)) {
    it(`${funcao}: corpo da última definição anterior, só com as trocas do papel`, () => {
      const { origem, corpo } = esperado(migrations, custom, funcao, trocas);
      expect(naCustom(migrations, custom, funcao), `recopie o corpo da ${origem} (docs/operacao/recepcao.md, "Antes do merge")`).toBe(corpo);
    });
  }

  it('controle negativo: um PR anterior que refaz a função faz a custom de hoje falhar', () => {
    // Em memória: uma migration anterior à custom refaz app_recados_regras com uma linha a mais; o corpo da custom (copiado
    // da definição de antes) deixa de ser o esperado.
    const i = migrations.findIndex((m) => m.tag === custom);
    const funcao = 'app_recados_regras';
    const { corpo: antes } = esperado(migrations, custom, funcao, []);
    const refeita = antes.replace('BEGIN\n', 'BEGIN\n  PERFORM 1; -- refeita por um PR anterior\n');
    expect(refeita).not.toBe(antes);
    const comPrAnterior: Migration[] = [...migrations.slice(0, i), { tag: '9999_pr_anterior', sql: refeita }, ...migrations.slice(i)];
    const { origem, corpo } = esperado(comPrAnterior, custom, funcao, COPIADAS[funcao]);
    expect(origem).toBe('9999_pr_anterior');
    expect(naCustom(comPrAnterior, custom, funcao)).not.toBe(corpo);
    // e a mesma definição DEPOIS da custom não conta (só a anterior vale)
    const comPrPosterior: Migration[] = [...migrations, { tag: '9999_pr_posterior', sql: refeita }];
    expect(naCustom(comPrPosterior, custom, funcao)).toBe(esperado(comPrPosterior, custom, funcao, COPIADAS[funcao]).corpo);
  });
});
