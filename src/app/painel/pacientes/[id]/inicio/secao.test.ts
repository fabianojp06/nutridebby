import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SecaoNoInicio } from '@/modules/ficha/inicio';
import { Secao } from './secao';

// Plano 18 (RN-277, RN-278, spec §8.3): cada seção do Início num <details> — o <h3> "{Título} ({n})" dentro do <summary>,
// os itens e o "Ver todos" no corpo. Só a estrutura (sem DOM).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const BASE = `/painel/pacientes/${PACIENTE}`;
const ANTROPOMETRIA: SecaoNoInicio = {
  id: 'antropometria',
  titulo: 'Antropometria',
  aba: 'antropometria',
  verTodos: `${BASE}/antropometria`,
  podeAdicionar: true,
  resumo: {
    total: 5,
    ultimos: [
      { id: 'a3', rotulo: 'Avaliação', data: '2026-10-12', noApp: false, href: 'antropometria/a3' },
      { id: 'a2', rotulo: 'Avaliação', data: '2026-09-01', noApp: false, href: 'antropometria/a2' },
      { id: 'a1', rotulo: 'Avaliação', data: '2026-08-01', noApp: false, href: 'antropometria/a1' },
    ],
  },
};
const ENVIOS: SecaoNoInicio = {
  id: 'exames-enviados',
  titulo: 'Exames enviados pelo paciente',
  aba: 'exames',
  verTodos: `${BASE}/exames`,
  podeAdicionar: true,
  resumo: { total: 1, ultimos: [{ id: 'e1', rotulo: 'Envio do paciente', data: '2026-11-02', situacao: 'Aguardando revisão', noApp: false, href: '/painel/exames-recebidos/e1' }] },
};
const VAZIA: SecaoNoInicio = { ...ANTROPOMETRIA, id: 'anamneses', titulo: 'Anamneses', aba: 'anamnese', verTodos: `${BASE}/anamnese`, resumo: { total: 0, ultimos: [] } };
const html = (s: SecaoNoInicio) => renderToStaticMarkup(createElement(Secao, { secao: s, patientId: PACIENTE }));
const summary = (h: string) => h.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';

describe('seção do Início (spec §8.3)', () => {
  it('<h3> "{Título} ({n})" dentro do <summary>, que é block min-h-11 py-2, sem flex; <details> aberto com registros', () => {
    const h = html(ANTROPOMETRIA);
    expect(h).toMatch(/^<details[^>]*\sopen=""/);
    expect(summary(h)).toMatch(/<h3[^>]*>Antropometria \(5\)<\/h3>/);
    const classe = h.match(/<summary class="([^"]*)"/)?.[1] ?? '';
    expect(classe.split(' ')).toEqual(expect.arrayContaining(['block', 'min-h-11', 'py-2']));
    expect(classe).not.toMatch(/\bflex\b/);
  });

  it('itens no corpo, com rótulo, data dd/mm/aaaa e situação; href relativo resolvido na ficha e absoluto como está', () => {
    const h = html(ANTROPOMETRIA);
    expect(summary(h)).not.toContain('Avaliação');
    expect(h).toMatch(new RegExp(`<a [^>]*href="${BASE}/antropometria/a3"`));
    expect(h).toContain('Avaliação · 12/10/2026</a>');
    const e = html(ENVIOS);
    expect(e).toMatch(/<a [^>]*href="\/painel\/exames-recebidos\/e1"/);
    expect(e).toContain('Envio do paciente · 02/11/2026 · Aguardando revisão</a>');
  });

  it('"Ver todos" fora do <summary>, no corpo, com o nome acessível "Ver todos: {Título}" e o destino já resolvido', () => {
    const h = html(ANTROPOMETRIA);
    expect(summary(h)).not.toContain('Ver todos');
    const verTodos = (x: string) => x.match(/<a [^>]*>Ver todos<\/a>/)?.[0] ?? '';
    expect(verTodos(h)).toContain('aria-label="Ver todos: Antropometria"');
    expect(verTodos(h)).toContain(`href="${BASE}/antropometria"`);
    expect(verTodos(html(ENVIOS))).toContain('aria-label="Ver todos: Exames enviados pelo paciente"');
    expect(verTodos(html(ENVIOS))).toContain(`href="${BASE}/exames"`);
  });

  it('vazia: "Nenhum registro ainda." e <details> fechado', () => {
    const h = html(VAZIA);
    expect(h).toMatch(/^<details(?![^>]*\sopen)[^>]*>/);
    expect(summary(h)).toMatch(/<h3[^>]*>Anamneses \(0\)<\/h3>/);
    expect(h).toContain('Nenhum registro ainda.');
  });

  it('guarda de fonte: todo <Link> de secao.tsx tem prefetch={false} (a página de destino grava auditRead)', () => {
    const src = readFileSync(path.resolve('src/app/painel/pacientes/[id]/inicio/secao.tsx'), 'utf8');
    const links = src.match(/<Link\b[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2); // os itens e o "Ver todos"
    for (const l of links) expect(l).toContain('prefetch={false}');
  });
});
