import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { getTableColumns } from 'drizzle-orm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { jsonbSeguro, paraJsonbSeguro } from './jsonb-seguro';
import { anamneses } from './schema';

/** O texto JSON que o Postgres recebe, relido: o que de fato chegaria à coluna. */
const gravado = (v: unknown) => JSON.parse(paraJsonbSeguro(v)) as unknown;

/**
 * O que o Postgres recusaria neste texto JSON ao converter para jsonb, como o lexer dele: `\u0000` escapado (22P05),
 * escape de surrogate alto sem um baixo escapado logo depois, baixo escapado sem o alto logo antes (22P02) e surrogate
 * cru sem par. Par válido passa, escapado (`\ud800\udc00`, o par que o NUL separava) ou cru (emoji). `null` = aceito.
 * Os escapes saem da esquerda para a direita, com `\\` consumido inteiro (`\\u0000` é texto). O `JSON.stringify` só
 * escreve `\u` minúsculo, mas o lexer aceita os dois.
 */
function recusaDoJsonb(s: string): string | null {
  if (!s.isWellFormed()) return 'surrogate cru sem par';
  let altoAte = -1; // posição logo depois de um escape de surrogate alto ainda sem o baixo
  for (const m of s.matchAll(/\\u([0-9a-fA-F]{4})|\\[^u]/g)) {
    const c = m[1] === undefined ? -1 : parseInt(m[1], 16);
    const colado = m.index === altoAte;
    if (altoAte >= 0 && !(colado && c >= 0xdc00 && c <= 0xdfff)) return `escape de surrogate alto sem par em ${altoAte}`;
    if (c === 0) return `\\u0000 em ${m.index}`;
    if (c >= 0xdc00 && c <= 0xdfff && !colado) return `escape de surrogate baixo sem par em ${m.index}`;
    altoAte = c >= 0xd800 && c <= 0xdbff ? m.index + m[0].length : -1;
  }
  return altoAte >= 0 ? 'escape de surrogate alto no fim' : null;
}

/**
 * As strings e as chaves do valor relido com NUL ou surrogate sem par. Só depois de `recusaDoJsonb(s) === null`: com
 * escape de surrogate sem par no texto, o `JSON.parse` do V8 (Node 24.21) às vezes erra a chave de 1 caractere (a chave
 * `"\udfff"` volta como `"\\"`, depois de outras chaves já lidas no processo — achado no fuzz, não em caso isolado). O
 * texto aceito pelo `recusaDoJsonb` não tem esse escape, e ali o `JSON.parse` é confiável.
 */
function invalidosNoValor(v: unknown, achados: string[] = []): string[] {
  const ruim = (t: string) => !t.isWellFormed() || t.includes('\u0000');
  if (typeof v === 'string') {
    if (ruim(v)) achados.push(`string ${JSON.stringify(v)}`);
  } else if (Array.isArray(v)) {
    for (const x of v) invalidosNoValor(x, achados);
  } else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (ruim(k)) achados.push(`chave ${JSON.stringify(k)}`);
      invalidosNoValor(x, achados);
    }
  }
  return achados;
}

/** A saída que o banco aceita e que, relida, não tem NUL nem surrogate sem par em string nem chave (vazio = ok). */
function problemasDaSaida(s: string): string[] {
  const recusa = recusaDoJsonb(s);
  return recusa ? [recusa] : invalidosNoValor(JSON.parse(s));
}

