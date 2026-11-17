import { describe, expect, it } from 'vitest';
import { caminhoAte, grafoDeImports } from '../../../test/grafo-de-imports';

/**
 * RNF-235 / manual §4.4.1: as regras do plano são puras — o editor (cliente), o servidor, o PDF e o portal usam a mesma
 * conta. Nenhum destes arquivos alcança banco, React ou Next em tempo de execução (`import type` não conta).
 */
const PUROS = [
  'src/modules/plano-alimentar/calculo.ts',
  'src/modules/plano-alimentar/dias.ts',
  'src/modules/plano-alimentar/congelados.ts',
  'src/modules/alimentos/nutrientes.ts',
  'src/modules/alimentos/fontes.ts',
];
const PACOTES_PROIBIDOS = ['drizzle-orm', 'pg', 'react', 'react-dom', 'next'];

describe('Plano 19: cálculo, dias, fontes, nutrientes e congelados sem banco, React nem Next', () => {
  it.each(PUROS)('%s', (arquivo) => {
    const g = grafoDeImports([arquivo]);
    for (const a of g.arquivos.keys()) expect(a.startsWith('src/db/'), `${a} alcançado por: ${caminhoAte(g, a).join(' → ')}`).toBe(false);
    for (const p of PACOTES_PROIBIDOS) expect(g.pacotes.get(p), `${p} importado por`).toBeUndefined();
  });
});
