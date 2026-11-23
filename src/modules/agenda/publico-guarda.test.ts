import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Plano 23 (RN-406, CS-401, R-401): o contexto `publico` (página pública, link da consulta, horários livres) nunca lê a
 * linha inteira de `appointments` (o `link_online` é a sala copiada do local) nem toca `locais_atendimento` (só pelas
 * projeções SQL, sem a sala). Por AST, não por texto: no arquivo inteiro haveria falso positivo (`lerConsultaParaEscrita`,
 * `abrirLinkConsulta` e outras leituras da equipe ou do próprio paciente usam `select()` sem colunas fora do `publico`).
 *
 * Alcance: em `src/modules/agenda/**`, cada função passada a `withTenant` com o papel `publico` — o literal `role: 'publico'`
 * no contexto ou uma função do mesmo arquivo que o devolve (`comoPublico`) — e, por chamada direta pelo nome, as funções
 * que ela chama no mesmo arquivo e nos arquivos de `src/modules/agenda` que ele importa (`gravarPedido`, `horariosLivres`,
 * `lerRegras`…). Recusa: `.select()` sem argumento seguido de `.from(appointments)` e qualquer referência a
 * `locaisAtendimento`.
 */

const PASTA = path.resolve('src/modules/agenda');

type Fonte = { arquivo: string; sf: ts.SourceFile };
type Achado = { arquivo: string; funcao: string; motivo: string };

const ler = (arquivo: string, texto?: string): Fonte => ({ arquivo, sf: ts.createSourceFile(arquivo, texto ?? readFileSync(arquivo, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) });

/** Funções de topo pelo nome: `function f() {}` e `const f = (…) => …` / `function (…)`. */
function funcoesDeTopo(f: Fonte): Map<string, ts.Node> {
  const m = new Map<string, ts.Node>();
  for (const st of f.sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) m.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) m.set(d.name.text, d.initializer);
      }
    }
  }
  return m;
}

/** `import { a, b as c } from './x'` (só relativos, dentro de src/modules/agenda) → nome local → { arquivo, nome exportado }. */
function importsDaAgenda(f: Fonte): Map<string, { arquivo: string; nome: string }> {
  const m = new Map<string, { arquivo: string; nome: string }>();
  for (const st of f.sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith('./')) continue;
    const alvo = path.resolve(path.dirname(f.arquivo), `${st.moduleSpecifier.text}.ts`);
    const nomes = st.importClause?.namedBindings;
    if (!nomes || !ts.isNamedImports(nomes)) continue;
    for (const e of nomes.elements) m.set(e.name.text, { arquivo: alvo, nome: (e.propertyName ?? e.name).text });
  }
  return m;
}

const ehPublico = (n: ts.Node): boolean => {
  let achou = false;
  const ver = (x: ts.Node): void => {
    if (ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === 'role' && ts.isStringLiteralLike(x.initializer) && x.initializer.text === 'publico') achou = true;
    ts.forEachChild(x, ver);
  };
  ver(n);
  return achou;
};

/** O contexto do `withTenant` é do `publico`: literal com `role: 'publico'` ou chamada de função do arquivo que o devolve. */
function contextoPublico(arg: ts.Expression, topo: Map<string, ts.Node>): boolean {
  if (ehPublico(arg)) return true;
  if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
    const f = topo.get(arg.expression.text);
    return !!f && ehPublico(f);
  }
  return false;
}

/** O que a função faz de proibido, direto no corpo; e os nomes que ela chama (para seguir). */
function examinar(corpo: ts.Node): { motivos: string[]; chamadas: string[] } {
  const motivos: string[] = [];
  const chamadas: string[] = [];
  const ver = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === 'locaisAtendimento') motivos.push('referência a locaisAtendimento');
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression)) chamadas.push(n.expression.text);
      // x.select().from(appointments): a chamada de fora é `.from(...)` sobre `x.select()` sem argumento
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'from' && ts.isCallExpression(callee.expression)) {
        const sel = callee.expression;
        const alvo = n.arguments[0];
        if (ts.isPropertyAccessExpression(sel.expression) && sel.expression.name.text === 'select' && sel.arguments.length === 0 && alvo && ts.isIdentifier(alvo) && alvo.text === 'appointments') {
          motivos.push('select() sem colunas em appointments');
        }
      }
    }
    ts.forEachChild(n, ver);
  };
  ver(corpo);
  return { motivos, chamadas };
}

