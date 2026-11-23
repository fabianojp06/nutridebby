import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SUS-100: guarda estática contra a volta do deadlock de DDL. Teste que faz DDL em tabela real (`drop`/`create`/`alter
 * policy`, `drop`/`create trigger`, `alter table` — inclusive `alter table … disable trigger` —, `lock table`) pega
 * AccessExclusiveLock até o rollback; no banco compartilhado do Testcontainers isso disputa com os outros arquivos e
 * fecha ciclo (40P01). Esse arquivo tem de importar `bancoProprioParaDdl` de `test/ddl.ts` (banco clonado só dele).
 *
 * Fica de fora: tabela `tmp_*` (criada e apagada na própria transação, ninguém mais a trava), texto em comentário e os
 * arquivos com cluster próprio (`novoPostgres` de `test/postgres-teste.ts`: o `global-setup`, que monta o banco antes
 * de qualquer arquivo conectar, e os testes que sobem outro Postgres). A leitura é por expressão regular sobre o texto:
 * erra para o lado seguro (nome de tabela vindo de `${…}` conta como tabela real).
 */

const RAIZ = path.resolve('.');
const ESTE_ARQUIVO = 'src/db/ddl-guard.test.ts'; // só textos de exemplo, sem banco
const HELPER_DDL = path.join(RAIZ, 'test/ddl');
const POSTGRES_PROPRIO = path.join(RAIZ, 'test/postgres-teste');

/** Arquivos com cluster próprio hoje. Quem acrescentar outro revê esta lista (e a isenção que ela dá). */
const CLUSTER_PROPRIO = [
  'src/db/migrate-owner.test.ts',
  'src/modules/plataforma/ia-nutri-pausa.test.ts',
  'test/global-setup.ts',
];

