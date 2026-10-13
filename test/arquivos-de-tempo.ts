import { defaultExclude } from 'vitest/config';

/**
 * Testes que medem tempo (`*.tempo.test.ts`: p95 da busca, RNF-01; tempo linear do SVG do logo). No CI eles saem da
 * suíte paralela e rodam depois, sozinhos (`pnpm test:tempo`): no runner próprio a cota de 4 vCPU pausa o grupo inteiro
 * quando os workers a esgotam, e um teste de tempo ao lado de um arquivo pesado mede a pausa, não o código (CI do PR #34:
 * p95 de 434 e 575 ms com a varredura de `limparAcessosAntigos` ao lado; 46–78 ms sozinho). Fora do CI, `pnpm test` roda tudo.
 */
export const ARQUIVOS_DE_TEMPO = ['src/**/*.tempo.test.ts', 'test/**/*.tempo.test.ts'];
const TODOS = ['src/**/*.test.ts', 'test/**/*.test.ts'];

export type SelecaoDosTestes = {
  include: string[];
  exclude: string[];
  maxWorkers?: number;
  fileParallelism?: boolean;
};

export function selecaoDosTestes(env: Record<string, string | undefined>): SelecaoDosTestes {
  if (env.VITEST_SO_TEMPO === '1')
    return { include: ARQUIVOS_DE_TEMPO, exclude: defaultExclude, fileParallelism: false };
  // Runner próprio: o contêiner do job enxerga os 8 núcleos da VPS (o padrão daria 7 workers numa cota de 4 núcleos e
  // expôs um deadlock de DDL do rls-guard contra outro arquivo). 3, como no runner hospedado de 4 vCPU.
  if (env.CI)
    return { include: TODOS, exclude: [...defaultExclude, ...ARQUIVOS_DE_TEMPO], maxWorkers: 3 };
  return { include: TODOS, exclude: defaultExclude };
}
