import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeuEnvio } from '@/modules/portal/exames-enviados';
import type { ExameLiberado } from '@/modules/portal/exames-liberados';

// Só a montagem da página: sessão e lista simuladas.
const sessao = { ligado: true };
const lista: MeuEnvio[] = [];
const liberados: ExameLiberado[] = [];
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', examesPacienteAtivadoEm: sessao.ligado ? new Date() : null } }),
}));
vi.mock('@/modules/portal/exames-enviados', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/portal/exames-enviados')>()),
  meusEnvios: vi.fn(async () => lista),
}));
vi.mock('@/modules/portal/exames-liberados', () => ({ examesLiberadosDoPaciente: vi.fn(async () => liberados) }));
vi.mock('./actions', () => ({ cancelarEnvioAction: async () => ({}) }));
// o atualizador não desenha nada: aqui uma marca, para ver quando a página o monta
vi.mock('./atualizar-enquanto-processa', () => ({
  AtualizarEnquantoProcessa: ({ processando }: { processando: string[] }) => createElement('span', { 'data-atualizador': processando.join(',') }),
}));
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
    liberados.length = 0;
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
    // só os ids em processamento (a rota leve compara a situação deles; nada de nome ou situação no cliente)
    expect(await render()).toContain('data-atualizador="00000000-0000-4000-8000-0000000000e2"');
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

  describe('Plano 22 (T6, US-375, RN-386): "Resultados liberados"', () => {
    const exame = (o: Partial<ExameLiberado> = {}): ExameLiberado => ({
      id: '00000000-0000-4000-8000-0000000000f1',
      data: '2026-09-01',
      titulo: 'Rotina de setembro',
      linhas: [
        { nome: 'Glicemia de jejum', valor: 105, unidade: 'mg/dL', referencia: '70 a 99 mg/dL', fora: true },
        { nome: 'Ferritina', valor: 80.5, unidade: null, referencia: null, fora: null },
      ],
      ...o,
    });

    it('acima de "Enviar exame": o título, o texto, o aviso no topo da seção e um cartão por exame com <dl>, "Resultado" e "Referência"', async () => {
      liberados.push(exame());
      const html = await render();
      const secao = html.indexOf('Resultados liberados');
      expect(secao).toBeGreaterThan(-1);
      expect(secao).toBeLessThan(html.indexOf('Enviar exame'));
      expect(html).toContain('Resultados que sua nutricionista liberou para você.');
      const aviso = html.indexOf('Não é diagnóstico. Converse com sua nutricionista.');
      expect(aviso).toBeGreaterThan(secao);
      expect(aviso).toBeLessThan(html.indexOf('Rotina de setembro'));
      expect(html).toContain('01/09/2026');
      expect(html).toMatch(/<dl[\s>]/);
      expect(html).toMatch(/<dt[^>]*>Glicemia de jejum<\/dt>/);
      expect(html).toContain('Resultado: 105 mg/dL');
      expect(html).toContain('Resultado: 80,5');
      expect(html).toContain('Referência: 70 a 99 mg/dL');
      expect((html.match(/Fora da referência/g) ?? []).length).toBe(1); // só a linha com `fora: true`
      expect(html).not.toMatch(/<table/); // sem tabela: nada de rolagem lateral a 360 px
      expect(html).toContain('wrap-break-word');
    });

    it('sem exame liberado, a seção não aparece', async () => {
      expect(await render()).not.toContain('Resultados liberados');
    });

    it('"Meus exames enviados" some com o recebimento desligado e sem envio; volta com um envio antigo', async () => {
      sessao.ligado = false;
      liberados.push(exame());
      const html = await render();
      expect(html).toContain('Resultados liberados');
      expect(html).not.toContain('Meus exames enviados');
      expect(html).not.toContain('Nenhum exame enviado ainda.');
      expect(html).not.toContain('Enviar exame');
      lista.push(envio({}));
      expect(await render()).toContain('Meus exames enviados');
    });
  });
});
