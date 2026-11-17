import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONTES, FONTES_DE_ALIMENTO, fontesVisiveis, seloDaFonte, semValorNa, TBCA_AUTORIZADA } from './fontes';
import { FONTE_TACO_TEXTO } from './taco';

/** Comandos SQL (separados por `;`) que inserem e citam a fonte `tbca` (RN-232). */
const insertsComTbca = (sql: string): string[] =>
  sql
    .split(';')
    .filter((c) => /\binsert\s+into\b/i.test(c) && /'tbca'/i.test(c))
    .map((c) => c.trim().slice(0, 120));

/** Linhas de CSV com algum campo igual a `tbca` (seed de alimentos com a fonte TBCA). */
const linhasCsvComTbca = (csv: string): string[] => csv.split('\n').filter((l) => l.split(',').some((c) => c.trim().replace(/^"|"$/g, '').toLowerCase() === 'tbca'));

const arquivos = (pasta: string): string[] =>
  readdirSync(path.resolve(pasta), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(d.parentPath, d.name));

describe('RN-230/RN-233: fontes de alimento', () => {
  it('selos, siglas e "Sem valor na {sigla}"', () => {
    expect(FONTES_DE_ALIMENTO.map(seloDaFonte)).toEqual(['TACO', 'USDA (EUA)', 'TBCA', 'Meu alimento']);
    expect(semValorNa('taco')).toBe('Sem valor na TACO');
    expect(semValorNa('usda')).toBe('Sem valor na USDA');
    expect(semValorNa('tbca')).toBe('Sem valor na TBCA');
    expect(semValorNa('propria')).toBe('Sem valor');
    for (const f of ['taco', 'usda', 'tbca'] as const) expect(FONTES[f].selo).toBe(seloDaFonte(f));
  });

  it('citações (RN-233, RN-232) e FONTE_TACO_TEXTO reexportado de FONTES.taco', () => {
    expect(FONTES.taco.citacao).toBe('TACO 4ª ed. — NEPA/UNICAMP');
    expect(FONTE_TACO_TEXTO).toBe(FONTES.taco.citacao);
    expect(FONTES.usda.citacao).toMatch(/^U\.S\. Department of Agriculture, Agricultural Research Service\. FoodData Central, .+\. fdc\.nal\.usda\.gov$/);
    expect(FONTES.tbca.citacao).toBe(
      'Tabela Brasileira de Composição de Alimentos (TBCA). Universidade de São Paulo (USP). Centro de Pesquisa em Alimentos (FoRC). Versão 7.3. São Paulo, 2025. Disponível em: http://www.fcf.usp.br/tbca. Acesso em: {data}.',
    );
  });

  it('fontesVisiveis: nunca TBCA com TBCA_AUTORIZADA false; ordem do catálogo, sem repetir', () => {
    expect(TBCA_AUTORIZADA).toBe(false);
    expect(fontesVisiveis(['taco', 'usda', 'tbca', 'propria'])).toEqual(['taco', 'usda', 'propria']);
    expect(fontesVisiveis(['propria', 'taco', 'taco'])).toEqual(['taco', 'propria']);
    expect(fontesVisiveis([])).toEqual([]);
  });
});

describe('RN-232: guarda da TBCA (nenhuma linha tbca sem autorização)', () => {
  it('o detector acha um INSERT com tbca e uma linha de CSV com tbca (a guarda não é vazia)', () => {
    expect(insertsComTbca(`ALTER TABLE foods ADD CONSTRAINT c CHECK (fonte in ('taco','tbca'));`)).toEqual([]);
    expect(insertsComTbca(`INSERT INTO "foods" ("fonte") VALUES ('tbca');`)).toHaveLength(1);
    expect(linhasCsvComTbca('fonte,nome\ntaco,Arroz\n"tbca",Feijão')).toEqual(['"tbca",Feijão']);
  });

  it.skipIf(TBCA_AUTORIZADA)('nenhuma migration (drizzle/*.sql) nem arquivo de seeds/ insere a fonte tbca', () => {
    const achados: string[] = [];
    for (const f of readdirSync(path.resolve('drizzle')).filter((n) => n.endsWith('.sql'))) {
      for (const c of insertsComTbca(readFileSync(path.resolve('drizzle', f), 'utf8'))) achados.push(`drizzle/${f}: ${c}`);
    }
    for (const f of arquivos('seeds')) {
      const rel = path.relative(path.resolve('.'), f);
      if (/\.sql$/i.test(f)) for (const c of insertsComTbca(readFileSync(f, 'utf8'))) achados.push(`${rel}: ${c}`);
      else if (/\.csv$/i.test(f)) for (const l of linhasCsvComTbca(readFileSync(f, 'utf8'))) achados.push(`${rel}: ${l.slice(0, 120)}`);
    }
    expect(achados).toEqual([]);
  });
});
