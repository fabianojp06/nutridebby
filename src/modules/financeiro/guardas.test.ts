import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caminhoAte, fontesDe, grafoDeImports } from '../../../test/grafo-de-imports';

/**
 * RN-323 (RNF-303 c): nenhum contexto de IA lê o Financeiro. Guarda por grafo — também por caminho indireto (ia → ficha/secoes
 * → financeiro, quando a seção da ficha existir) — e guarda de texto (SQL cru com `fin_`, ou a tabela do Drizzle pelo barril
 * `@/db/schema`). RNF-307: nada do Financeiro no service worker do portal (o escopo é guardado por sw-escopo.test.ts).
 */
const SCHEMA_DO_FINANCEIRO = 'src/db/schema/financeiro.ts';
/** O barril reexporta todas as tabelas: passar por ele não é ler o Financeiro (as tabelas só saem pelo nome, guardado abaixo). */
const BARRIL = 'src/db/schema/index.ts';
/** Import direto do schema do Financeiro: `@/db/schema/financeiro`, `../../db/schema/financeiro`, ou `./financeiro` dentro de src/db/schema. */
const importaSchema = (arquivo: string, fonte: string) =>
  /['"][^'"]*\bschema\/financeiro['"]/.test(fonte) || (arquivo.startsWith('src/db/schema/') && /['"]\.\/financeiro['"]/.test(fonte));

describe('RN-323: o Financeiro fica fora da IA', () => {
  const raizes = fontesDe('src/modules/ia');
  const g = grafoDeImports(raizes);

  it('o grafo anda de verdade (a IA alcança o banco e outros módulos)', () => {
    expect(raizes.length).toBeGreaterThan(10);
    expect(g.arquivos.has('src/db/tenant.ts')).toBe(true);
    expect(g.arquivos.has(BARRIL)).toBe(true);
  });

  it('nenhum arquivo alcançável a partir de src/modules/ia/** é do módulo do Financeiro', () => {
    const proibidos = [...g.arquivos.keys()].filter((a) => a.startsWith('src/modules/financeiro/'));
    expect(proibidos.map((p) => caminhoAte(g, p).join(' → '))).toEqual([]);
  });

  it('o schema do Financeiro só é alcançado pelo barril, nunca importado direto por um arquivo do grafo da IA', () => {
    const diretos = [...g.arquivos.keys()].filter((a) => a !== BARRIL && a !== SCHEMA_DO_FINANCEIRO && importaSchema(a, readFileSync(a, 'utf8')));
    expect(diretos).toEqual([]);
    if (g.arquivos.has(SCHEMA_DO_FINANCEIRO)) expect(g.arquivos.get(SCHEMA_DO_FINANCEIRO)).toBe(BARRIL);
  });

  it('a regra do import direto pega as três formas', () => {
    expect(importaSchema('src/modules/ia/x.ts', "import { finLancamentos } from '@/db/schema/financeiro';")).toBe(true);
    expect(importaSchema('src/modules/ia/x.ts', "import { finLancamentos } from '../../db/schema/financeiro';")).toBe(true);
    expect(importaSchema('src/db/schema/x.ts', "import { finLancamentos } from './financeiro';")).toBe(true);
    expect(importaSchema('src/modules/ia/x.ts', "import { x } from './financeiro-de-outra-coisa';")).toBe(false);
  });

  it('nenhum arquivo de src/modules/ia/** (testes incluídos) contém `fin_` nem cita as tabelas do Drizzle do Financeiro', () => {
    const arquivos = readdirSync('src/modules/ia', { recursive: true, encoding: 'utf8' })
      .map((f) => path.join('src/modules/ia', f))
      .filter((f) => /\.(tsx?|jsx?|mjs|cjs|sql)$/.test(f));
    expect(arquivos.length).toBeGreaterThan(10);
    const comTexto = arquivos.filter((f) => /fin_|\bfin(?:Lancamentos|Categorias|Configuracoes)\b/.test(readFileSync(f, 'utf8')));
    expect(comTexto).toEqual([]);
  });
});

describe('RNF-307: nada do Financeiro no service worker do portal', () => {
  it('src/app/sw.ts não cita o Financeiro', () => {
    expect(readFileSync('src/app/sw.ts', 'utf8')).not.toMatch(/financeiro|fin_/i);
  });
});

describe('constantes do Financeiro sem drizzle (componentes cliente importam MSG_FINANCEIRO)', () => {
  it('constantes.ts não alcança drizzle-orm nem o schema com tabelas', () => {
    const g = grafoDeImports(['src/modules/financeiro/constantes.ts']);
    expect(g.pacotes.get('drizzle-orm'), 'drizzle-orm importado por').toBeUndefined();
    expect(g.arquivos.has(SCHEMA_DO_FINANCEIRO), caminhoAte(g, SCHEMA_DO_FINANCEIRO).join(' → ')).toBe(false);
    expect(g.arquivos.has('src/db/schema/financeiro-formas.ts')).toBe(true);
  });
});
