import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeuEnvio } from '@/modules/portal/exames-enviados';

// Só a montagem da página: sessão e lista simuladas.
const sessao = { ligado: true };
const lista: MeuEnvio[] = [];
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', examesPacienteAtivadoEm: sessao.ligado ? new Date() : null } }),
}));
vi.mock('@/modules/portal/exames-enviados', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/portal/exames-enviados')>()),
  meusEnvios: vi.fn(async () => lista),
}));
vi.mock('./actions', () => ({ cancelarEnvioAction: async () => ({}) }));
// o atualizador não desenha nada: aqui uma marca, para ver quando a página o monta
vi.mock('./atualizar-enquanto-processa', () => ({ AtualizarEnquantoProcessa: () => createElement('span', { 'data-atualizador': '' }) }));
vi.mock('@/app/p/moldura', () => ({
  molduraDaSecao: async () => ({ marca: { nome: 'Consultório', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }),
}));
const { default: MeusExames } = await import('./page');

const envio = (o: Partial<MeuEnvio>): MeuEnvio => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  enviadoEm: new Date('2026-10-07T13:00:00Z'),
  dataColeta: '2026-09-28',
  nome: 'Hemograma',
  status: 'recebido',
  situacao: 'Aguardando sua nutricionista',
  podeBaixar: true,
  mostraCancelar: true,
  ...o,
});
const render = async () => renderToStaticMarkup(await MeusExames());

describe('/p/exames (US-160, US-161)', () => {
  beforeEach(() => {
    sessao.ligado = true;
    lista.length = 0;
  });

  it('com o recebimento ligado: o formulário e a lista com a situação em texto, o download e o cancelamento', async () => {
    lista.push(envio({}), envio({ id: '00000000-0000-4000-8000-0000000000e2', nome: null, status: 'aceito', situacao: 'Recebido no seu prontuário', podeBaixar: false, mostraCancelar: false }));
    const html = await render();
    expect(html).toContain('Enviar exame');
    expect(html).toContain('Meus exames enviados');
    expect(html).toContain('Aguardando sua nutricionista');
    expect(html).toContain('Recebido no seu prontuário');
    expect(html).toContain('Exame enviado em 07/10/2026');
    expect(html).toContain('href="/api/p/exames/00000000-0000-4000-8000-0000000000e1/pdf"');
    expect(html).not.toContain('/api/p/exames/00000000-0000-4000-8000-0000000000e2/pdf');
    expect((html.match(/Cancelar envio/g) ?? []).length).toBe(1);
  });

  it('com o recebimento desligado: sem "Enviar exame"; os envios antigos continuam na lista', async () => {
    sessao.ligado = false;
    lista.push(envio({}));
    const html = await render();
    expect(html).not.toContain('Enviar exame');
    expect(html).toContain('Aguardando sua nutricionista');
  });

  it('sem envios: "Nenhum exame enviado ainda."', async () => {
    expect(await render()).toContain('Nenhum exame enviado ainda.');
  });

  it('com algum envio "Processando…": monta o atualizador da lista (5 s, até o worker terminar)', async () => {
    lista.push(envio({}), envio({ id: '00000000-0000-4000-8000-0000000000e2', status: 'processando', situacao: 'Processando…', podeBaixar: false }));
    expect(await render()).toContain('data-atualizador');
  });

  it('sem envio processando (recebido, falhou, aceito ou lista vazia): não monta o atualizador', async () => {
    expect(await render()).not.toContain('data-atualizador');
    lista.push(envio({}), envio({ id: '00000000-0000-4000-8000-0000000000e2', status: 'falhou', situacao: 'O PDF tem mais de 10 páginas.', podeBaixar: false }));
    expect(await render()).not.toContain('data-atualizador');
  });

  it('a troca da situação é anunciada por uma região viva única, sempre montada e vazia na abertura (RNF-10)', async () => {
    lista.push(envio({ status: 'processando', situacao: 'Processando…', podeBaixar: false }));
    const html = await render();
    const secao = html.slice(html.indexOf('id="enviados"'));
    expect(secao).toMatch(/<p role="status" class="sr-only"><\/p>/);
    expect(secao).toContain('<p>Processando…</p>'); // a linha da lista não é região viva (seria anunciada inteira)
    expect(await (lista.length = 0, render())).toMatch(/id="enviados"[\s\S]*<p role="status" class="sr-only"><\/p>/);
  });
});
