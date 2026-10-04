import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_GUIA } from '@/modules/plataforma/preferencias-tipos';
import { GUIAS, guiaDaRota, ID_BOAS_VINDAS, precisaDoGuia } from './conteudo';

const TSX = ['src/app/painel', 'src/components']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.tsx')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

// Rótulos que vêm de módulos (opções da agenda, filtros): citados no manual, desenhados fora do .tsx
const TSX_FORA = ['src/modules/agenda', 'src/modules/conteudo', 'src/modules/pacientes']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.test.ts')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Páginas sem guia, com o motivo. */
const SEM_AJUDA: Record<string, string> = {
  '/painel/dpa': 'aceite do contrato: a nutricionista ainda não usa o painel',
  '/painel/ajuda': 'é o próprio manual',
};
const UUID = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
const PAGINAS = readdirSync(path.resolve('src/app/painel'), { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name === 'page.tsx')
  .map((d) => `/painel/${path.relative(path.resolve('src/app/painel'), d.parentPath).split(path.sep).join('/')}`.replace(/\/$/, '').replace(/\[[^\]]+\]/g, UUID));

describe('conteúdo do manual (P08-10)', () => {
  it('ids únicos e no formato do progresso; versão ≥ 1; textos curtos e não vazios', () => {
    expect(new Set(GUIAS.map((g) => g.id)).size).toBe(GUIAS.length);
    for (const g of GUIAS) {
      expect(g.id, g.id).toMatch(ID_GUIA);
      expect(g.versao).toBeGreaterThanOrEqual(1);
      expect(g.passos.length, g.id).toBeGreaterThan(0);
      for (const p of g.passos) {
        expect(p.titulo.length, `${g.id}: ${p.titulo}`).toBeGreaterThan(0);
        expect(p.texto.length, `${g.id}: ${p.titulo}`).toBeLessThanOrEqual(300);
      }
    }
    expect(GUIAS[0].id).toBe(ID_BOAS_VINDAS);
  });
  it.each(GUIAS.flatMap((g) => g.passos.filter((p) => p.alvo).map((p) => [g.id, p.alvo!])))('%s: o alvo "%s" existe como data-guia numa tela', (_g, alvo) => {
    expect(TSX).toContain(`data-guia="${alvo}"`);
  });
  it.each(PAGINAS.map((p) => [p]))('%s tem guia ou está em SEM_AJUDA', (pagina) => {
    expect(guiaDaRota(pagina) !== null || pagina in SEM_AJUDA, pagina).toBe(true);
  });
  it('todo nome de botão ou opção citado entre aspas existe numa tela (o manual não manda usar o que não existe)', () => {
    const textos = GUIAS.flatMap((g) => [g.ajuda.resumo, ...g.ajuda.secoes.flatMap((s) => s.itens), ...g.passos.map((p) => p.texto)]);
    const citados = [...new Set(textos.flatMap((t) => [...t.matchAll(/"([^"]+)"/g)].map((m) => m[1])))];
    expect(citados.length).toBeGreaterThan(0);
    expect(citados.filter((c) => !TSX.includes(c) && !TSX_FORA.includes(c))).toEqual([]);
  });
  it('guiaDaRota: o plano alimentar tem guia próprio dentro do prontuário; o Início é o de boas-vindas', () => {
    expect(guiaDaRota('/painel')?.id).toBe(ID_BOAS_VINDAS);
    expect(guiaDaRota(`/painel/pacientes/${UUID}/plano-alimentar/${UUID}`)?.id).toBe('plano-alimentar');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/exames`)?.id).toBe('prontuario');
    expect(guiaDaRota('/painel/agenda/horarios')?.id).toBe('horarios');
  });
  it('precisaDoGuia: versão nova volta a pedir; concluído/dispensado na versão atual, não', () => {
    const g = GUIAS[0];
    expect(precisaDoGuia({}, g, ['concluido', 'dispensado'])).toBe(true);
    expect(precisaDoGuia({ [g.id]: { v: g.versao, estado: 'dispensado' } }, g, ['concluido', 'dispensado'])).toBe(false);
    expect(precisaDoGuia({ [g.id]: { v: g.versao - 1, estado: 'concluido' } }, g, ['concluido', 'dispensado'])).toBe(true);
  });
});
