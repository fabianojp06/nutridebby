import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { caminhoAte, fontesDe, grafoDeImports } from '../../../test/grafo-de-imports';
import { CATEGORIAS, CATEGORIAS_DA_IA_NUTRI, CATEGORIAS_POR_USO, FRASE_DA_CATEGORIA, FRASE_DA_CATEGORIA_IA_NUTRI } from '@/modules/ia/campos-enviados';

/**
 * Plano 22 (T5b, RN-399, C-373, EP-D37, EP-D62; I4 da revisão do plano): **sem IA nova**. A nota de interpretação e as
 * versões anteriores do exame nunca ficam ao alcance de um contexto de IA — nem por import direto, nem por um caminho
 * indireto (`ia/conferencia.ts` → `pacientes/exames.ts` → …), nem por um `import { abrirExame }` futuro num montador de
 * contexto. A guarda anda o grafo de imports em tempo de execução (`import type` não conta) a partir de cada fonte de
 * `src/modules/ia/**` e confere o **texto** de cada arquivo alcançado (o schema fica de fora: ele declara todas as tabelas).
 */
const rel = (f: string) => path.relative(process.cwd(), f).split(path.sep).join('/');
const DA_IA = fontesDe('src/modules/ia');
const TERMOS_PROIBIDOS = ['examInterpretacoes', 'examVersoes', 'exam_interpretacoes', 'exam_versoes'];
const ARQUIVOS_PROIBIDOS = ['src/modules/exames/interpretacao.ts', 'src/modules/exames/edicao.ts', 'src/modules/exames/detalhe.ts'];

