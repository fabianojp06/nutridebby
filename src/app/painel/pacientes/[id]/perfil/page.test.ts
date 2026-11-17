import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plano 18 (D12, US-262 "Abas"): o cadastro, o "Acesso ao app" (com "Reenviar convite") e as "Etiquetas" ficam no Perfil.
// Paciente, acesso e etiquetas simulados; os formulários de verdade (estrutura, sem DOM).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const AVISO_BLOQUEADO = 'Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.';
let paciente: Record<string, unknown>;
let acesso: { estado: string; expiraEm?: Date };
let conviteWa: { status: string; motivoIgnorada: string | null; agendadaPara: Date; enviadaEm: Date | null } | null;
vi.mock('server-only', () => ({}));
vi.mock('../prontuario', () => ({
  carregarProntuario: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' }, paciente }),
}));
vi.mock('@/modules/pacientes/convite-paciente', () => ({
  situacaoDoAcesso: async () => acesso,
  situacaoDoConviteWhatsapp: async () => conviteWa,
}));
vi.mock('@/modules/pacientes/etiquetas', () => ({
  listarEtiquetas: async () => [{ id: 'e1', nome: 'Gestante' }],
  etiquetasDoPaciente: async () => [{ id: 'e1', nome: 'Gestante' }],
}));
vi.mock('../../actions', () => ({ atualizarPacienteAction: vi.fn(), reenviarConviteAction: vi.fn(), salvarEtiquetasAction: vi.fn() }));
const { default: PerfilPage } = await import('./page');

async function render(): Promise<string> {
  const el = (await PerfilPage({ params: Promise.resolve({ id: PACIENTE }) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}
const titulos = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);

describe('aba Perfil (Plano 18, D12)', () => {
  beforeEach(() => {
    paciente = {
      id: PACIENTE, nome: 'Ana Teste', email: 'ana@ex.com', dataNascimento: '1990-05-20', sexo: 'F', telefone: null,
      whatsappAutorizadoEm: null, status: 'ativo', userId: null, anonimizadoEm: null,
    };
    acesso = { estado: 'pendente', expiraEm: new Date('2026-11-20T15:00:00Z') };
    conviteWa = null;
  });

  it('mostra o cadastro, o "Acesso ao app" e as "Etiquetas", nessa ordem', async () => {
    const html = await render();
    expect(titulos(html)).toEqual(['Cadastro', 'Acesso ao app', 'Etiquetas']);
    expect(html).not.toContain('Acesso ao portal');
    expect(html).toContain('value="Ana Teste"'); // o formulário de cadastro, com o que está salvo
    expect(html).toContain('Salvar cadastro');
    expect(html).toContain('Convite enviado por e-mail. Vale até 20/11/2026');
    expect(html).toContain('Reenviar convite');
    expect(html).toContain('Gestante');
    expect(html).toContain('Salvar etiquetas');
    expect(html).not.toContain(AVISO_BLOQUEADO);
  });

  it('sem convite por WhatsApp: sem a linha dele', async () => {
    expect(await render()).not.toContain('Convite por WhatsApp');
  });

  it('convite por WhatsApp enviado: a linha aparece no "Acesso ao app"', async () => {
    const quando = new Date('2026-11-16T13:30:00Z');
    conviteWa = { status: 'enviada', motivoIgnorada: null, agendadaPara: quando, enviadaEm: quando };
    const html = await render();
    expect(html).toContain('Convite por WhatsApp: enviado em seg., 16/11/2026 às 10:30');
    // depois do título "Acesso ao app" e antes de "Etiquetas"
    const i = html.indexOf('Convite por WhatsApp');
    expect(i).toBeGreaterThan(html.indexOf('>Acesso ao app<'));
    expect(i).toBeLessThan(html.indexOf('>Etiquetas<'));
  });

  it('acesso já ativo: sem "Reenviar convite"', async () => {
    acesso = { estado: 'ativo' };
    paciente = { ...paciente, userId: 'u1' };
    const html = await render();
    expect(html).toContain('Ativo: o paciente já criou a senha.');
    expect(html).not.toContain('Reenviar convite');
  });

  it('bloqueado: só leitura, com o aviso, sem "Reenviar convite"', async () => {
    paciente = { ...paciente, status: 'bloqueado' };
    const html = await render();
    expect(html).toContain(AVISO_BLOQUEADO);
    expect(html).not.toContain('Reenviar convite');
    // o cadastro e as etiquetas: os dois fieldsets de fora, desabilitados
    const desabilitados = [...html.matchAll(/<fieldset[^>]*disabled=""/g)];
    expect(desabilitados.length).toBe(2);
  });
});
