import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plano 18 (RN-282, D19): de `patient_cadastro`, a IA só lê o nome social, só para a máscara e sempre por projeção. Em
 * `src/modules/ia/**` (fora de testes), toda menção a `patientCadastro` é: a linha de `import` do schema, ou a consulta
 * `.select({ nomeSocial: patientCadastro.nomeSocial }).from(patientCadastro).where(eq(patientCadastro.patientId, …))`.
 * Pega `select().from(patientCadastro)`, join da linha inteira e qualquer outra coluna. O nome da tabela em SQL cru
 * (`patient_cadastro`) não aparece em código.
 */
const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const IMPORT_DO_SCHEMA = /import\s*(?:type\s*)?\{[^}]*\}\s*from\s*'@\/db\/schema(?:\/[^']*)?';?/g;
const CONSULTA_PERMITIDA =
  /\.select\(\s*\{\s*nomeSocial:\s*patientCadastro\.nomeSocial\s*\}\s*\)\s*\.from\(\s*patientCadastro\s*\)\s*\.where\(\s*eq\(\s*patientCadastro\.patientId\s*,\s*[\w.]+\s*\)\s*\)/g;

/** As menções a `patientCadastro` (e a `patient_cadastro`) que sobram depois de tirar as formas permitidas. */
function mencoesProibidas(codigo: string): string[] {
  const resto = semComentarios(codigo).replace(IMPORT_DO_SCHEMA, '').replace(CONSULTA_PERMITIDA, '');
  return [...resto.matchAll(/\bpatientCadastro\b[\w.]*|\bpatient_cadastro\b/g)].map((m) => m[0]);
}

const fontesDaIa = (): string[] =>
  readdirSync(path.resolve('src/modules/ia'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)).split(path.sep).join('/'));

describe('RN-282: patient_cadastro na IA só pela projeção do nome social', () => {
  it('nenhum arquivo de src/modules/ia lê outra coluna nem a linha inteira de patient_cadastro', () => {
    const fontes = fontesDaIa();
    expect(fontes.length).toBeGreaterThan(50);
    const violacoes = fontes.flatMap((f) => mencoesProibidas(readFileSync(f, 'utf8')).map((m) => `${f}: ${m}`));
    expect(violacoes).toEqual([]);
  });

  it('controle positivo: só src/modules/ia/nome-social.ts menciona patientCadastro (a consulta permitida)', () => {
    const mencionam = fontesDaIa().filter((f) => /\bpatientCadastro\b/.test(semComentarios(readFileSync(f, 'utf8'))));
    expect(mencionam).toEqual(['src/modules/ia/nome-social.ts']);
    expect(semComentarios(readFileSync('src/modules/ia/nome-social.ts', 'utf8'))).toMatch(CONSULTA_PERMITIDA);
  });

  it('a guarda reconhece as formas proibidas (não passa por não casar nada)', () => {
    const ok = [
      "import { patientCadastro } from '@/db/schema';",
      "import { patients, patientCadastro, type PatientRow } from '@/db/schema';",
      'const [c] = await tx.select({ nomeSocial: patientCadastro.nomeSocial }).from(patientCadastro).where(eq(patientCadastro.patientId, patientId));',
      // comentário não conta: patientCadastro.cpf
    ];
    for (const amostra of ok) expect(mencoesProibidas(amostra), amostra).toEqual([]);
    const proibidas = [
      'await tx.select().from(patientCadastro).where(eq(patientCadastro.patientId, id));',
      'await tx.select({ cpf: patientCadastro.cpf }).from(patientCadastro);',
      'await tx.select({ nomeSocial: patientCadastro.nomeSocial, cep: patientCadastro.cep }).from(patientCadastro);',
      'await tx.select().from(patients).leftJoin(patientCadastro, eq(patientCadastro.patientId, patients.id));',
      'await tx.select({ nomeSocial: patientCadastro.nomeSocial }).from(patients).innerJoin(patientCadastro, eq(patientCadastro.patientId, patients.id));',
      'await tx.query.patientCadastro.findFirst();',
      'await tx.execute(sql`select * from patient_cadastro`);',
      'const c = patientCadastro;',
    ];
    for (const amostra of proibidas) expect(mencoesProibidas(amostra).length, amostra).toBeGreaterThan(0);
  });

  it('nome-social-worker.ts (abre o contexto worker sozinho) só é importado pelo contexto da IA Nutri', () => {
    const importa = /from\s+'(?:@\/modules\/ia|\.\.?)\/(?:[\w-]+\/)*nome-social-worker'|import\(\s*'[^']*nome-social-worker'/;
    const todos = readdirSync(path.resolve('src'), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
      .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)).split(path.sep).join('/'));
    expect(todos.filter((f) => importa.test(readFileSync(f, 'utf8')))).toEqual(['src/modules/ia/nutri-paciente/contexto.ts']);
  });
});
