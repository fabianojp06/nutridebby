import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { textoDaBusca, textoDoForm } from './texto-da-requisicao';

describe('textoDaBusca / textoDoForm (SUS-121, regra 3)', () => {
  it.each([
    ['NUL', '\u0000'],
    ['surrogate alto sem par', '\ud800'],
    ['surrogate baixo sem par', '\udc00'],
  ])('tiram %s; emoji, acento e espaços ficam', (_nome, c) => {
    const sujo = ` Ana${c} Souza 🙂 `;
    expect(textoDaBusca({ q: sujo }, 'q')).toBe(' Ana Souza 🙂 ');
    expect(textoDaBusca({ q: [sujo] }, 'q')).toBe(' Ana Souza 🙂 ');
    // URLSearchParams e FormData guardam USVString: o surrogate sem par já chega como U+FFFD (válido); o NUL chega
    const fd = new FormData();
    fd.set('busca', sujo);
    const esperado = c === '\u0000' ? ' Ana Souza 🙂 ' : ' Ana\ufffd Souza 🙂 ';
    expect(textoDaBusca(new URLSearchParams({ busca: sujo }), 'busca')).toBe(esperado);
    expect(textoDaBusca(new URLSearchParams(`busca=${encodeURIComponent(' Ana')}%00${encodeURIComponent(' Souza')}`), 'busca')).toBe(' Ana Souza');
    expect(textoDoForm(fd, 'busca')).toBe(esperado);
  });

  it('ausente, repetido e arquivo', () => {
    expect(textoDaBusca(new URLSearchParams(), 'q')).toBe('');
    expect(textoDaBusca({}, 'q')).toBe('');
    expect(textoDaBusca({ q: ['a\u0000', 'b'] }, 'q')).toBe('a');
    expect(textoDaBusca(new URLSearchParams('q=a&q=b'), 'q')).toBe('a');
    const fd = new FormData();
    fd.set('arquivo', new Blob(['x']), 'x.txt');
    expect(textoDoForm(fd, 'arquivo')).toBe('');
    expect(textoDoForm(fd, 'nada')).toBe('');
  });

  it('com `max`: corta e limpa de novo (o corte no meio do emoji não deixa surrogate sem par)', () => {
    expect(textoDaBusca({ busca: 'ab🙂' }, 'busca', 3)).toBe('ab');
    expect(textoDaBusca({ busca: 'a\u0000b🙂' }, 'busca', 3)).toBe('ab');
    expect(textoDaBusca({ busca: 'abc' }, 'busca', 100)).toBe('abc');
    const fd = new FormData();
    fd.set('busca', 'x🙂');
    expect(textoDoForm(fd, 'busca', 2)).toBe('x');
  });
});

/**
 * Guarda estática: em src/app, os parâmetros de busca (`busca`, `q`) da URL e dos formulários só são lidos por
 * `textoDaBusca`/`textoDoForm`. Os outros campos de formulário ficam fora (backlog do SUS-121).
 */
const RAIZ = path.resolve(__dirname, '../..');
const CHAVES = '(?:busca|q)';
/** Arquivo → motivo. Leitura crua de `busca`/`q` permitida. Nenhuma hoje. */
const EXCECOES: Record<string, string> = {};

