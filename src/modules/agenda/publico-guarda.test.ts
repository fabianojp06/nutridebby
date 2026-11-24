import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Plano 23 (RN-406, CS-401, R-401): o contexto `publico` (página pública, link da consulta, horários livres) nunca lê o
 * link da sala — nem a linha inteira de `appointments` (o `link_online` é a sala copiada do local), nem `locais_atendimento`
 * (só pelas projeções SQL, sem a sala). Por AST, não por texto: no arquivo inteiro haveria falso positivo
 * (`lerConsultaParaEscrita`, `abrirLinkConsulta` e as leituras da equipe usam `select()` sem colunas fora do `publico`).
 *
 * Alcance: em `src/modules/agenda/**`, cada função passada a `withTenant` com o papel `publico` — o literal `role: 'publico'`,
 * uma constante do arquivo que o guarda (`const ctx = { role: 'publico' }`) ou uma função do arquivo que o devolve
 * (`comoPublico`) — e, por chamada direta pelo nome, as funções que ela chama no mesmo arquivo e nos arquivos importados de
 * `./…` e de `@/modules/…` (`gravarPedido`, `gravarConsultaDoPaciente`, `agendarLembretes`, `lerRegras`…).
 *
 * Recusa, nessas funções:
 * - `.select()` sem argumento seguido de `.from(appointments)`;
 * - `.returning()` sem argumento numa cadeia com `.insert`/`.update`/`.delete` de `appointments` (devolveria o link copiado);
 * - qualquer referência à tabela `locaisAtendimento`;
 * - acesso à propriedade `linkOnline` ou `linkSala` (`appointments.linkOnline`, `l.linkSala`…);
 * - texto SQL (template `sql`, `sql.raw`, string) com `link_online`, `link_sala` ou `locais_atendimento`.
 * As tabelas são reconhecidas também por alias (`import { appointments as ap }`) e por namespace (`import * as s from
 * '@/db/schema'`).
 *
 * Limites (o que a guarda não vê): chamada por referência (função passada como valor e chamada em outro arquivo), método de
 * objeto, reexportação (`export … from`), import de fora de `src/modules` (ex.: `@/db`, `@/lib`) e SQL montado por
 * concatenação de variáveis. O banco é a primeira defesa (`staff_only`/`publico_negado`, projeções sem a sala).
 */

const RAIZ = path.resolve('.');
const PASTA = path.resolve('src/modules/agenda');
const SCHEMA = '@/db/schema';
const TABELA_DA_CONSULTA = 'appointments';
const TABELA_DOS_LOCAIS = 'locaisAtendimento';
const COLUNAS_DO_LINK = new Set(['linkOnline', 'linkSala']);
const SQL_DO_LINK = /link_online|link_sala|locais_atendimento/;

type Fonte = { arquivo: string; sf: ts.SourceFile };
type Achado = { arquivo: string; funcao: string; motivo: string };
/** Nome local → nome exportado em `@/db/schema` (aliases), e os namespaces do schema. */
type Schema = { nomes: Map<string, string>; namespaces: Set<string> };

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

/** Os `const x = …` do arquivo (em qualquer nível), pelo nome: o contexto guardado numa constante. */
function constantes(f: Fonte): Map<string, ts.Expression[]> {
  const m = new Map<string, ts.Expression[]>();
  const ver = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) m.set(n.name.text, [...(m.get(n.name.text) ?? []), n.initializer]);
    ts.forEachChild(n, ver);
  };
  ver(f.sf);
  return m;
}

function schemaDe(f: Fonte): Schema {
  const s: Schema = { nomes: new Map(), namespaces: new Set() };
  for (const st of f.sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !(st.moduleSpecifier.text === SCHEMA || st.moduleSpecifier.text.startsWith(`${SCHEMA}/`))) continue;
    const b = st.importClause?.namedBindings;
    if (b && ts.isNamespaceImport(b)) s.namespaces.add(b.name.text);
    if (b && ts.isNamedImports(b)) for (const e of b.elements) s.nomes.set(e.name.text, (e.propertyName ?? e.name).text);
  }
  return s;
}

/** Arquivo de um especificador seguido pela guarda (`./…` e `@/modules/…`), ou null. */
function resolver(spec: string, de: string, extras: Record<string, string>): string | null {
  const base = spec.startsWith('./') || spec.startsWith('../') ? path.resolve(path.dirname(de), spec) : spec.startsWith('@/modules/') ? path.join(RAIZ, 'src', spec.slice(2)) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, path.join(base, 'index.ts')]) if (c in extras || existsSync(c)) return c;
  return null;
}

/** `import { a, b as c } from '…'` → nome local → { arquivo, nome exportado }, só dos imports que a guarda segue. */
function importsSeguidos(f: Fonte, extras: Record<string, string>): Map<string, { arquivo: string; nome: string }> {
  const m = new Map<string, { arquivo: string; nome: string }>();
  for (const st of f.sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const alvo = resolver(st.moduleSpecifier.text, f.arquivo, extras);
    const nomes = st.importClause?.namedBindings;
    if (!alvo || !nomes || !ts.isNamedImports(nomes)) continue;
    for (const e of nomes.elements) m.set(e.name.text, { arquivo: alvo, nome: (e.propertyName ?? e.name).text });
  }
  return m;
}

