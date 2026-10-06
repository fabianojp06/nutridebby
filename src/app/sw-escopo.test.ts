import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// P09-05 (D8): o service worker do Serwist guarda o plano do paciente (US-040) e só pode existir para o portal. A rota
// /serwist/sw.js manda `Service-Worker-Allowed: /` (@serwist/turbopack): o que limita o escopo é o registro, aqui.
const FONTES = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => path.join('src', f));
const comTexto = (re: RegExp) => FONTES.filter((f) => re.test(readFileSync(f, 'utf8')));

describe('nenhum service worker cobre o painel (P09-05, D8)', () => {
  it('o SerwistProvider só existe no portal, com scope /p/', () => {
    expect(comTexto(/SerwistProvider/)).toEqual([path.join('src', 'app', 'p', 'sw-provider.tsx')]);
    expect(readFileSync('src/app/p/sw-provider.tsx', 'utf8')).toMatch(/options=\{\{\s*scope:\s*'\/p\/'\s*\}\}/);
  });
  it('ninguém registra service worker à mão', () => {
    expect(comTexto(/serviceWorker\s*\.\s*register\s*\(/)).toEqual([]);
  });
  it('nada do painel importa o provider do portal', () => {
    expect(comTexto(/sw-provider/).filter((f) => !f.startsWith(path.join('src', 'app', 'p') + path.sep))).toEqual([]);
  });
});
