import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plano 18 (D12, US-262 "Abas"): Início e Perfil na frente, "Histórico" com o nome acessível "Histórico de acessos";
// o Início continua ativo nas páginas que saem dele (No app do paciente, resumo da IA)
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const BASE = `/painel/pacientes/${PACIENTE}`;
let caminho = BASE;
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => caminho,
}));
const { Abas } = await import('./abas');

function render(): string {
  return renderToStaticMarkup(createElement(Abas, { patientId: PACIENTE, documentos: true, iaNutri: true }));
}
/** Os links da faixa, na ordem: href, texto visível, aria-label e aria-current. */
function links(html: string) {
  return [...html.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map(([, attrs, texto]) => ({
    href: /href="([^"]*)"/.exec(attrs)?.[1],
    texto,
    nome: /aria-label="([^"]*)"/.exec(attrs)?.[1],
    atual: /aria-current="page"/.test(attrs),
  }));
}

describe('Abas da ficha (Plano 18, D12)', () => {
  beforeEach(() => {
    caminho = BASE;
  });

  it('rótulos e ordem: Início, Perfil, …, Histórico por último', () => {
    expect(links(render()).map((l) => l.texto)).toEqual([
      'Início', 'Perfil', 'Antropometria', 'Gasto energético', 'Anamnese', 'Atendimentos', 'Exames', 'Evolução', 'Privacidade',
      'Plano alimentar', 'Documentos', 'IA Nutri', 'Histórico',
    ]);
    const [inicio, perfil] = links(render());
    expect(inicio.href).toBe(BASE);
    expect(perfil.href).toBe(`${BASE}/perfil`);
  });

  it('"Histórico" tem o nome acessível "Histórico de acessos", que começa pelo rótulo visível (WCAG 2.5.3); as outras não têm aria-label', () => {
    const todas = links(render());
    const historico = todas.at(-1)!;
    expect(historico).toMatchObject({ href: `${BASE}/historico`, texto: 'Histórico', nome: 'Histórico de acessos' });
    expect(historico.nome!.startsWith(historico.texto)).toBe(true);
    expect(todas.slice(0, -1).filter((l) => l.nome)).toEqual([]);
  });

  it.each([[BASE], [`${BASE}/app`], [`${BASE}/resumo-ia`]])('Início fica ativo em %s', (url) => {
    caminho = url;
    const ativas = links(render()).filter((l) => l.atual);
    expect(ativas.map((l) => l.texto)).toEqual(['Início']);
  });

  it('no Perfil, só o Perfil fica ativo', () => {
    caminho = `${BASE}/perfil`;
    expect(links(render()).filter((l) => l.atual).map((l) => l.texto)).toEqual(['Perfil']);
  });

  it('nas outras abas, o Início não fica ativo (ex.: o editor do plano alimentar ativa Plano alimentar)', () => {
    caminho = `${BASE}/plano-alimentar/00000000-0000-4000-8000-0000000000b2`;
    expect(links(render()).filter((l) => l.atual).map((l) => l.texto)).toEqual(['Plano alimentar']);
  });
});