describe('paraJsonbSeguro / jsonbSeguro (SUS-121, regra 3)', () => {
  const INVALIDOS = ['\u0000', '\ud800', '\udc00'] as const;

  it.each(INVALIDOS)('tira %j das strings, das chaves, do aninhado e dos arrays; emoji e o resto ficam', (c) => {
    const valor = {
      [`queixa${c}`]: `Dor${c} abdominal 🙂`,
      n: 1.5,
      sim: true,
      nada: null,
      lista: [`a${c}`, 2, [`b${c}`], { [`k${c}`]: `v${c}` }],
      fundo: { mais: { [`x${c}y`]: [`🙂${c}`] } },
    };
    const s = paraJsonbSeguro(valor);
    expect(problemasDaSaida(s)).toEqual([]);
    expect(JSON.parse(s)).toEqual({
      queixa: 'Dor abdominal 🙂',
      n: 1.5,
      sim: true,
      nada: null,
      lista: ['a', 2, ['b'], { k: 'v' }],
      fundo: { mais: { xy: ['🙂'] } },
    });
  });

  it('string solta, número, null, booleano e Date (toJSON) como o JSON.stringify', () => {
    expect(paraJsonbSeguro('a\u0000b\ud800')).toBe('"ab"');
    expect(paraJsonbSeguro(42)).toBe('42');
    expect(paraJsonbSeguro(null)).toBe('null');
    expect(paraJsonbSeguro(false)).toBe('false');
    const d = new Date('2026-11-24T12:00:00Z');
    expect(paraJsonbSeguro(d)).toBe(JSON.stringify(d));
    expect(gravado({ em: d, t: '\u0000x' })).toEqual({ em: '2026-11-24T12:00:00.000Z', t: 'x' });
  });

  it('undefined: some do objeto, vira null no array e, sozinho, segue o JSON.stringify (undefined)', () => {
    expect(gravado({ a: undefined, b: 'x\u0000' })).toEqual({ b: 'x' });
    expect(gravado([undefined, 'y\ud800'])).toEqual([null, 'y']);
    expect(paraJsonbSeguro(undefined)).toBeUndefined();
  });

  it('sem inválido, o texto é exatamente o do JSON.stringify (o jsonb do Drizzle)', () => {
    const v = { a: 'Ferritina 🙂 ↑', b: [1, 'x\\u0000 digitado com barra'], c: { 'chave "aspas"': 'linha\nnova' } };
    expect(paraJsonbSeguro(v)).toBe(JSON.stringify(v));
  });

  it('chave colidindo depois da limpeza: fica uma; `__proto__` digitado continua só uma chave', () => {
    expect(gravado({ 'a\u0000': 1, a: 2 })).toEqual({ a: 2 });
    const comProto = JSON.parse('{"__proto__":{"x":"\\u0000"},"y":"\\ud800"}') as unknown;
    expect(paraJsonbSeguro(comProto)).toBe('{"__proto__":{"x":""},"y":""}');
  });

  it('o NUL entre as metades de um par: o par volta a ser par, como no semInvalidosNoBanco; barra invertida digitada fica', () => {
    expect(gravado({ t: '\ud800\u0000\udc00' })).toEqual({ t: '𐀀' });
    expect(gravado({ t: '\ud800\u0000🙂' })).toEqual({ t: '🙂' });
    expect(gravado({ 'c:\\u0000': 'c:\\ud800 é texto\u0000' })).toEqual({ 'c:\\u0000': 'c:\\ud800 é texto' });
  });

  it('casos de borda dos escapes: alto + alto, NUL + baixo, alto no fim da chave, `\\u0000` digitado, par separado por NUL', () => {
    // dois altos seguidos (os dois escapados): saem os dois; alto antes de um par válido: o par fica
    expect(paraJsonbSeguro({ t: '\ud800\udbff' })).toBe('{"t":""}');
    expect(gravado({ t: 'a\ud800🙂b' })).toEqual({ t: 'a🙂b' });
    expect(gravado({ t: '\udbff𐀀' })).toEqual({ t: '𐀀' });
    // NUL seguido de baixo: os dois saem (o baixo não vira par com nada)
    expect(paraJsonbSeguro({ t: '\u0000\udc00' })).toBe('{"t":""}');
    expect(paraJsonbSeguro({ t: 'x\u0000\udc00\u0000' })).toBe('{"t":"x"}');
    // alto no fim da chave, com o valor começando por baixo: as aspas e os dois-pontos separam, nada vira par
    expect(paraJsonbSeguro({ 'k\ud800': '\udc00v' })).toBe('{"k":"v"}');
    expect(paraJsonbSeguro({ '\ud800': 1 })).toBe('{"":1}');
    // `\u0000` e `\ud800` digitados com a barra (texto), e a barra digitada antes do NUL e do surrogate de verdade
    expect(paraJsonbSeguro({ 'a\\u0000': 'b\\ud800\\udc00' })).toBe(JSON.stringify({ 'a\\u0000': 'b\\ud800\\udc00' }));
    expect(gravado({ t: '\\\u0000', u: '\\\ud800', v: '\\\\\u0000u0000' })).toEqual({ t: '\\', u: '\\', v: '\\\\u0000' });
    // par escrito como dois escapes separados por NUL (também na chave e com vários NUL): volta a ser par
    const saida = paraJsonbSeguro({ '\ud800\u0000\udc00': '\udbff\u0000\u0000\udfff' });
    expect(saida).toBe('{"\\ud800\\udc00":"\\udbff\\udfff"}');
    expect(problemasDaSaida(saida)).toEqual([]);
    expect(JSON.parse(saida)).toEqual({ '𐀀': '\u{10ffff}' });
  });

  it('o verificador da saída recusa o que o Postgres recusaria e aceita o par válido', () => {
    expect(problemasDaSaida('{"t":"\\ud800\\udc00 🙂"}')).toEqual([]);
    expect(problemasDaSaida('{"t":"\\\\u0000 \\\\ud800"}')).toEqual([]);
    expect(problemasDaSaida('{"t":"\\u0000"}')).toEqual(['\\u0000 em 6']);
    expect(problemasDaSaida('{"t":"\\ud800"}')).toEqual(['escape de surrogate alto no fim']);
    expect(problemasDaSaida('{"t":"\\ud800x\\udc00"}')).toEqual(['escape de surrogate alto sem par em 12']);
    expect(problemasDaSaida('{"\\udc00":1}')).toEqual(['escape de surrogate baixo sem par em 2']);
    expect(problemasDaSaida('{"t":"\\ud800\\ud800\\udc00"}')).toEqual(['escape de surrogate alto sem par em 12']);
    expect(problemasDaSaida('{"t":"\\\\\\u0000"}')).toEqual(['\\u0000 em 8']);
    expect(problemasDaSaida('{"t":"\ud800"}')).toEqual(['surrogate cru sem par']);
  });

  /**
   * Propriedade: o mesmo resultado de limpar cada string e chave com o `semInvalidosNoBanco` e serializar, e uma saída
   * que o Postgres aceita. PRNG inteiro (mulberry32, `Math.imul`) com semente fixa — `SEMENTE_JSONB=<n>` troca a semente
   * para explorar; a semente vai em toda mensagem de erro. Os contadores provam que o sorteio de fato passa pelos casos
   * difíceis (o PRNG em float de antes colapsava em `6,0,0,0…` e nunca sorteava o NUL).
   */
  it('propriedade: igual ao semInvalidosNoBanco em cada string e chave, saída aceita pelo jsonb, com cobertura mínima', () => {
    const referencia = (v: unknown): unknown => {
      if (typeof v === 'string') return semInvalidosNoBanco(v);
      if (Array.isArray(v)) return v.map(referencia);
      if (v !== null && typeof v === 'object') {
        const o = Object.create(null) as Record<string, unknown>;
        for (const [k, x] of Object.entries(v)) o[semInvalidosNoBanco(k)] = referencia(x);
        return o;
      }
      return v;
    };
    const SEMENTE = Number(process.env.SEMENTE_JSONB ?? 121);
    let estado = SEMENTE | 0;
    const aleatorio = () => {
      estado = (estado + 0x6d2b79f5) | 0;
      let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const sorteio = (n: number) => Math.floor(aleatorio() * n);
    const PECAS = [
      'a', 'é', '🙂', '\u0000', '\u0000', '\ud800', '\udbff', '\udc00', '\udfff', '\ud83d', '\ude42',
      '\\', '\\u0000', '\\ud800', '"', '\n', '\u0001', 'u0000', 'udc00',
    ];
    const texto = () => Array.from({ length: sorteio(9) }, () => PECAS[sorteio(PECAS.length)]).join('');
    const valor = (fundo: number): unknown => {
      const t = sorteio(fundo > 2 ? 3 : 6);
      if (t === 0) return texto();
      if (t === 1) return sorteio(100) - 50;
      if (t === 2) return sorteio(2) === 0 ? null : true;
      if (t === 3) return Array.from({ length: sorteio(4) }, () => valor(fundo + 1));
      return Object.fromEntries(Array.from({ length: sorteio(4) }, () => [texto(), valor(fundo + 1)]));
    };

    const cobertura = { rapido: 0, lento: 0, altoNulBaixo: 0, altoAlto: 0, nulBaixo: 0, barraU0000: 0, barraNul: 0, nulNaChave: 0, surrogateNaChave: 0, altoNoFimDaChave: 0, parEscapadoNaSaida: 0 };
    const marcar = (t: string, chave: boolean, vistos: Set<keyof typeof cobertura>) => {
      if (/[\ud800-\udbff]\u0000+[\udc00-\udfff]/.test(t)) vistos.add('altoNulBaixo');
      if (/[\ud800-\udbff](?![\udc00-\udfff])[\ud800-\udbff](?![\udc00-\udfff])/.test(t)) vistos.add('altoAlto');
      if (/\u0000[\udc00-\udfff]/.test(t)) vistos.add('nulBaixo');
      if (t.includes('\\u0000')) vistos.add('barraU0000');
      if (t.includes('\\\u0000')) vistos.add('barraNul');
      if (chave && t.includes('\u0000')) vistos.add('nulNaChave');
      if (chave && !t.isWellFormed()) vistos.add('surrogateNaChave');
      if (chave && /[\ud800-\udbff]$/.test(t)) vistos.add('altoNoFimDaChave');
    };
    const percorrer = (v: unknown, vistos: Set<keyof typeof cobertura>): void => {
      if (typeof v === 'string') marcar(v, false, vistos);
      else if (Array.isArray(v)) v.forEach((x) => percorrer(x, vistos));
      else if (v !== null && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          marcar(k, true, vistos);
          percorrer(x, vistos);
        }
    };

    const VALORES = 3000;
    for (let i = 0; i < VALORES; i++) {
      const v = { raiz: valor(0), [texto()]: texto() };
      const onde = `semente ${SEMENTE}, valor ${i}`;
      const s = paraJsonbSeguro(v);
      const esperado = JSON.stringify(referencia(v));
      const vistos = new Set<keyof typeof cobertura>();
      percorrer(v, vistos);
      vistos.add(JSON.stringify(v) === esperado ? 'rapido' : 'lento');
      if (/\\ud[89ab][0-9a-f]{2}\\ud[c-f][0-9a-f]{2}/i.test(s)) vistos.add('parEscapadoNaSaida');
      for (const c of vistos) cobertura[c]++;
      expect(problemasDaSaida(s), `${onde}: ${s}`).toEqual([]);
      // a referência limpa o próprio valor, sem escape de surrogate sem par no texto (o JSON.parse do V8 é confiável ali)
      expect(JSON.parse(s), `${onde}: ${s}`).toEqual(JSON.parse(esperado));
    }
    if (process.env.MEDIR_JSONB) process.stdout.write(`cobertura (semente ${SEMENTE}): ${JSON.stringify(cobertura)}\n`);
    // cobertura mínima: cerca de metade do medido com a semente 121 (24/11/2026: rapido 131, lento 2869, altoNulBaixo 79,
    // altoAlto 598, nulBaixo 519, barraU0000 1499, barraNul 195, nulNaChave 1466, surrogateNaChave 2230, altoNoFimDaChave 723,
    // parEscapadoNaSaida 79); `rapido` = valores sem inválido (a saída rápida, igual ao JSON.stringify)
    const MINIMO: typeof cobertura = {
      rapido: 60,
      lento: 1400,
      altoNulBaixo: 40,
      altoAlto: 300,
      nulBaixo: 250,
      barraU0000: 700,
      barraNul: 90,
      nulNaChave: 700,
      surrogateNaChave: 1100,
      altoNoFimDaChave: 350,
      parEscapadoNaSaida: 40,
    };
    for (const [c, minimo] of Object.entries(MINIMO)) expect(cobertura[c as keyof typeof cobertura], `semente ${SEMENTE}: cobertura de ${c}`).toBeGreaterThanOrEqual(minimo);
  });
  it('a coluna do schema é jsonb e passa pelo paraJsonbSeguro na escrita; a leitura é a do jsonb do Drizzle', () => {
    const col = getTableColumns(anamneses).respostas;
    expect(col.getSQLType()).toBe('jsonb');
    expect(col.mapToDriverValue({ q1: 'x\u0000' })).toBe('{"q1":"x"}');
    expect(col.mapFromDriverValue({ q1: 'x' })).toEqual({ q1: 'x' }); // o pg já devolve objeto
    expect(col.mapFromDriverValue('{"q1":"x"}')).toEqual({ q1: 'x' });
    expect(col.mapFromDriverValue('não é json')).toBe('não é json');
    expect(typeof jsonbSeguro).toBe('function');
  });
});

/**
 * Guarda estática: o schema só declara jsonb pelo `jsonbSeguro`. Um `jsonb(` ou `json(` do `drizzle-orm/pg-core`
 * gravaria o NUL e o surrogate sem par e o 22P02 levaria o texto ao log do Postgres. Fora de `src/db/jsonb-seguro.ts`,
 * nenhum `customType` com `dataType` `'jsonb'`/`'json'` (um tipo próprio importado pelo schema contornaria a guarda).
 */
const RAIZ = path.resolve(__dirname, '../..');
const PASTA_SCHEMA = path.join(RAIZ, 'src/db/schema');
const IMPORT_PG_CORE = /import\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"]drizzle-orm\/pg-core['"]/g;
/** `dataType: () => 'jsonb'`, `dataType() { return "json"; }`… */
const CUSTOM_TYPE_JSON = /\bdataType\b[\s\S]{0,80}?['"`]jsonb?['"`]/;

/** Os motivos pelos quais um arquivo do schema usa o json/jsonb cru (vazio = ok). */
function jsonbCru(fonte: string): string[] {
  const motivos: string[] = [];
  for (const m of fonte.matchAll(IMPORT_PG_CORE)) {
    for (const nome of m[1].matchAll(/(?:^|[\s{,])(jsonb?)(?:\s+as\s+\w+)?\s*(?=[,}])/g)) motivos.push(`importa ${nome[1]} do drizzle-orm/pg-core`);
  }
  // `jsonb(`, `json(`, `pg.jsonb(`; não pega `jsonbSeguro(`, `to_jsonb(`, `row_to_json(` nem `jsonb_typeof(`
  for (const m of fonte.matchAll(/(?<![\w$])(jsonb?)\s*\(/g)) motivos.push(`chama ${m[1]}(`);
  if (CUSTOM_TYPE_JSON.test(fonte)) motivos.push('customType json/jsonb');
  return motivos;
}

describe('guarda: nenhum json/jsonb cru em src/db/schema (SUS-121)', () => {
  it('controle positivo: a guarda pega o import, o alias, o namespace, a chamada e o customType', () => {
    expect(jsonbCru(`import { jsonb, text } from 'drizzle-orm/pg-core';`)).toEqual(['importa jsonb do drizzle-orm/pg-core']);
    expect(jsonbCru(`import {\n  text,\n  jsonb,\n} from "drizzle-orm/pg-core";`)).toEqual(['importa jsonb do drizzle-orm/pg-core']);
    expect(jsonbCru(`import { jsonb as j } from 'drizzle-orm/pg-core';`)).toEqual(['importa jsonb do drizzle-orm/pg-core']);
    expect(jsonbCru(`import { json, text } from 'drizzle-orm/pg-core';`)).toEqual(['importa json do drizzle-orm/pg-core']);
    expect(jsonbCru(`import { text, json as j } from 'drizzle-orm/pg-core';`)).toEqual(['importa json do drizzle-orm/pg-core']);
    expect(jsonbCru(`import * as pg from 'drizzle-orm/pg-core';\nconst c = pg.jsonb('x');`)).toEqual(['chama jsonb(']);
    expect(jsonbCru(`import * as pg from 'drizzle-orm/pg-core';\nconst c = pg.json('x');`)).toEqual(['chama json(']);
    expect(jsonbCru(`x: jsonb ('x')`)).toEqual(['chama jsonb(']);
    expect(jsonbCru(`const t = customType<{ data: unknown }>({ dataType: () => 'jsonb' });`)).toEqual(['customType json/jsonb']);
    expect(jsonbCru(`const t = customType({\n  dataType() {\n    return "json";\n  },\n});`)).toEqual(['customType json/jsonb']);
    // controle negativo
    expect(
      jsonbCru(
        `import { text } from 'drizzle-orm/pg-core';\nx: jsonbSeguro('x'), sql\`jsonb_typeof(\${t}) and to_jsonb(1) and row_to_json(r) and '{}'::jsonb\`, y: customType({ dataType: () => 'bytea' })`,
      ),
    ).toEqual([]);
  });

  it('nenhum arquivo do schema usa o json/jsonb cru', () => {
    // recursivo: o drizzle-kit lê a pasta inteira, também as subpastas (re-revisão do SUS-121, Minor 2)
    const arquivos = readdirSync(PASTA_SCHEMA, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(arquivos.length).toBeGreaterThan(10);
    const violacoes = arquivos.flatMap((f) => jsonbCru(readFileSync(path.join(PASTA_SCHEMA, f), 'utf8')).map((m) => `${f}: ${m}`));
    expect(violacoes).toEqual([]);
    // o schema de fato usa o tipo (a guarda não está olhando uma pasta vazia)
    const usos = arquivos.filter((f) => readFileSync(path.join(PASTA_SCHEMA, f), 'utf8').includes('jsonbSeguro('));
    expect(usos.length).toBeGreaterThanOrEqual(10);
  });

  it('nenhum customType json/jsonb em src/ e scripts/ fora de src/db/jsonb-seguro.ts', () => {
    const PROPRIO = path.join('src', 'db', 'jsonb-seguro.ts');
    expect(CUSTOM_TYPE_JSON.test(readFileSync(path.join(RAIZ, PROPRIO), 'utf8'))).toBe(true); // a regex reconhece o próprio tipo
    const violacoes = [...arquivosFonte('src'), ...arquivosFonte('scripts')]
      .filter((f) => f !== PROPRIO)
      .filter((f) => CUSTOM_TYPE_JSON.test(readFileSync(path.join(RAIZ, f), 'utf8')));
    expect(violacoes).toEqual([]);
  });
});

/**
 * Medição (SUS-121, item 6): custo do `toDriver` num jsonb grande. O plano realista (7 refeições × 10 itens, campos de
 * texto) e um de ~500 KB, sem inválido (saída rápida: só o `JSON.stringify` + um teste de regex) e com um inválido (o
 * valor é relido, limpo e reescrito). `MEDIR_JSONB=1` imprime os números.
 */
describe('medição do paraJsonbSeguro', () => {
  const item = (r: number, i: number, extra: string) => ({
    alimento: `Alimento ${r}.${i} — arroz integral cozido com legumes 🙂${extra}`,
    medida: { texto: '2 colheres de sopa cheias', gramas: 50 + i, caseira: 'colher de sopa' },
    observacao: `Trocar por quinoa se preferir; evitar fritura. Item ${i} da refeição ${r}.`,
    nutrientes: { kcal: 120.5, proteina: 3.2, carboidrato: 25.1, lipidio: 1.1, fibra: 2.4, sodio: 1.2 },
    substituicoes: [
      { alimento: 'Quinoa cozida', medida: '3 colheres de sopa', obs: 'mesma porção' },
      { alimento: 'Batata-doce cozida', medida: '1 unidade pequena', obs: '' },
    ],
  });
  const plano = (refeicoes: number, itens: number, extra = '') => ({
    nome: 'Plano de reeducação alimentar — fase 1',
    orientacoes: 'Beber 2 L de água por dia. '.repeat(20),
    refeicoes: Array.from({ length: refeicoes }, (_, r) => ({
      nome: `Refeição ${r + 1}`,
      horario: '07:30',
      itens: Array.from({ length: itens }, (_, i) => item(r, i, r === 0 && i === 0 ? extra : '')),
    })),
  });

  function medir(v: unknown, vezes: number) {
    for (let i = 0; i < 5; i++) paraJsonbSeguro(v); // aquecimento
    const t: number[] = [];
    for (let i = 0; i < vezes; i++) {
      const a = performance.now();
      paraJsonbSeguro(v);
      t.push(performance.now() - a);
    }
    const base: number[] = [];
    for (let i = 0; i < vezes; i++) {
      const a = performance.now();
      JSON.stringify(v);
      base.push(performance.now() - a);
    }
    const media = (l: number[]) => l.reduce((s, x) => s + x, 0) / l.length;
    return { kb: Math.round(JSON.stringify(v).length / 1024), mediaMs: +media(t).toFixed(3), piorMs: +Math.max(...t).toFixed(3), stringifyMs: +media(base).toFixed(3) };
  }

  it('plano realista e ~500 KB, sem e com inválido', () => {
    const realista = plano(7, 10);
    const grande = plano(7, 145); // ~500 KB
    const r = {
      realista: medir(realista, 200),
      realistaSujo: medir(plano(7, 10, '\ud800'), 200),
      grande: medir(grande, 30),
      grandeSujo: medir(plano(7, 145, '\u0000'), 30),
    };
    if (process.env.MEDIR_JSONB) process.stdout.write(`${JSON.stringify(r)}\n`);
    expect(r.grande.kb).toBeGreaterThan(480);
    expect(problemasDaSaida(paraJsonbSeguro(plano(7, 145, '\u0000')))).toEqual([]);
    // folgado de propósito (máquina do CI carregada): o caso realista fica bem abaixo de 1 ms
    expect(r.realista.mediaMs).toBeLessThan(5);
    expect(r.grande.mediaMs).toBeLessThan(50);
  });
});

/**
 * Guarda estática das escritas cruas, pela AST do TypeScript (a interpolação com objeto inline, template aninhado ou
 * chaves balanceadas não engana): dentro de todo template `sql\`…\``,
 * 1. a interpolação seguida de um cast para json/jsonb — `${x}::jsonb`, `${x} ::JSONB`, `${x}::text::jsonb`,
 *    `${x}::varchar(10)::json`, `cast(${x} as jsonb)` — é `paraJsonbSeguro(...)`;
 * 2. nenhum `JSON.stringify(` fora de um `paraJsonbSeguro(` — cobre a conversão implícita, sem cast
 *    (`jsonb_set(${c}, ${p}, ${JSON.stringify(v)})`, `col = ${JSON.stringify(v)}`).
 * O tipo da coluna não vê esse texto. Não pega o texto JSON montado antes, numa variável, e interpolado sem cast.
 */
const CAST_JSON = /^\s*(?:::\s*\w+(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\s*\[\s*\])?\s*)*::\s*jsonb?\b|^\s*as\s+jsonb?\s*\)/i;
/** Arquivos fora de teste com escrita crua em jsonb permitida, com o motivo. Nenhum hoje. */
const ESCRITA_CRUA_PERMITIDA: Record<string, string> = {};

const chamaA = (n: ts.Node, nome: string) => ts.isCallExpression(n) && n.expression.getText() === nome;
const ehTemplateSql = (n: ts.Node): n is ts.TaggedTemplateExpression => ts.isTaggedTemplateExpression(n) && ts.isIdentifier(n.tag) && n.tag.text === 'sql';

/** As escritas cruas em jsonb de um arquivo-fonte (vazio = ok), como `linha: trecho`. */
function escritasCruas(fonte: string, tsx = false): string[] {
  const sf = ts.createSourceFile(tsx ? 'x.tsx' : 'x.ts', fonte, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const achados: string[] = [];
  const achar = (n: ts.Node, motivo: string) => achados.push(`${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${motivo}: ${n.getText(sf).replace(/\s+/g, ' ').slice(0, 120)}`);
  const visitar = (n: ts.Node): void => {
    if (ehTemplateSql(n) && ts.isTemplateExpression(n.template)) {
      for (const span of n.template.templateSpans) {
        if (!chamaA(span.expression, 'paraJsonbSeguro') && CAST_JSON.test(span.literal.text)) achar(span, 'cast para jsonb sem paraJsonbSeguro');
      }
    }
    if (chamaA(n, 'JSON.stringify')) {
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (chamaA(p, 'paraJsonbSeguro')) break;
        if (ts.isTemplateSpan(p) && ehTemplateSql(p.parent.parent)) {
          achar(n, 'JSON.stringify num sql sem paraJsonbSeguro');
          break;
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return achados;
}

function arquivosFonte(pasta: string): string[] {
  return readdirSync(path.join(RAIZ, pasta), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join(pasta, f));
}

describe('guarda: nenhuma escrita crua em jsonb num sql`…` de src/ e scripts/ (SUS-121)', () => {
  it('controle positivo: pega o cast e o JSON.stringify em todas as formas; deixa o paraJsonbSeguro e o texto', () => {
    const motivos = (s: string) => escritasCruas(s).map((a) => a.split(': ')[1]);
    const CAST = 'cast para jsonb sem paraJsonbSeguro';
    const STRINGIFY = 'JSON.stringify num sql sem paraJsonbSeguro';
    expect(motivos('sql`jsonb_set(${c}, ${JSON.stringify(v)}::jsonb)`')).toEqual([CAST, STRINGIFY]);
    expect(motivos('sql`select ${valor}::json as v`')).toEqual([CAST]);
    // objeto inline (o `[^}]*` da regex antiga parava na `}` dele), maiúscula, espaço, cast duplo, `cast(… as jsonb)`
    expect(motivos('sql`update t set c = ${JSON.stringify({ v: versao, estado })}::jsonb`')).toEqual([CAST, STRINGIFY]);
    expect(motivos('sql`${valor}::JSONB`')).toEqual([CAST]);
    expect(motivos('sql`${valor} ::jsonb`')).toEqual([CAST]);
    expect(motivos('sql`${valor}::text::jsonb`')).toEqual([CAST]);
    expect(motivos('sql`${valor} :: varchar(10) :: json`')).toEqual([CAST]);
    expect(motivos('sql`cast(${valor} as jsonb)`')).toEqual([CAST]);
    expect(motivos('sql`CAST( ${valor} AS JSON )`')).toEqual([CAST]);
    expect(motivos('sql<{ a: 1 }>`${valor}::jsonb`')).toEqual([CAST]);
    // conversão implícita, sem cast
    expect(motivos('sql`jsonb_set(${c}, ${p}, ${JSON.stringify(v)})`')).toEqual([STRINGIFY]);
    expect(motivos('sql`col = ${JSON.stringify(v)}`')).toEqual([STRINGIFY]);
    expect(motivos('sql`col = ${sql.param(JSON.stringify(v))}`')).toEqual([STRINGIFY]);
    expect(motivos('sql`a ${sql`col = ${JSON.stringify(v)}`} b`')).toEqual([STRINGIFY]);
    // template aninhado montando o JSON à mão
    expect(motivos('sql`${`{"a":"${x}"}`}::jsonb`')).toEqual([CAST]);
    expect(escritasCruas('const x = sql`${valor}::jsonb`;\n// tsx\nconst y = <div>{a}</div>;', true)).toHaveLength(1);
    // controle negativo
    expect(
      motivos(
        'sql`${paraJsonbSeguro(v)}::jsonb and ${paraJsonbSeguro({ a: JSON.stringify(x) })}::jsonb and ${c}::text and coalesce(${col}, \'[]\'::jsonb) and ${n}::int`',
      ),
    ).toEqual([]);
    expect(motivos('const t = JSON.stringify(v); const q = sql`${id}::uuid`; log(`${JSON.stringify(v)}::jsonb`)')).toEqual([]);
  });

  it('src/ e scripts/', () => {
    const arquivos = [...arquivosFonte('src'), ...arquivosFonte('scripts')];
    expect(arquivos.length).toBeGreaterThan(300);
    const violacoes = arquivos
      .filter((f) => !(f in ESCRITA_CRUA_PERMITIDA))
      .flatMap((f) => escritasCruas(readFileSync(path.join(RAIZ, f), 'utf8'), f.endsWith('.tsx')).map((a) => `${f}:${a}`));
    expect(violacoes).toEqual([]);
    // a guarda olha arquivos que de fato gravam jsonb por sql (não uma árvore vazia)
    const comParaJsonb = arquivos.filter((f) => readFileSync(path.join(RAIZ, f), 'utf8').includes('${paraJsonbSeguro('));
    expect(comParaJsonb.length).toBeGreaterThanOrEqual(3);
  });
});