const ehPublico = (n: ts.Node): boolean => {
  let achou = false;
  const ver = (x: ts.Node): void => {
    if (ts.isPropertyAssignment(x) && (ts.isIdentifier(x.name) || ts.isStringLiteral(x.name)) && x.name.text === 'role' && ts.isStringLiteralLike(x.initializer) && x.initializer.text === 'publico') achou = true;
    ts.forEachChild(x, ver);
  };
  ver(n);
  return achou;
};

/** O contexto do `withTenant` é do `publico`: literal, constante do arquivo que o guarda ou função do arquivo que o devolve. */
function contextoPublico(arg: ts.Expression, topo: Map<string, ts.Node>, consts: Map<string, ts.Expression[]>): boolean {
  if (ehPublico(arg)) return true;
  if (ts.isIdentifier(arg)) return (consts.get(arg.text) ?? []).some((v) => contextoPublico(v, topo, new Map()));
  if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
    const f = topo.get(arg.expression.text);
    return !!f && ehPublico(f);
  }
  return false;
}

/** A expressão é a tabela `nome` do schema (pelo nome, por alias ou por namespace). */
function ehTabela(e: ts.Node | undefined, nome: string, s: Schema): boolean {
  if (!e) return false;
  if (ts.isIdentifier(e)) return s.nomes.get(e.text) === nome;
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && s.namespaces.has(e.expression.text) && e.name.text === nome;
}

/** As chamadas `.metodo(args)` da cadeia `a.b(…).c(…)…` que termina em `n` (de dentro para fora). */
function cadeia(n: ts.Expression): { metodo: string; args: readonly ts.Expression[] }[] {
  const out: { metodo: string; args: readonly ts.Expression[] }[] = [];
  let e: ts.Expression = n;
  while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    out.unshift({ metodo: e.expression.name.text, args: e.arguments });
    e = e.expression.expression;
  }
  return out;
}

