import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AVISO_PORTAL, GUIA_PORTAL } from '@/modules/ajuda/portal';
import { MSG_MURAL } from '@/modules/portal/mural-regras';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ VAPID_PUBLIC_KEY: undefined }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, data: { user: { id: 'u1', email: 'marina@ex.com' } }, vinculo: { patientId: 'p1' }, tenant: { fuso: 'America/Sao_Paulo', examesPacienteAtivadoEm: null } }),
}));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/portal/mural', () => ({ muralDoPaciente: async () => ({ primeiroNome: 'Marina', vazio: true, semPlano: true, hoje: [], anteriores: [] }) }));
vi.mock('@/modules/portal/jornada', () => ({
  miniJornadaDoPaciente: async () => ({
    linha1: '−4,2 kg desde março',
    linha2: { semFuso: 'Próximo marco: consulta amanhã, 14:00', comFuso: 'Próximo marco: consulta amanhã, 14:00 (horário de Brasília)' },
    complemento: '78,6 kg na última consulta',
    pontos: [82.8, 78.6],
    podeAgendar: true,
  }),
}));
vi.mock('../agenda/actions', () => ({ confirmarAction: async () => ({}) }));
const estado = vi.hoisted(() => ({ jaUsava: true, guia: {} as Record<string, unknown> }));
vi.mock('@/modules/plataforma/preferencias', () => ({ lerGuia: async () => estado.guia }));
vi.mock('@/modules/portal/acesso', () => ({ jaUsavaOApp: async () => estado.jaUsava }));
vi.mock('../ajuda/actions', () => ({ marcarGuiaPortalAction: async () => {} }));
const ia = vi.hoisted(() => ({ entrada: 'nenhuma' }));
vi.mock('@/modules/ia/nutri-paciente/estado', () => ({ entradaDoPaciente: async () => ia.entrada }));
// o cartão só existe no cliente (o "Agora não" fica no aparelho): o marcador mostra se a página o põe e com qual vínculo
vi.mock('./convite-ia-nutri', () => ({ ConviteIaNutri: ({ dono }: { dono: string }) => `[convite IA Nutri de ${dono}]` }));
const { default: Hoje } = await import('./page');

const pagina = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Hoje({ searchParams: Promise.resolve(busca) } as never));

describe('/p/inicio — Hoje (US-191, RN-193, RN-202)', () => {
  beforeEach(() => {
    estado.jaUsava = true;
    estado.guia = {};
    ia.entrada = 'nenhuma';
  });
  it('faixa com "Olá, Marina", a mini-jornada (link para Jornada, nome acessível que contém o texto visível), o rodapé fixo, "Ver todo o diário" e a barra de ações', async () => {
    const html = await pagina();
    expect(html).toMatch(/<h1[^>]*>Olá, Marina<\/h1>/);
    // WCAG 2.5.3 (Rótulo no nome): sem aria-label no link — o texto visível faz parte do nome; o resto vai em sr-only
    expect(html).not.toMatch(/<a[^>]*href="\/p\/jornada"[^>]*aria-label/);
    expect(html).toContain('<span class="sr-only">Sua jornada: </span>−4,2 kg desde março<span class="sr-only"> (78,6 kg na última consulta)</span>');
    // no servidor (e sem JavaScript) o fuso do aparelho é desconhecido: a versão com a sigla (nunca ambígua, como QuandoLocal)
    expect(html).toContain('Próximo marco: consulta amanhã, 14:00 (horário de Brasília)');
    expect(html).toContain(MSG_MURAL.rodape);
    expect(html).toContain('href="/p/diario"');
    expect(html).toContain('<nav aria-label="Ações"');
    expect(html).not.toContain('Enviar exame'); // recebimento desligado (RN-215)
    expect(html).not.toMatch(/<textarea|Meu acompanhamento/);
    // US-199: na primeira abertura depois do deploy, o aviso (só ele abre sozinho; o tour, só pelo botão)
    expect(html).toContain('O app mudou. Quer ver onde ficou cada coisa?');
    expect(html).toMatch(/<button[^>]*>Ver como funciona<\/button>/);
    expect(html).not.toContain('<dialog');
  });

  it('G-D17 = a: quem nunca abriu o app antes de hoje recebe as boas-vindas, não "O app mudou"', async () => {
    estado.jaUsava = false;
    const html = await pagina();
    expect(html).toContain('Boas-vindas ao app do seu acompanhamento. Quer ver como funciona?');
    expect(html).not.toContain('O app mudou');
  });

  it('RN-212: o aviso aparece uma vez por conta (visto, concluído ou dispensado na versão atual: sem aviso); ?tour= abre o tour', async () => {
    for (const marca of ['visto', 'concluido', 'dispensado']) {
      estado.guia = { 'portal-novidades': { v: GUIA_PORTAL.versao, estado: marca } };
      const html = await pagina();
      expect(html, marca).not.toContain('Ver como funciona');
      expect(html, marca).not.toContain('<dialog');
    }
    const html = await pagina({ tour: 'portal-novidades' });
    expect(html).toContain('<dialog');
    expect(html).toContain('1 de 5');
    expect(html).not.toContain('Ver como funciona'); // o tour aberto não mostra o aviso por baixo
    expect(await pagina({ tour: 'boas-vindas' })).not.toContain('<dialog'); // só o guia do portal
  });

  it('Plano 15 (★ DO-6, §7.8): quem já viu a versão 1 do guia recebe "O manual do app foi atualizado…", nunca "O app mudou" de novo', async () => {
    for (const marca of ['visto', 'concluido', 'dispensado']) {
      estado.guia = { 'portal-novidades': { v: 1, estado: marca } };
      const html = await pagina();
      expect(html, marca).toContain(AVISO_PORTAL.atualizado);
      expect(html, marca).not.toContain('O app mudou');
    }
  });

  it('Plano 15 (§7.8): o convite da IA Nutri só com a entrada "decidir", chaveado pelo vínculo', async () => {
    ia.entrada = 'decidir';
    expect(await pagina()).toContain('[convite IA Nutri de p1]');
    for (const e of ['nenhuma', 'conversa', 'texto_mudou', 'indisponivel', 'sem_plano']) {
      ia.entrada = e;
      expect(await pagina(), e).not.toContain('[convite IA Nutri');
    }
  });
});

