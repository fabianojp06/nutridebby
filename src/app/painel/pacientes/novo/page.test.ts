import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Plano 18 (§8.4): "Novo paciente" usa o mesmo formulário em seções do Perfil, sem Acesso ao app (o convite sai ao
// salvar) e sem Etiquetas. Sessão e WhatsApp simulados; o formulário de verdade (estrutura, sem DOM).
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: async () => ({ ctx: {} }) }));
vi.mock('@/modules/notificacoes/whatsapp/conexao', () => ({ provedorDoApp: () => null, situacaoDoWhatsapp: async () => ({ ligado: false, estado: 'desconectada' }) }));
vi.mock('../actions', () => ({ criarPacienteAction: vi.fn() }));
const { default: NovoPacientePage } = await import('./page');

describe('Novo paciente (Plano 18, §8.4)', () => {
  it('as três seções do cadastro, vazias, sem "Acesso ao app" nem "Etiquetas"; o convite por WhatsApp com o aviso', async () => {
    const html = renderToStaticMarkup((await NovoPacientePage()) as ReactElement);
    expect([...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1])).toEqual(['Dados gerais', 'Contato e endereço', 'Observação']);
    expect(html).not.toContain('Acesso ao app');
    expect(html).not.toContain('Etiquetas');
    expect(html).toContain('Enviar convite por WhatsApp');
    expect(html).toContain('O WhatsApp ainda não está disponível na plataforma; o convite vai só por e-mail.');
    expect(html).toContain('Cadastrar paciente');
    expect(html).toMatch(/<form[^>]*data-guia="cadastro-paciente"/);
    expect(html).toContain('0 de 1.000 caracteres');
    for (const id of ['nome', 'cpf', 'cep', 'nomeSocial']) expect(html).toMatch(new RegExp(`<input id="${id}"[^>]*value=""`));
    // RNF-261: a caixa do convite com alvo de 44 px, como os rádios do sexo
    expect(html).toMatch(/<div class="flex min-h-11 items-center gap-2"><input id="enviarConviteWhatsapp"/);
  });
});
