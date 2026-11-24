import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem do formulário (a action não roda): a ajuda fixa do suplemento e do lembrete livre (TRI-17-20 #62).
vi.mock('./actions', () => ({ salvarLembreteAction: vi.fn() }));
const { FormLembrete } = await import('./form-lembrete');

const AJUDA_LIVRE = 'O lembrete não substitui a prescrição nem as orientações registradas no prontuário.';
const AJUDA_SUPLEMENTO = 'O lembrete não substitui a prescrição: composição, via e posologia vão na receita e no prontuário.';

const montar = (tipo: 'suplemento' | 'livre') =>
  renderToStaticMarkup(
    createElement(FormLembrete, { patientId: 'p', inicial: { tipo, texto: '', config: { horarios: ['08:00'], dias: [1] } }, nome: 'lembrete', aoSalvar: () => {} }),
  );
const campoDoTexto = (html: string) => html.match(/<input[^>]*name="texto"[^>]*>/)?.[0] ?? '';
const descritoPor = (html: string) => (campoDoTexto(html).match(/aria-describedby="([^"]*)"/)?.[1] ?? '').split(' ');
const paragrafo = (html: string, id: string) => html.match(new RegExp(`<p id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)</p>`))?.[1];

describe('FormLembrete: ajuda fixa ligada ao campo de texto (NORMAS-F2, TRI-17-20 #62)', () => {
  it('lembrete livre: a ajuda própria aparece e o aria-describedby do texto aponta para ela', () => {
    const html = montar('livre');
    const ajuda = descritoPor(html).find((id) => id.endsWith('-ajuda'));
    expect(ajuda).toBeDefined();
    expect(paragrafo(html, ajuda!)).toBe(AJUDA_LIVRE);
    expect(html).not.toContain(AJUDA_SUPLEMENTO);
  });

  it('suplemento: continua com a ajuda do suplemento, ligada ao campo', () => {
    const html = montar('suplemento');
    const ajuda = descritoPor(html).find((id) => id.endsWith('-ajuda'));
    expect(ajuda).toBeDefined();
    expect(paragrafo(html, ajuda!)).toBe(AJUDA_SUPLEMENTO);
    expect(html).not.toContain(AJUDA_LIVRE);
  });
});

describe('FormLembrete: o reset automático do React 19 não desencontra a tela do estado (SUS-108)', () => {
  const DIR = 'src/app/painel/pacientes/[id]/plano-alimentar/lembretes';

  it('o erro não remonta o formulário (a action só devolve `envio` no sucesso), por isso o <form> cancela o reset', () => {
    // A remontagem pela `envio` não protege: no erro a chave fica igual (o foco continua no Salvar), e o form.reset() depois
    // da action levava o <select> do intervalo à opção do HTML do servidor e os dias aos da montagem — o reenvio mandava o
    // que a tela mostrava (reproduzido no navegador: intervalo 1 h → 2 h, domingo marcado → desmarcado).
    const a = readFileSync(`${DIR}/actions.ts`, 'utf8');
    const corpo = a.slice(a.indexOf('export async function salvarLembreteAction'), a.indexOf('/** Erros de `ligarLembrete`'));
    const erros = corpo.match(/return \{ erros[^\n]*/g) ?? [];
    expect(erros).toHaveLength(2);
    for (const r of erros) expect(r).not.toContain('envio');
    expect(corpo).toMatch(/return \{ ok: 'Lembrete salvo\.', envio: Date\.now\(\), id \}/);
    const f = readFileSync(`${DIR}/form-lembrete.tsx`, 'utf8');
    expect(f).toMatch(/<form key=\{state\.envio\} ref=\{semResetAutomatico\} action=\{enviar\}/);
    // os campos continuam controlados pelo estado (o reset cancelado não deixa nada "solto")
    expect(f).toMatch(/<select id=\{id\} name=\{nome\} value=\{valor\} onChange=/);
    expect(f).toMatch(/\schecked=\{dias\.includes\(d\.valor\)\}/);
  });
});
