import { describe, expect, it } from 'vitest';
import { caminhoAte, grafoDeImports } from '../../../test/grafo-de-imports';

/**
 * Plano 22 (EP-D47, T2): as regras que o formulário usa no cliente ficam em arquivos puros — um import do servidor
 * levaria `pg` ao bundle. A guarda anda o grafo de imports em tempo de execução (import type não conta).
 */
const PUROS = [
  'src/modules/exames/classificacao.ts',
  'src/modules/exames/catalogo-regras.ts',
  'src/modules/exames/constantes.ts',
  'src/modules/documentos/marcacao.ts',
  'src/modules/documentos/solicitacao.ts',
  'src/modules/documentos/prescricao.ts',
];
const ARQUIVOS_PROIBIDOS = ['src/db/client.ts', 'src/db/tenant.ts'];
const PACOTES_PROIBIDOS = ['server-only', 'pg', 'drizzle-orm', 'pg-boss'];

describe('regras puras do Plano 22 (EP-D47)', () => {
  it('nada alcançável a partir delas importa @/db/client, @/db/tenant, server-only ou pg', () => {
    const g = grafoDeImports(PUROS);
    // o grafo anda de verdade: chega ao Zod e à normalização da IA
    expect(g.pacotes.has('zod')).toBe(true);
    expect(g.arquivos.has('src/modules/ia/correspondencia.ts')).toBe(true);
    for (const a of ARQUIVOS_PROIBIDOS) expect(g.arquivos.has(a), `${a} alcançado por: ${caminhoAte(g, a).join(' → ')}`).toBe(false);
    for (const p of PACOTES_PROIBIDOS) expect(g.pacotes.get(p), `${p} importado por`).toBeUndefined();
  });

  it('documentos/constantes.ts continua sem import nenhum (componentes "use client" leem dali)', () => {
    const g = grafoDeImports(['src/modules/documentos/constantes.ts']);
    expect([...g.arquivos.keys()]).toEqual(['src/modules/documentos/constantes.ts']);
    expect(g.pacotes.size).toBe(0);
  });
});
