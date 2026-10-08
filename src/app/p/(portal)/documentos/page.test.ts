import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentoNoPortal } from '@/modules/documentos/portal';

// Só a montagem da página: sessão e lista simuladas.
const sessao = { liberado: true };
const lista: DocumentoNoPortal[] = [];
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', documentosLiberados: sessao.liberado } }),
}));
vi.mock('@/modules/documentos/portal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/documentos/portal')>()),
  documentosDoPaciente: vi.fn(async () => lista),
}));
vi.mock('./actions', () => ({ confirmarRecebimentoAction: async () => {} }));
const { default: MeusDocumentos } = await import('./page');
const { documentosDoPaciente } = await import('@/modules/documentos/portal');

const doc = (o: Partial<DocumentoNoPortal>): DocumentoNoPortal => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  tipo: 'receita',
  titulo: 'Receita',
  versao: 1,
  data: new Date('2026-10-05T02:00:00Z'), // 04/10 em São Paulo
  status: 'assinado',
  assinaturaTipo: 'digitalizada',
  aberto: false,
  recebidoEm: null,
  ...o,
});
const render = async () => renderToStaticMarkup(await MeusDocumentos());

describe('/p/documentos (US-146)', () => {
  beforeEach(() => {
    sessao.liberado = true;
    lista.length = 0;
    vi.mocked(documentosDoPaciente).mockClear();
  });

  it('sem documentos: o texto da spec', async () => {
    expect(await render()).toContain('Você ainda não tem documentos.');
  });

  it('assinado: título com a data no fuso do consultório, linha da assinatura, "Abrir PDF" e o botão de confirmar', async () => {
    lista.push(doc({}));
    const html = await render();
    expect(html).toContain('Receita · 04/10/2026');
    expect(html).toContain('Assinatura: Digitalizado');
    expect(html).toContain('href="/api/p/documentos/00000000-0000-4000-8000-0000000000d1/pdf"');
    expect(html).toContain('Abrir PDF<span class="sr-only"> da receita de 04/10/2026</span>');
    expect(html).toContain('Confirmo que recebi este documento');
  });

  it('Plano 13: o parecer e a versão ("Parecer nutricional · 04/10/2026 · Versão 2") e o leitor de tela com o artigo certo', async () => {
    lista.splice(0, lista.length, doc({ tipo: 'parecer', titulo: 'Parecer nutricional', versao: 2 }));
    const html = await render();
    expect(html).toContain('Parecer nutricional · 04/10/2026 · Versão 2');
    expect(html).toContain('Abrir PDF<span class="sr-only"> do parecer nutricional de 04/10/2026</span>');
    lista.splice(0, lista.length, doc({}));
    const receita = await render();
    expect(receita).toContain('Receita · 04/10/2026<'); // versão 1: sem "Versão"
    expect(receita).toContain('Abrir PDF<span class="sr-only"> da receita de 04/10/2026</span>');
  });

  it('confirmado: "Recebimento confirmado em dd/mm/aaaa." e o botão some; cancelado e substituído mostram o aviso e nunca o botão', async () => {
    lista.push(doc({ recebidoEm: new Date('2026-10-06T12:00:00Z') }));
    let html = await render();
    expect(html).toContain('Recebimento confirmado em 06/10/2026.');
    expect(html).not.toContain('Confirmo que recebi este documento');
    lista.length = 0;
    lista.push(doc({ status: 'cancelado' }), doc({ id: '00000000-0000-4000-8000-0000000000d2', status: 'substituido' }));
    html = await render();
    expect(html).toContain('Cancelado pela nutricionista. Não use este documento.');
    expect(html).toContain('Substituído por uma versão mais nova.');
    expect(html).not.toContain('Confirmo que recebi este documento');
  });

  it('D20: com o interruptor do admin desligado, 404 sem consultar a lista', async () => {
    sessao.liberado = false;
    await expect(MeusDocumentos()).rejects.toMatchObject({ digest: expect.stringContaining('404') });
    expect(documentosDoPaciente).not.toHaveBeenCalled();
  });
});
