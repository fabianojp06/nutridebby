import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ vinculos: 2, documentos: true }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ VAPID_PUBLIC_KEY: undefined }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({
    ctx: {},
    data: { user: { email: 'marina@ex.com' } },
    vinculo: { patientId: 'p1' },
    vinculos: Array.from({ length: estado.vinculos }, (_, i) => ({ tenantId: `t${i}` })),
    tenant: { documentosLiberados: estado.documentos },
  }),
}));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/portal/perfil', () => ({ situacaoDoWhatsapp: async () => ({ ativo: false }) }));
vi.mock('./actions', () => ({ meusDadosAction: async () => ({}), exclusaoAction: async () => ({}), whatsappAction: async () => ({}) }));
// no servidor o Instalar não renderiza nada (o estado vem do navegador): o marcador deixa a posição da seção conferida
vi.mock('./instalar-no-eu', () => ({ InstalarNoEu: () => 'Instalar o app' }));
const { default: Eu } = await import('./page');

describe('/p/perfil — Eu (US-197, molde D-Assuntos)', () => {
  it('na ordem da spec: conta, consultório e "Trocar de nutricionista", meus documentos, notificações, instalar, privacidade com a RN-214 e o Sair no fim', async () => {
    const html = renderToStaticMarkup(await Eu());
    const ordem = ['Conectado como marina@ex.com.', 'Consultório Debby', 'Trocar de nutricionista', 'Meus documentos', 'Notificações', 'Instalar o app', 'Privacidade', '>Sair<'];
    const corpo = html.slice(html.indexOf('<main')); // a faixa também diz o nome do consultório
    const posicoes = ordem.map((t) => corpo.indexOf(t));
    expect(posicoes.every((p) => p >= 0), String(posicoes)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(html).toContain('Algumas informações do acompanhamento podem não aparecer no app, a critério da sua nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados).');
    expect(html).not.toMatch(/peso/i); // RN-214: nenhuma tela diz que o peso está oculto
  });
  it('um vínculo só: sem "Trocar de nutricionista"; documentos não liberados: sem "Meus documentos"', async () => {
    estado.vinculos = 1;
    estado.documentos = false;
    const html = renderToStaticMarkup(await Eu());
    expect(html).not.toContain('Trocar de nutricionista');
    expect(html).not.toContain('Meus documentos');
  });
});
