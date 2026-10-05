import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_GUIA } from '@/modules/plataforma/preferencias-tipos';
import { GUIAS, guiaDaRota, ID_BOAS_VINDAS, precisaDoGuia } from './conteudo';

const TSX = ['src/app/painel', 'src/app/conta', 'src/components']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.tsx')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

// Rótulos que vêm de módulos (opções da agenda, filtros): citados no manual, desenhados fora do .tsx
const TSX_FORA = ['src/modules/agenda', 'src/modules/conteudo', 'src/modules/documentos', 'src/modules/pacientes']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.test.ts')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Páginas sem guia, com o motivo. */
const SEM_AJUDA: Record<string, string> = {
  '/painel/dpa': 'aceite do contrato: a nutricionista ainda não usa o painel',
  '/painel/ajuda': 'é o próprio manual',
};
const UUID = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
// D18 (Plano 10A): as páginas de /conta (Segurança) também têm guia, mostrado na própria tela (fora do layout do painel)
const PAGINAS = ['painel', 'conta'].flatMap((raiz) =>
  readdirSync(path.resolve('src/app', raiz), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name === 'page.tsx')
    .map((d) => `/${raiz}/${path.relative(path.resolve('src/app', raiz), d.parentPath).split(path.sep).join('/')}`.replace(/\/$/, '').replace(/\[[^\]]+\]/g, UUID)),
);

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
    expect(guiaDaRota(`/painel/pacientes/${UUID}/documentos`)?.id).toBe('documentos');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/documentos/${UUID}`)?.id).toBe('documentos');
  });
  it('D20 (Plano 10A): o guia do prontuário não cita a aba Documentos nem pede o tour de novo (a aba só aparece com o consultório liberado)', () => {
    const g = GUIAS.find((x) => x.id === 'prontuario')!;
    const textos = [g.ajuda.resumo, ...g.ajuda.secoes.flatMap((s) => s.itens), ...g.passos.map((p) => p.texto)];
    expect(textos.filter((t) => /documento/i.test(t))).toEqual([]);
    expect(g.versao).toBe(1);
  });
  it('D18 (Plano 10A): /conta/seguranca tem guia (o 2FA é exigido para assinar documentos)', () => {
    expect(guiaDaRota('/conta/seguranca')?.id).toBe('seguranca');
  });
  it('precisaDoGuia: versão nova volta a pedir; concluído/dispensado na versão atual, não', () => {
    const g = GUIAS[0];
    expect(precisaDoGuia({}, g, ['concluido', 'dispensado'])).toBe(true);
    expect(precisaDoGuia({ [g.id]: { v: g.versao, estado: 'dispensado' } }, g, ['concluido', 'dispensado'])).toBe(false);
    expect(precisaDoGuia({ [g.id]: { v: g.versao - 1, estado: 'concluido' } }, g, ['concluido', 'dispensado'])).toBe(true);
  });
});
