import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Plano 18 (D13, RN-275): o cabeçalho é lido uma vez por requisição — `carregarCabecalho` (`cache()` do React, chave
// texto) ao lado de `carregarProntuario` — e só por ele: nenhuma outra parte de `src/app` chama `lerCabecalho` (cada
// chamada direta gravaria outra linha "Visualizou" de antropometria).
const FICHA = path.resolve('src/app/painel/pacientes/[id]');
const PRONTUARIO = path.join(FICHA, 'prontuario.ts');
const LAYOUT = path.join(FICHA, 'layout.tsx');

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return fontes(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('carregarCabecalho (RN-275)', () => {
  it('é `cache(` com o parâmetro `patientId: string` e chama `lerCabecalho` com o ctx de `carregarProntuario`', () => {
    const src = readFileSync(PRONTUARIO, 'utf8');
    expect(src).toMatch(/export const carregarCabecalho = cache\(async \(patientId: string\)/);
    const corpo = src.slice(src.indexOf('export const carregarCabecalho'));
    expect(corpo).toMatch(/await carregarProntuario\(patientId\)/);
    expect(corpo).toMatch(/lerCabecalho\(ctx, /);
    expect(src).toMatch(/import \{[^}]*\blerCabecalho\b[^}]*\} from '@\/modules\/ficha\/cabecalho'/);
  });

  it('em `src/app`, só `prontuario.ts` cita `lerCabecalho`', () => {
    const citam = fontes(path.resolve('src/app'))
      .filter((f) => /\blerCabecalho\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(FICHA, f));
    expect(citam).toEqual(['prontuario.ts']);
  });

  it('o layout lê o cabeçalho só por `carregarCabecalho`, de `./prontuario` (de `cabecalho.ts`, só o formato)', () => {
    const src = readFileSync(LAYOUT, 'utf8');
    expect(src).toMatch(/import \{[^}]*\bcarregarCabecalho\b[^}]*\} from '\.\/prontuario'/);
    expect(src).toMatch(/await carregarCabecalho\(/);
    expect(src).not.toMatch(/\blerCabecalho\b/);
  });
});