/** Os achados de um conjunto de fontes (o `extras` substitui a leitura do disco: controle positivo). */
function violacoesDoPublico(arquivos: string[], extras: Record<string, string> = {}): { achados: Achado[]; examinadas: string[] } {
  const cache = new Map<string, Fonte>();
  const fonte = (a: string) => {
    let f = cache.get(a);
    if (!f) cache.set(a, (f = ler(a, extras[a])));
    return f;
  };
  const achados: Achado[] = [];
  const examinadas: string[] = [];
  const visitadas = new Set<ts.Node>();
  const seguir = (f: Fonte, corpo: ts.Node, nome: string): void => {
    if (visitadas.has(corpo)) return;
    visitadas.add(corpo);
    examinadas.push(`${path.basename(f.arquivo)}:${nome}`);
    const r = examinar(corpo);
    for (const motivo of r.motivos) achados.push({ arquivo: path.relative(PASTA, f.arquivo), funcao: nome, motivo });
    const topo = funcoesDeTopo(f);
    const imps = importsDaAgenda(f);
    for (const c of new Set(r.chamadas)) {
      const local = topo.get(c);
      if (local) seguir(f, local, c);
      const imp = imps.get(c);
      if (imp && (imp.arquivo in extras || imp.arquivo.startsWith(PASTA + path.sep))) {
        const alvo = funcoesDeTopo(fonte(imp.arquivo)).get(imp.nome);
        if (alvo) seguir(fonte(imp.arquivo), alvo, imp.nome);
      }
    }
  };
  for (const a of arquivos) {
    const f = fonte(a);
    const topo = funcoesDeTopo(f);
    const ver = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'withTenant' && n.arguments.length >= 2 && contextoPublico(n.arguments[0], topo)) {
        const fn = n.arguments[1];
        if (ts.isIdentifier(fn)) {
          const alvo = topo.get(fn.text);
          if (alvo) seguir(f, alvo, fn.text);
        } else {
          seguir(f, fn, `withTenant(publico)@${f.sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(n, ver);
    };
    ver(f.sf);
  }
  return { achados, examinadas };
}

const fontesDaAgenda = () =>
  readdirSync(PASTA, { recursive: true, encoding: 'utf8' })
    .filter((a) => /\.tsx?$/.test(a) && !/\.test\.tsx?$/.test(a))
    .map((a) => path.join(PASTA, a));

describe('guarda do contexto publico (Plano 23: RN-406, CS-401)', () => {
  it('nenhuma função do publico em src/modules/agenda lê appointments sem colunas nem toca locaisAtendimento', () => {
    const { achados, examinadas } = violacoesDoPublico(fontesDaAgenda());
    expect(achados).toEqual([]);
    // a guarda alcança o que importa (senão passaria em branco): a página pública, o link e os horários livres
    for (const nome of ['gravarPedido', 'gravarConsultaDoPaciente', 'lerRegras', 'lerBloqueios', 'locaisParaAgendamento']) {
      expect(examinadas.some((e) => e.endsWith(`:${nome}`)), nome).toBe(true);
    }
    for (const arquivo of ['consultas.ts', 'acoes-link.ts', 'agendamento-publico.ts']) {
      expect(examinadas.some((e) => e.startsWith(`${arquivo}:withTenant(publico)@`)), arquivo).toBe(true);
    }
  });

  it('controle positivo: acusa o select() sem colunas, a tabela de locais e a função do mesmo arquivo; ignora outro papel', () => {
    const sintetico = path.join(PASTA, '__sintetico__.ts');
    const auxiliar = path.join(PASTA, '__auxiliar__.ts');
    const texto = `
      import { lerSala } from './__auxiliar__';
      const comoPublico = (t) => ({ tenantId: t.id, role: 'publico' });
      async function lerTudo(tx) { return tx.select().from(appointments); }
      export const a = () => withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.select().from(appointments));
      export const b = (t) => withTenant(comoPublico(t), (tx) => lerTudo(tx));
      export const c = (t) => withTenant(comoPublico(t), (tx) => lerSala(tx));
      export const d = () => withTenant({ tenantId: 'x', role: 'nutri' }, (tx) => tx.select().from(appointments));
      export const e = () => withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.select({ id: appointments.id }).from(appointments));
    `;
    const aux = `export async function lerSala(tx) { return tx.select({ s: locaisAtendimento.linkSala }).from(locaisAtendimento); }`;
    const { achados } = violacoesDoPublico([sintetico], { [sintetico]: texto, [auxiliar]: aux });
    expect(achados.map((x) => `${x.arquivo}:${x.funcao}:${x.motivo}`).sort()).toEqual(
      [
        '__auxiliar__.ts:lerSala:referência a locaisAtendimento',
        '__auxiliar__.ts:lerSala:referência a locaisAtendimento',
        '__sintetico__.ts:lerTudo:select() sem colunas em appointments',
        '__sintetico__.ts:withTenant(publico)@5:select() sem colunas em appointments',
      ].sort(),
    );
  });
});
