import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_MURAL, type Mural } from '@/modules/portal/mural-regras';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/signed-url', () => ({ signFileUrl: (c: string) => `/api/arquivos?c=${c}` }));
vi.mock('../agenda/actions', () => ({ confirmarAction: async () => ({}) }));
const { MuralLista } = await import('./mural-lista');

const quando = new Date('2026-10-08T12:00:00Z');
const hora = { semFuso: '09:00', comFuso: '09:00 (horário de Brasília)' };
const MURAL: Mural = {
  primeiroNome: 'Marina',
  vazio: false,
  semPlano: false,
  semRefeicaoHoje: false,
  anteriores: [{ dia: '2026-10-07', rotulo: 'Ontem', itens: [{ chave: 'plano', tipo: 'plano', autor: 'consultorio', quando, hora, texto: 'Seu novo plano alimentar está disponível.' }] }],
  hoje: [
    { chave: 'refeicao:r1', tipo: 'refeicao', autor: 'consultorio', quando, hora: { semFuso: '12:30', comFuso: '12:30' }, texto: 'Próxima refeição às 12:30 — Almoço: arroz.', refeicaoId: 'r1', respondida: false },
    { chave: 'registro:e1', tipo: 'registro', autor: 'voce', quando, hora, refeicao: 'Almoço · 12:30', resposta: 'como_no_plano', texto: null, foto: { estado: 'sem_foto' } },
    { chave: 'comentario:e1', tipo: 'comentario', autor: 'nutricionista', quando, hora, sobre: 'Almoço · 12:30, hoje às 12:41', texto: 'Ótima combinação!' },
    { chave: 'consulta:c1', tipo: 'consulta', autor: 'consultorio', quando, hora: null, consultaId: 'c1', texto: { semFuso: 'Sua próxima consulta: amanhã, 14:00 (online).', comFuso: 'x' }, podeConfirmar: true },
    { chave: 'conteudo:k1', tipo: 'conteudo', autor: 'consultorio', quando, hora, conteudoId: 'k1', titulo: 'Lanches', texto: 'Novo conteúdo: Lanches' },
  ],
};

describe('mural "Hoje" (US-191, RNF-191)', () => {
  it('lista (ol) com o autor VISÍVEL e a hora de cada item (RN-194, §11.1); a voz da nutricionista só no comentário, com o registro a que se refere', () => {
    const html = renderToStaticMarkup(createElement(MuralLista, { mural: MURAL, fuso: 'America/Sao_Paulo' }));
    expect(html).toContain('<ol');
    // o autor é texto visível (fora de sr-only), não só o lado ou a cor do balão
    expect(html).not.toMatch(/<span class="sr-only">(Você|Aviso do app|Sua nutricionista)/);
    expect(html).toContain('<span class="font-semibold text-texto">Você</span>');
    expect((html.match(/<span class="font-semibold text-texto">Aviso do app<\/span>/g) ?? []).length).toBe(4);
    expect(html).toContain('<span class="font-semibold text-texto">Sua nutricionista comentou seu registro (Almoço · 12:30, hoje às 12:41)</span>');
    expect(html).toMatch(/<li class="[^"]*border-l-4 border-l-marca[^"]*"/); // o comentário dela tem estilo próprio, diferente do aviso automático
    expect(html).toContain('Comi assim'); // o balão do paciente diz a resposta
    expect(html).toMatch(/<button[^>]*>Comi assim<\/button>/); // e a refeição ainda não respondida tem o botão
    expect(html).toContain('href="/p/plano/refeicao/r1"');
    expect(html).toContain('href="/p/agenda/c1"');
    expect(html).toMatch(/<button[^>]*>Confirmar presença<\/button>/);
    expect(html).toContain('Abrir<span class="sr-only"> Lanches</span>');
    expect(html).toContain('data-guia="respostas"');
  });
  it('"Dias anteriores" recolhido acima, com o separador do dia; nenhuma caixa de texto (C-191)', () => {
    const html = renderToStaticMarkup(createElement(MuralLista, { mural: MURAL, fuso: 'America/Sao_Paulo' }));
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf('Próxima refeição'));
    expect(html).toMatch(/<summary[^>]*>Dias anteriores<\/summary>/);
    expect(html).toContain('>Ontem</h3>');
    expect(html).not.toMatch(/<textarea|<input[^>]*type="text"/);
  });
  it('vazio: sem plano, o texto da spec; com plano e nada para agora, o texto neutro (nunca diz que ela não publicou)', () => {
    const semPlano = renderToStaticMarkup(createElement(MuralLista, { mural: { primeiroNome: '', vazio: true, semPlano: true, semRefeicaoHoje: false, hoje: [], anteriores: [] }, fuso: 'America/Sao_Paulo' }));
    expect(semPlano).toContain('Nada por aqui ainda. Quando sua nutricionista publicar seu plano, suas refeições aparecem aqui.');
    const comPlano = renderToStaticMarkup(createElement(MuralLista, { mural: { primeiroNome: '', vazio: true, semPlano: false, semRefeicaoHoje: false, hoje: [], anteriores: [] }, fuso: 'America/Sao_Paulo' }));
    expect(comPlano).toContain(MSG_MURAL.nadaAgora);
    expect(comPlano).not.toContain('publicar seu plano');
  });
  it('só "Dias anteriores" com itens (toda manhã de quem já usa o app): Hoje ainda diz "Nada para agora…", nunca fica em branco (§4.3)', () => {
    const html = renderToStaticMarkup(createElement(MuralLista, { mural: { ...MURAL, hoje: [] }, fuso: 'America/Sao_Paulo' }));
    expect(html).toMatch(/<summary[^>]*>Dias anteriores<\/summary>/);
    expect(html).toContain(MSG_MURAL.nadaAgora);
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf(MSG_MURAL.nadaAgora));
    expect(html).not.toContain('aria-label="Hoje"');
    const semPlano = renderToStaticMarkup(createElement(MuralLista, { mural: { ...MURAL, hoje: [], semPlano: true }, fuso: 'America/Sao_Paulo' }));
    expect(semPlano).toContain(MSG_MURAL.vazio);
  });
  it('Plano 19 (RN-247 b): plano publicado sem refeição que vale hoje → "Seu plano não tem refeições para hoje." no lugar de "Nada para agora…"', () => {
    const html = renderToStaticMarkup(createElement(MuralLista, { mural: { ...MURAL, hoje: [], vazio: true, semRefeicaoHoje: true }, fuso: 'America/Sao_Paulo' }));
    expect(html).toContain('<p>Seu plano não tem refeições para hoje.</p>');
    expect(html).not.toContain(MSG_MURAL.nadaAgora);
  });
  it('texto livre quebra dentro do balão (RNF-191, CS-193): um link longo no comentário não alarga a página a 320 px', () => {
    const html = renderToStaticMarkup(createElement(MuralLista, { mural: MURAL, fuso: 'America/Sao_Paulo' }));
    const itens = html.match(/<li class="[^"]*"/g) ?? [];
    expect(itens.length).toBe(6);
    for (const li of itens) expect(li).toContain('wrap-break-word');
  });
});