describe('RN-399: nada alcançável a partir de src/modules/ia/** lê a nota nem as versões do exame', () => {
  const g = grafoDeImports(DA_IA);

  it('o grafo anda de verdade (a conferência alcança pacientes/exames.ts; há raízes da IA Nutri)', () => {
    expect(DA_IA.length).toBeGreaterThan(40);
    expect(DA_IA.some((f) => rel(f).startsWith('src/modules/ia/nutri-paciente/'))).toBe(true);
    expect(g.arquivos.has('src/modules/ia/conferencia.ts')).toBe(true);
    expect(g.arquivos.has('src/modules/pacientes/exames.ts'), 'controle positivo: ia/conferencia.ts importa pacientes/exames.ts').toBe(true);
  });

  it('nenhum arquivo alcançado (fora de src/db/schema/**) contém examInterpretacoes, examVersoes, exam_interpretacoes ou exam_versoes', () => {
    const achados: string[] = [];
    for (const arquivo of g.arquivos.keys()) {
      const r = arquivo.split(path.sep).join('/');
      if (r.startsWith('src/db/schema/')) continue;
      const texto = readFileSync(arquivo, 'utf8');
      for (const t of TERMOS_PROIBIDOS) if (texto.includes(t)) achados.push(`${r} contém ${t} (caminho: ${caminhoAte(g, arquivo).join(' → ')})`);
    }
    expect(achados).toEqual([]);
  });

  it('nenhum arquivo alcançado é exames/interpretacao.ts, exames/edicao.ts ou exames/detalhe.ts', () => {
    for (const proibido of ARQUIVOS_PROIBIDOS) {
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
  });

  it('a guarda pega o caminho indireto: um arquivo que importa a nota, partindo da IA, seria acusado', () => {
    // controle positivo do mesmo algoritmo, com a raiz que a IA alcançaria se `resumo-dados.ts` importasse `abrirExame`
    const comDetalhe = grafoDeImports([...DA_IA, 'src/modules/exames/detalhe.ts']);
    expect(comDetalhe.arquivos.has('src/modules/exames/detalhe.ts')).toBe(true);
    expect(readFileSync('src/modules/exames/detalhe.ts', 'utf8')).toContain('examInterpretacoes');
  });
});

/** Especificadores importados em tempo de execução por um arquivo e os nomes trazidos de cada um (`import type` não conta). */
function importsDe(arquivo: string): { de: string; nomes: string[] }[] {
  const sf = ts.createSourceFile(arquivo, readFileSync(arquivo, 'utf8'), ts.ScriptTarget.Latest, false, /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { de: string; nomes: string[] }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !n.importClause?.isTypeOnly) {
      const ligacoes = n.importClause?.namedBindings;
      const nomes =
        ligacoes && ts.isNamedImports(ligacoes)
          ? ligacoes.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text)
          : ligacoes && ts.isNamespaceImport(ligacoes)
            ? ['*']
            : [];
      out.push({ de: n.moduleSpecifier.text, nomes });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) {
      out.push({ de: n.moduleSpecifier.text, nomes: ['*'] });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
      out.push({ de: n.arguments[0].text, nomes: ['*'] });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return out;
}

describe('RN-399: a IA Nutri do paciente não lê exames (a política nova deixa a sessão de paciente ler o exame liberado)', () => {
  const doNutriPaciente = fontesDe('src/modules/ia/nutri-paciente');
  const SCHEMA = /^(?:@\/db\/schema|(?:\.\.\/)+(?:db\/)?schema)(?:\/index)?$/;

  it('nenhum arquivo não-teste importa exams de @/db/schema (nem o schema inteiro) nem @/modules/portal/exames-liberados', () => {
    expect(doNutriPaciente.length).toBeGreaterThan(10);
    const achados: string[] = [];
    for (const f of doNutriPaciente) {
      for (const i of importsDe(f)) {
        if (SCHEMA.test(i.de) && (i.nomes.includes('exams') || i.nomes.includes('*'))) achados.push(`${rel(f)}: ${i.nomes.join(', ')} de ${i.de}`);
        if (/(?:^@\/modules\/portal|\/portal)\/exames-liberados$/.test(i.de)) achados.push(`${rel(f)}: ${i.de}`);
      }
    }
    expect(achados).toEqual([]);
  });

  it('a leitura dos imports reconhece as formas proibidas (o teste não passa por não casar nada)', () => {
    const tmp = (codigo: string) => {
      const sf = ts.createSourceFile('x.ts', codigo, ts.ScriptTarget.Latest);
      const d = sf.statements[0] as ts.ImportDeclaration;
      const ligacoes = d.importClause?.namedBindings;
      return ligacoes && ts.isNamedImports(ligacoes) ? ligacoes.elements.map((e) => (e.propertyName ?? e.name).text) : ['*'];
    };
    expect(SCHEMA.test('@/db/schema')).toBe(true);
    expect(tmp("import { exams as e, patients } from '@/db/schema';")).toContain('exams');
    expect(SCHEMA.test('@/db/schema/pacientes')).toBe(false);
  });
});

describe('RN-399: campos-enviados.ts sem mudança (o que sai para a IA é o de hoje)', () => {
  it('as categorias, os usos e as frases continuam as de antes do Plano 22', () => {
    expect(CATEGORIAS).toEqual(['idade', 'sexo', 'medidas', 'gasto', 'exames', 'anamnese', 'orientacoes', 'plano', 'diario', 'notas', 'metas', 'perguntas']);
    expect(CATEGORIAS_POR_USO).toEqual({
      resumo_historico: ['idade', 'sexo', 'medidas', 'gasto', 'exames', 'anamnese', 'orientacoes', 'plano', 'diario', 'notas'],
      rascunho_plano: ['idade', 'sexo', 'anamnese', 'metas'],
    });
    expect(CATEGORIAS_DA_IA_NUTRI).toEqual(['plano', 'orientacoes', 'perguntas']);
    expect(FRASE_DA_CATEGORIA_IA_NUTRI).toEqual({ plano: 'o seu plano publicado', orientacoes: 'as orientações dos últimos atendimentos', perguntas: 'o que você escrever nas perguntas' });
    expect(Object.keys(FRASE_DA_CATEGORIA)).toEqual([...CATEGORIAS]);
    expect(FRASE_DA_CATEGORIA.exames).toBe('exames');
  });
});

describe('RNF-377: nada de exame no service worker do portal', () => {
  it('src/app/sw.ts não cita /p/exames', () => {
    expect(readFileSync('src/app/sw.ts', 'utf8')).not.toContain('/p/exames');
  });
});