/** O que a função faz de proibido, direto no corpo; e os nomes que ela chama (para seguir). */
function examinar(corpo: ts.Node, s: Schema): { motivos: string[]; chamadas: string[] } {
  const motivos: string[] = [];
  const chamadas: string[] = [];
  const ver = (n: ts.Node): void => {
    if ((ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) && ehTabela(n, TABELA_DOS_LOCAIS, s) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      motivos.push('referência a locaisAtendimento');
    }
    if (ts.isPropertyAccessExpression(n) && COLUNAS_DO_LINK.has(n.name.text)) motivos.push(`acesso a ${n.name.text}`);
    if ((ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && SQL_DO_LINK.test(n.text)) motivos.push('SQL com o link ou a tabela de locais');
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression)) chamadas.push(n.expression.text);
      const c = cadeia(n);
      const ultimo = c.at(-1);
      // x.select().from(appointments)
      if (ultimo?.metodo === 'from' && ehTabela(ultimo.args[0], TABELA_DA_CONSULTA, s) && c.at(-2)?.metodo === 'select' && c.at(-2)!.args.length === 0) {
        motivos.push('select() sem colunas em appointments');
      }
      // x.insert(appointments)….returning()
      if (ultimo?.metodo === 'returning' && ultimo.args.length === 0 && c.some((x) => ['insert', 'update', 'delete'].includes(x.metodo) && ehTabela(x.args[0], TABELA_DA_CONSULTA, s))) {
        motivos.push('returning() sem colunas em appointments');
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
  const nomeDe = (a: string) => path.relative(PASTA, a);
  const seguir = (f: Fonte, corpo: ts.Node, nome: string): void => {
    if (visitadas.has(corpo)) return;
    visitadas.add(corpo);
    examinadas.push(`${nomeDe(f.arquivo)}:${nome}`);
    const r = examinar(corpo, schemaDe(f));
    for (const motivo of r.motivos) achados.push({ arquivo: nomeDe(f.arquivo), funcao: nome, motivo });
    const topo = funcoesDeTopo(f);
    const imps = importsSeguidos(f, extras);
    for (const c of new Set(r.chamadas)) {
      const local = topo.get(c);
      if (local) seguir(f, local, c);
      const imp = imps.get(c);
      if (imp) {
        const alvo = funcoesDeTopo(fonte(imp.arquivo)).get(imp.nome);
        if (alvo) seguir(fonte(imp.arquivo), alvo, imp.nome);
      }
    }
  };
  for (const a of arquivos) {
    const f = fonte(a);
    const topo = funcoesDeTopo(f);
    const consts = constantes(f);
    const ver = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'withTenant' && n.arguments.length >= 2 && contextoPublico(n.arguments[0], topo, consts)) {
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
  it('nenhuma função do publico (em src/modules/agenda e no que ela chama) lê o link da sala, a linha inteira de appointments ou a tabela de locais', () => {
    const { achados, examinadas } = violacoesDoPublico(fontesDaAgenda());
    expect(achados).toEqual([]);
    // a guarda alcança o que importa (senão passaria em branco): a página pública, o link, os horários livres e o que eles chamam
    for (const nome of ['gravarPedido', 'gravarConsultaDoPaciente', 'lerRegras', 'lerBloqueios', 'locaisParaAgendamento', 'agendarLembretes', 'avisarPaciente', 'dispararEnvio']) {
      expect(examinadas.some((e) => e.endsWith(`:${nome}`)), nome).toBe(true);
    }
    for (const arquivo of ['consultas.ts', 'acoes-link.ts', 'agendamento-publico.ts']) {
      expect(examinadas.some((e) => e.startsWith(`${arquivo}:withTenant(publico)@`)), arquivo).toBe(true);
    }
  });

  it('controle positivo: acusa cada forma de chegar ao link no publico (inclusive por alias, namespace, SQL e constante); ignora outro papel', () => {
    const sintetico = path.join(PASTA, '__sintetico__.ts');
    const auxiliar = path.join(PASTA, '__auxiliar__.ts');
    const externo = path.join(RAIZ, 'src/modules/__externo__.ts');
    const casos: Record<string, string> = {
      a: `withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.select().from(appointments))`,
      b: `withTenant(comoPublico(t), (tx) => lerTudo(tx))`,
      c: `withTenant(comoPublico(t), (tx) => lerSala(tx))`,
      d: `withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.select({ l: appointments.linkOnline }).from(appointments))`,
      e: `withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.select().from(ap))`,
      f: `withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.select().from(schema.appointments))`,
      g: `withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.select({ s: la.linkSala }).from(la))`,
      h: `withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.insert(appointments).values({ tenantId: 'x' }).returning())`,
      i: 'withTenant({ tenantId: \'x\', role: \'publico\' }, (tx) => tx.execute(sql`select link_sala from locais_atendimento`))',
      j: `withTenant(CTX, (tx) => tx.select().from(appointments))`,
      k: `withTenant({ tenantId: 'x', role: 'publico' }, (tx) => lerDeFora(tx))`,
    };
    const linhaDe = (k: string) => 8 + Object.keys(casos).indexOf(k);
    const texto = [
      `import { appointments, appointments as ap, locaisAtendimento as la } from '@/db/schema';`,
      `import * as schema from '@/db/schema';`,
      `import { lerSala } from './__auxiliar__';`,
      `import { lerDeFora } from '@/modules/__externo__';`,
      `const comoPublico = (t) => ({ tenantId: t.id, role: 'publico' });`,
      `const CTX = { tenantId: 'x', role: 'publico' };`,
      `async function lerTudo(tx) { return tx.select().from(appointments); }`,
      ...Object.entries(casos).map(([k, v]) => `export const ${k} = (t) => ${v};`),
      `export const n1 = () => withTenant({ tenantId: 'x', role: 'nutri' }, (tx) => tx.select({ l: appointments.linkOnline }).from(appointments));`,
      `export const n2 = () => withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.select({ id: appointments.id }).from(appointments));`,
      `export const n3 = () => withTenant({ tenantId: 'x', role: 'publico' }, (tx) => tx.insert(appointments).values({ linkOnline: null }).returning({ id: appointments.id }));`,
    ].join('\n');
    const aux = `import { locaisAtendimento } from '@/db/schema';\nexport async function lerSala(tx) { return tx.select({ s: locaisAtendimento.linkSala }).from(locaisAtendimento); }`;
    const ext = `import { appointments } from '@/db/schema';\nexport async function lerDeFora(tx) { return tx.select().from(appointments); }`;
    const { achados } = violacoesDoPublico([sintetico], { [sintetico]: texto, [auxiliar]: aux, [externo]: ext });
    const em = (k: string) => `__sintetico__.ts:withTenant(publico)@${linhaDe(k)}`;
    const vistos = new Set(achados.map((x) => `${x.arquivo}:${x.funcao}:${x.motivo}`));
    const esperados = [
      `${em('a')}:select() sem colunas em appointments`,
      '__sintetico__.ts:lerTudo:select() sem colunas em appointments',
      '__auxiliar__.ts:lerSala:referência a locaisAtendimento',
      '__auxiliar__.ts:lerSala:acesso a linkSala',
      `${em('d')}:acesso a linkOnline`,
      `${em('e')}:select() sem colunas em appointments`,
      `${em('f')}:select() sem colunas em appointments`,
      `${em('g')}:referência a locaisAtendimento`,
      `${em('g')}:acesso a linkSala`,
      `${em('h')}:returning() sem colunas em appointments`,
      `${em('i')}:SQL com o link ou a tabela de locais`,
      `${em('j')}:select() sem colunas em appointments`,
      '../__externo__.ts:lerDeFora:select() sem colunas em appointments',
    ];
    for (const e of esperados) expect(vistos.has(e), e).toBe(true);
    expect([...vistos].sort()).toEqual([...new Set(esperados)].sort()); // nada além: os negativos (n1–n3) não são acusados
  });
});