const TABELA = String.raw`(?:only\s+)?(?:public\.)?("?)(\$\{[^}]*\}|\w+)\1`;
const NOME = String.raw`(?:"[^"]+"|\w+)`;
const DDL: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:drop|create|alter)\s+policy\s+(?:if\s+exists\s+)?${NOME}\s+on\s+${TABELA}`, 'gi'),
  new RegExp(
    String.raw`\b(?:drop|create(?:\s+or\s+replace)?(?:\s+constraint)?)\s+trigger\s+(?:if\s+exists\s+)?${NOME}\s[^;'"\x60]*?\bon\s+${TABELA}`,
    'gi',
  ),
  new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?${TABELA}`, 'gi'),
  new RegExp(String.raw`\block\s+table\s+${TABELA}`, 'gi'),
];

/** Tira comentários de bloco e de linha (`//` depois de `:` fica: é URL). */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Arquivos do projeto que o arquivo importa, com os nomes importados (sem extensão; alias `@/` = `src/`). */
function importsDe(arquivo: string, texto: string): { alvo: string; nomes: string }[] {
  const out: { alvo: string; nomes: string }[] = [];
  for (const m of texto.matchAll(/\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    let alvo: string | null = null;
    if (spec.startsWith('.')) alvo = path.resolve(RAIZ, path.dirname(arquivo), spec);
    else if (spec.startsWith('@/')) alvo = path.join(RAIZ, 'src', spec.slice(2));
    if (alvo) out.push({ alvo: alvo.replace(/\.(?:ts|tsx|js|mjs|cjs)$/, ''), nomes: m[1] });
  }
  return out;
}

const importa = (arquivo: string, texto: string, alvo: string, nome: string) =>
  importsDe(arquivo, texto).some((i) => i.alvo === alvo && new RegExp(String.raw`\b${nome}\b`).test(i.nomes));

/** Tabelas reais (não `tmp_*`) em que o texto faz DDL. */
function tabelasComDdl(texto: string): string[] {
  const limpo = semComentarios(texto);
  const tabelas = new Set<string>();
  for (const re of DDL) for (const m of limpo.matchAll(re)) if (!/^tmp_/i.test(m[2])) tabelas.add(m[2]);
  return [...tabelas].sort();
}

/** Violação do arquivo (`arquivo` relativo à raiz): DDL em tabela real sem o banco próprio de `test/ddl.ts`. */
function violacaoDdl(arquivo: string, texto: string): { arquivo: string; tabelas: string[] } | null {
  if (importa(arquivo, texto, POSTGRES_PROPRIO, 'novoPostgres')) return null;
  const tabelas = tabelasComDdl(texto);
  if (tabelas.length === 0 || importa(arquivo, texto, HELPER_DDL, 'bancoProprioParaDdl')) return null;
  return { arquivo, tabelas };
}

function arquivosDosTestes(): string[] {
  const de = (pasta: string, filtro: RegExp) =>
    readdirSync(path.join(RAIZ, pasta), { recursive: true, encoding: 'utf8' })
      .map((f) => path.posix.join(pasta, f.split(path.sep).join('/')))
      .filter((f) => filtro.test(f) && !f.includes('node_modules/'));
  return [...de('src', /\.test\.tsx?$/), ...de('test', /\.(?:ts|tsx|js|mjs|cjs)$/)]
    .filter((f) => f !== ESTE_ARQUIVO)
    .sort();
}

const ler = (f: string) => readFileSync(path.join(RAIZ, f), 'utf8');

describe('guarda de DDL nos testes (SUS-100: DDL em tabela real só no banco próprio)', () => {
  const arquivos = arquivosDosTestes();

  it('nenhum teste faz DDL em tabela real no banco compartilhado', () => {
    const v = arquivos.map((f) => violacaoDdl(f, ler(f))).filter((x) => x !== null);
    expect(v, JSON.stringify(v, null, 2)).toEqual([]);
  });

  it('a varredura enxerga os testes de DDL de hoje (rls-guard e audit-guard), e eles usam o banco próprio', () => {
    const comDdl = arquivos.filter((f) => tabelasComDdl(ler(f)).length > 0);
    expect(comDdl).toEqual(expect.arrayContaining(['src/db/audit-guard.test.ts', 'src/db/rls-guard.test.ts']));
    expect(tabelasComDdl(ler('src/db/audit-guard.test.ts'))).toContain('patients');
    for (const f of comDdl) expect(importa(f, ler(f), HELPER_DDL, 'bancoProprioParaDdl'), f).toBe(true);
  });

  it('os arquivos com cluster próprio (isentos) são só os conhecidos', () => {
    const proprios = arquivos.filter((f) => importa(f, ler(f), POSTGRES_PROPRIO, 'novoPostgres'));
    expect(proprios).toEqual(CLUSTER_PROPRIO);
  });
});

describe('a guarda de DDL funciona (controle positivo)', () => {
  const arquivo = 'src/modules/exemplo/exemplo.test.ts';
  const comImport = (corpo: string) => `import { bancoProprioParaDdl } from '../../../test/ddl';\n${corpo}`;

  it('acusa DDL em tabela real sem o import de test/ddl', () => {
    const texto = `await client.query('drop policy staff_only on patient_tags');`;
    expect(violacaoDdl(arquivo, texto)).toEqual({ arquivo, tabelas: ['patient_tags'] });
  });

  it('reconhece cada forma de DDL (multilinha, gatilho, alter, lock, nome interpolado)', () => {
    const texto = `
      await client.query(\`create policy paciente_conteudo_visivel on contents as restrictive for select
        using (true)\`);
      await client.query('ALTER POLICY x ON public.recipes USING (true)');
      await client.query('drop trigger audit_row_change on patients');
      await client.query('create or replace trigger t before insert or update on "exams" for each row execute function f()');
      await client.query('alter table appointments disable trigger all');
      await client.query('LOCK TABLE ONLY anthropometry IN ACCESS EXCLUSIVE MODE');
      await client.query(\`alter table \${tabela} enable row level security\`);
    `;
    expect(tabelasComDdl(texto)).toEqual(
      ['${tabela}', 'anthropometry', 'appointments', 'contents', 'exams', 'patients', 'recipes'].sort(),
    );
    expect(violacaoDdl(arquivo, texto)?.tabelas).toHaveLength(7);
  });

  it('não acusa com o import certo, em tmp_*, em comentário nem com cluster próprio', () => {
    const ddl = `await client.query('drop policy publico_sem_update on appointments');`;
    expect(violacaoDdl(arquivo, comImport(ddl))).toBeNull();
    expect(violacaoDdl(arquivo, `await c.query('create table tmp_x (id int)'); await c.query('drop policy p on tmp_x');`)).toBeNull();
    expect(violacaoDdl(arquivo, `// drop policy p on exams\n/* alter table patients add x int */`)).toBeNull();
    expect(violacaoDdl(arquivo, `import { novoPostgres } from '../../../test/postgres-teste';\n${ddl}`)).toBeNull();
  });

  it('acusa o import de outro lugar ou de outro nome', () => {
    const ddl = `await client.query('drop trigger audit_row_change on patients');`;
    expect(violacaoDdl(arquivo, `import { bancoProprioParaDdl } from './ddl';\n${ddl}`)).not.toBeNull();
    expect(violacaoDdl(arquivo, `import { makeDb } from '../../../test/db';\n${ddl}`)).not.toBeNull();
    expect(violacaoDdl(arquivo, `import { outraCoisa } from '../../../test/ddl';\n${ddl}`)).not.toBeNull();
  });
});
