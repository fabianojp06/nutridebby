import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONTES, FONTES_DE_ALIMENTO, fontesVisiveis, MSG_FONTES, seloDaFonte, semValorNa, TBCA_AUTORIZADA } from './fontes';
import { FONTE_TACO_TEXTO } from './taco';

/** Comando SQL que grava linhas: INSERT INTO, UPDATE … SET (um UPDATE pode trocar a fonte para tbca) e COPY … (FROM). */
const ESCRITA = /\binsert\s+into\b|\bupdate\s+[\w."]+\s+set\b|\bcopy\s+[\w."]+\s*(?:\(|from\b)/i;

/** Comandos SQL (separados por `;`) que gravam e citam a fonte `tbca` (RN-232). */
const escritasComTbca = (sql: string): string[] =>
  sql
    .split(';')
    .filter((c) => ESCRITA.test(c) && /'tbca'/i.test(c))
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
    expect(MSG_FONTES.traduzido).toBe('Nome traduzido automaticamente do inglês.');
  });

  it('citações (RN-233, RN-232) e FONTE_TACO_TEXTO reexportado de FONTES.taco', () => {
    expect(FONTES.taco.citacao).toBe('TACO 4ª ed. — NEPA/UNICAMP');
    expect(FONTE_TACO_TEXTO).toBe(FONTES.taco.citacao);
    expect(FONTES.usda.citacao).toMatch(/^U\.S\. Department of Agriculture, Agricultural Research Service\. FoodData Central, .+\. fdc\.nal\.usda\.gov$/);
    expect(FONTES.tbca.citacao).toBe(
      'Tabela Brasileira de Composição de Alimentos (TBCA). Universidade de São Paulo (USP). Centro de Pesquisa em Alimentos (FoRC). Versão 7.3. São Paulo, 2025. Disponível em: http://www.fcf.usp.br/tbca. Acesso em: {data}.',
    );
  });

  it('RN-230: nenhum "Sem valor na TACO" fixo no código (fora de fontes.ts e dos testes): o texto sai de semValorNa(fonte)', () => {
    const presos = arquivos('src')
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && path.basename(f) !== 'fontes.ts')
      .filter((f) => readFileSync(f, 'utf8').includes('Sem valor na TACO'))
      .map((f) => path.relative(path.resolve('.'), f));
    expect(presos).toEqual([]);
  });

  it('fontesVisiveis: nunca TBCA com TBCA_AUTORIZADA false; ordem do catálogo, sem repetir', () => {
    expect(TBCA_AUTORIZADA).toBe(false);
    expect(fontesVisiveis(['taco', 'usda', 'tbca', 'propria'])).toEqual(['taco', 'usda', 'propria']);
    expect(fontesVisiveis(['propria', 'taco', 'taco'])).toEqual(['taco', 'propria']);
    expect(fontesVisiveis([])).toEqual([]);
  });
});

describe('RN-232: guarda da TBCA (nenhuma linha tbca sem autorização)', () => {
  it('o detector acha um INSERT, um UPDATE e um COPY com tbca e uma linha de CSV com tbca (a guarda não é vazia)', () => {
    expect(escritasComTbca(`ALTER TABLE foods ADD CONSTRAINT c CHECK (fonte in ('taco','tbca'));`)).toEqual([]);
    expect(escritasComTbca(`INSERT INTO "foods" ("fonte") VALUES ('tbca');`)).toHaveLength(1);
    expect(escritasComTbca(`UPDATE "foods" SET "fonte" = 'tbca' WHERE id = 1;`)).toHaveLength(1);
    expect(escritasComTbca(`update public.foods set fonte='tbca';`)).toHaveLength(1);
    expect(escritasComTbca(`COPY foods (nome, fonte) FROM stdin WITH (FORMAT csv, DEFAULT 'tbca');`)).toHaveLength(1);
    // FK com ON UPDATE e CHECK que lista tbca não gravam linha
    expect(escritasComTbca(`ALTER TABLE x ADD CONSTRAINT f FOREIGN KEY (a) REFERENCES y(a) ON UPDATE no action, ADD CONSTRAINT c CHECK (fonte in ('tbca'));`)).toEqual([]);
    expect(linhasCsvComTbca('fonte,nome\ntaco,Arroz\n"tbca",Feijão')).toEqual(['"tbca",Feijão']);
  });

  it.skipIf(TBCA_AUTORIZADA)('nenhuma migration (drizzle/*.sql) nem arquivo de seeds/ insere a fonte tbca', () => {
    const achados: string[] = [];
    for (const f of readdirSync(path.resolve('drizzle')).filter((n) => n.endsWith('.sql'))) {
      for (const c of escritasComTbca(readFileSync(path.resolve('drizzle', f), 'utf8'))) achados.push(`drizzle/${f}: ${c}`);
    }
    for (const f of arquivos('seeds')) {
      const rel = path.relative(path.resolve('.'), f);
      if (/\.sql$/i.test(f)) for (const c of escritasComTbca(readFileSync(f, 'utf8'))) achados.push(`${rel}: ${c}`);
      else if (/\.csv$/i.test(f)) for (const l of linhasCsvComTbca(readFileSync(f, 'utf8'))) achados.push(`${rel}: ${l.slice(0, 120)}`);
    }
    expect(achados).toEqual([]);
  });
});
