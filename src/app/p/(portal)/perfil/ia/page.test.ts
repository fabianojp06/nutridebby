import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ bloco: { situacao: { tipo: 'nunca' }, podeDecidir: true } as { situacao: { tipo: string }; podeDecidir: boolean } | null }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect ${url}`); } }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'sandbox', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, tenant: { nomeExibicao: 'Consultório Debby', nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' }, vinculo: { patientId: 'p1' }, vinculos: [], data: { user: { email: 'm@ex.com' } } }),
}));
vi.mock('@/modules/ia/autorizacao', () => ({ blocoIaDoApp: async () => estado.bloco }));
vi.mock('../actions', () => ({ autorizarIaAction: async () => undefined }));
const { default: AutorizacaoIa } = await import('./page');

describe('/p/perfil/ia — ler e decidir (US-106)', () => {
  it('o título, o consultório, o texto inteiro da versão atual com o destino em uso e a forma de retirar do app; "Autorizo…" e "Agora não"', async () => {
    const html = renderToStaticMarkup(await AutorizacaoIa());
    for (const t of ['Autorização para uso de inteligência artificial', 'Consultório Debby', 'Debora Silva, CRN-3 12345', 'Ambiente de teste', 'no app (Eu › Privacidade), pelo link do e-mail de confirmação ou pedindo à sua nutricionista', 'Versão provisória 0.1, de 09/10/2026, em revisão jurídica.']) {
      expect(html, t).toContain(t);
    }
    expect(html).toMatch(/<button[^>]*>Autorizo o envio para fora do Brasil<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/p\/perfil\?ia=agora-nao"[^>]*>Agora não<\/a>/);
    // Plano 16: tela de detalhe de Eu (como "Meus documentos"), com "Voltar para Eu"
    expect(html).toMatch(/<a[^>]*href="\/p\/perfil"[^>]*>/);
    expect(html).toContain('Voltar para Eu');
  });

  it('com a autorização retirada, versão antiga ou outro destino também decide de novo', async () => {
    for (const tipo of ['retirada', 'versao_antiga', 'outro_destino']) {
      estado.bloco = { situacao: { tipo }, podeDecidir: true };
      expect(renderToStaticMarkup(await AutorizacaoIa()), tipo).toContain('Autorizo o envio para fora do Brasil');
    }
  });

  it('sem nada a decidir (IA não ativa, sem provedor) ou já autorizado → volta a Eu', async () => {
    estado.bloco = null;
    await expect(AutorizacaoIa()).rejects.toThrow('redirect /p/perfil');
    estado.bloco = { situacao: { tipo: 'retirada' }, podeDecidir: false };
    await expect(AutorizacaoIa()).rejects.toThrow('redirect /p/perfil');
    estado.bloco = { situacao: { tipo: 'vigente' }, podeDecidir: true };
    await expect(AutorizacaoIa()).rejects.toThrow('redirect /p/perfil');
  });
});