function leiturasCruas(fonte: string): string[] {
  const achados: string[] = [];
  const achar = (re: RegExp) => {
    for (const m of fonte.matchAll(re)) achados.push(m[0].replace(/\s+/g, ' '));
  };
  const getDireto = new RegExp(String.raw`\.get(?:All)?\(\s*['"\`]${CHAVES}['"\`]\s*\)`);
  achar(new RegExp(getDireto.source, 'g'));
  achar(new RegExp(String.raw`\{[^}]*\b${CHAVES}\b[^}]*\}\s*=\s*\(?\s*await\s+(?:\w+\.)?searchParams\b`, 'g'));
  // sem variável: `(await searchParams).busca`, `(await props.searchParams)['q']`
  achar(new RegExp(String.raw`\(\s*await\s+(?:\w+\.)?searchParams\s*\)\s*(?:\?\.|\.)\s*${CHAVES}\b|\(\s*await\s+(?:\w+\.)?searchParams\s*\)\s*(?:\?\.)?\[\s*['"]${CHAVES}['"]\s*\]`, 'g'));
  // o objeto da URL lido inteiro: `sp.busca`, `sp?.q`, `sp['q']`, `const { busca } = sp`, e o filtro da lista de
  // pacientes recebendo `sp` cru
  for (const m of fonte.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*\(?\s*await\s+(?:\w+\.)?searchParams\b/g)) {
    const v = m[1];
    achar(new RegExp(String.raw`\b${v}\s*(?:\?\.|\.)\s*${CHAVES}\b|\b${v}\s*(?:\?\.)?\[\s*['"]${CHAVES}['"]\s*\]`, 'g'));
    achar(new RegExp(String.raw`\{[^}]*\b${CHAVES}\b[^}]*\}\s*=\s*${v}\b(?!\s*[.[(])`, 'g'));
    achar(new RegExp(String.raw`\bfiltroDaUrl\(\s*${v}\s*\)`, 'g'));
  }
  // lista de chaves lidas do formulário numa linha (`['aba', 'busca'].map((k) => formData.get(k))`)
  for (const linha of fonte.split('\n')) {
    if (getDireto.test(linha)) continue; // já contado acima
    if (new RegExp(String.raw`['"]${CHAVES}['"]`).test(linha) && /\.get\(/.test(linha) && !/textoDoForm|textoDaBusca/.test(linha)) achados.push(linha.trim());
  }
  return achados;
}

describe('guarda: busca lida da URL e do formulário só por textoDaBusca/textoDoForm (SUS-121)', () => {
  it('controle positivo: as formas cruas são pegas; as do helper, não', () => {
    expect(leiturasCruas(`const q = new URL(req.url).searchParams.get('q');`)).toHaveLength(1);
    expect(leiturasCruas(`const { aviso, busca } = await searchParams;`)).toHaveLength(1);
    expect(leiturasCruas(`const sp = await props.searchParams;\nconst b = sp.busca;\nconst c = sp['q'];`)).toHaveLength(2);
    expect(leiturasCruas(`const sp = await searchParams;\nconst f = filtroDaUrl(sp);`)).toHaveLength(1);
    expect(leiturasCruas(`const sp = await searchParams;\nconst { busca } = sp;`)).toHaveLength(1);
    expect(leiturasCruas(`const sp = await props.searchParams;\nconst {\n  aviso,\n  q = '',\n} = sp;`)).toHaveLength(1);
    expect(leiturasCruas(`const b = (await searchParams).busca;`)).toHaveLength(1);
    expect(leiturasCruas(`const b = (await props.searchParams)['q'];`)).toHaveLength(1);
    expect(leiturasCruas(`const { busca } = (await searchParams);`)).toHaveLength(1);
    expect(leiturasCruas(`const sp = (await searchParams);\nconst b = sp?.busca;`)).toHaveLength(1);
    expect(leiturasCruas(`const f = x(['aba', 'busca'].map((k) => [k, String(formData.get(k) ?? '')]));`)).toHaveLength(1);
    expect(leiturasCruas(`const busca = String(formData.get('busca') ?? '');`)).toHaveLength(1);
    // negativos
    expect(
      leiturasCruas(
        `const sp = await searchParams;\nconst f = filtroDaUrl({ ...sp, busca: textoDaBusca(sp, 'busca') });\nconst q = textoDaBusca(new URL(req.url).searchParams, 'q');\nconst g = x(['aba', 'busca'].map((k) => [k, textoDoForm(formData, k)]));\nconst t = sp.tipo; const pagina = { busca: 1 };\nconst { tipo, aba } = sp;\nconst x = (await searchParams).tipo;\nconst { busca: b2 } = spOutro;`,
      ),
    ).toEqual([]);
  });

  it('src/app', () => {
    const arquivos = readdirSync(path.join(RAIZ, 'src/app'), { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => path.join('src/app', f));
    expect(arquivos.length).toBeGreaterThan(100);
    const violacoes = arquivos.filter((f) => !(f in EXCECOES)).flatMap((f) => leiturasCruas(readFileSync(path.join(RAIZ, f), 'utf8')).map((l) => `${f}: ${l}`));
    expect(violacoes).toEqual([]);
  });
});
