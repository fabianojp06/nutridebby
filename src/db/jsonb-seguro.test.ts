import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { jsonbSeguro, paraJsonbSeguro } from './jsonb-seguro';
import { anamneses } from './schema';

/** O texto JSON que o Postgres recebe, relido: o que de fato chegaria à coluna. */
const gravado = (v: unknown) => JSON.parse(paraJsonbSeguro(v)) as unknown;
/** Nenhum NUL nem surrogate sem par, nem como caractere nem como escape no texto JSON. */
const textoLimpo = (s: string) => !/\\u(?:0000|d[89a-f])/i.test(s) && s.isWellFormed() && !s.includes('\u0000');

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
    expect(textoLimpo(s)).toBe(true);
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

  it('amostragem: o mesmo resultado de limpar cada string e chave com o semInvalidosNoBanco', () => {
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
    const PECAS = ['a', 'é', '🙂', '\u0000', '\ud800', '\udbff', '\udc00', '\udfff', '\\', '\\u0000', '"', '\n', '\u0001', 'u0000'];
    let semente = 121;
    const sorteio = (n: number) => ((semente = (semente * 1103515245 + 12345) % 2 ** 31), semente % n);
    const texto = () => Array.from({ length: sorteio(8) }, () => PECAS[sorteio(PECAS.length)]).join('');
    const valor = (fundo: number): unknown => {
      const t = sorteio(fundo > 2 ? 3 : 6);
      if (t === 0) return texto();
      if (t === 1) return sorteio(100) - 50;
      if (t === 2) return sorteio(2) === 0 ? null : true;
      if (t === 3) return Array.from({ length: sorteio(4) }, () => valor(fundo + 1));
      return Object.fromEntries(Array.from({ length: sorteio(4) }, () => [texto(), valor(fundo + 1)]));
    };
    for (let i = 0; i < 3000; i++) {
      const v = { raiz: valor(0), [texto()]: texto() };
      const s = paraJsonbSeguro(v);
      expect(textoLimpo(s)).toBe(true);
      // a referência limpa o próprio valor: o JSON.parse do V8 (Node 24) erra a chave de 1 caractere escrita como escape
      // de surrogate sem par (`{"\udc00":…}` volta como a chave `\` vista antes); a saída limpa não tem esse escape
      expect(JSON.parse(s)).toEqual(JSON.parse(JSON.stringify(referencia(v))));
    }
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
 * Guarda estática: o schema só declara jsonb pelo `jsonbSeguro`. Um `jsonb(` do `drizzle-orm/pg-core` gravaria o NUL e
 * o surrogate sem par e o 22P02 levaria o texto ao log do Postgres.
 */
const RAIZ = path.resolve(__dirname, '../..');
const PASTA_SCHEMA = path.join(RAIZ, 'src/db/schema');
const IMPORT_PG_CORE = /import\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"]drizzle-orm\/pg-core['"]/g;

/** Os motivos pelos quais um arquivo do schema usa o jsonb cru (vazio = ok). */
function jsonbCru(fonte: string): string[] {
  const motivos: string[] = [];
  for (const m of fonte.matchAll(IMPORT_PG_CORE)) {
    if (/(^|[\s{,])jsonb(\s+as\s+\w+)?\s*[,}]/.test(m[1])) motivos.push('importa jsonb do drizzle-orm/pg-core');
  }
  // `jsonb(`, `pg.jsonb(`; não pega `jsonbSeguro(`, `to_jsonb(` nem `jsonb_typeof(`
  if (/(?<![\w$])jsonb\s*\(/.test(fonte)) motivos.push('chama jsonb(');
  return motivos;
}

describe('guarda: nenhum jsonb cru em src/db/schema (SUS-121)', () => {
  it('controle positivo: a guarda pega o import, o alias, o namespace e a chamada', () => {
    expect(jsonbCru(`import { jsonb, text } from 'drizzle-orm/pg-core';`)).toEqual(['importa jsonb do drizzle-orm/pg-core']);
    expect(jsonbCru(`import {\n  text,\n  jsonb,\n} from "drizzle-orm/pg-core";`)).toEqual(['importa jsonb do drizzle-orm/pg-core']);
    expect(jsonbCru(`import { jsonb as j } from 'drizzle-orm/pg-core';`)).toEqual(['importa jsonb do drizzle-orm/pg-core']);
    expect(jsonbCru(`import * as pg from 'drizzle-orm/pg-core';\nconst c = pg.jsonb('x');`)).toEqual(['chama jsonb(']);
    expect(jsonbCru(`x: jsonb ('x')`)).toEqual(['chama jsonb(']);
    // controle negativo
    expect(jsonbCru(`import { text } from 'drizzle-orm/pg-core';\nx: jsonbSeguro('x'), sql\`jsonb_typeof(\${t}) and to_jsonb(1) and '{}'::jsonb\``)).toEqual([]);
  });

  it('nenhum arquivo do schema usa o jsonb cru', () => {
    const arquivos = readdirSync(PASTA_SCHEMA).filter((f) => f.endsWith('.ts'));
    expect(arquivos.length).toBeGreaterThan(10);
    const violacoes = arquivos.flatMap((f) => jsonbCru(readFileSync(path.join(PASTA_SCHEMA, f), 'utf8')).map((m) => `${f}: ${m}`));
    expect(violacoes).toEqual([]);
    // o schema de fato usa o tipo (a guarda não está olhando uma pasta vazia)
    const usos = arquivos.filter((f) => readFileSync(path.join(PASTA_SCHEMA, f), 'utf8').includes('jsonbSeguro('));
    expect(usos.length).toBeGreaterThanOrEqual(10);
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
    expect(textoLimpo(paraJsonbSeguro(plano(7, 145, '\u0000')))).toBe(true);
    // folgado de propósito (máquina do CI carregada): o caso realista fica bem abaixo de 1 ms
    expect(r.realista.mediaMs).toBeLessThan(5);
    expect(r.grande.mediaMs).toBeLessThan(50);
  });
});
