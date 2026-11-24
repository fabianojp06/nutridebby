import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoApp } from '@/modules/ficha/no-app';

// Plano 18 (D16, US-264, spec §8.5): a página "No app do paciente" — textos exatos de cada situação. O prontuário e o
// `noAppDoPaciente` simulados (a paridade das contagens está em src/modules/ficha/no-app.test.ts).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const BASE = `/painel/pacientes/${PACIENTE}`;
const estado = vi.hoisted(() => ({
  paciente: {} as Record<string, unknown>,
  tenant: {} as Record<string, unknown>,
  noApp: {} as NoApp,
  pedidos: [] as unknown[][],
}));
vi.mock('server-only', () => ({}));
vi.mock('../prontuario', () => ({
  carregarProntuario: async () => ({ ctx: { tenantId: 't', role: 'nutri' }, tenant: estado.tenant, paciente: estado.paciente }),
}));
vi.mock('@/modules/ficha/no-app', () => ({
  noAppDoPaciente: async (...args: unknown[]) => {
    estado.pedidos.push(args);
    return estado.noApp;
  },
}));
const { default: NoAppPage } = await import('./page');

const ATIVO: NoApp = {
  acesso: { estado: 'ativo', ultimoAcesso: '2026-11-14', textoDoConvite: null },
  notificacoes: { aparelhos: 1, whatsapp: true },
  plano: { publicadoEm: '2026-11-10', listaDeCompras: true },
  lembretes: { ligados: 2, desligadosPeloPaciente: 1, pausados: false },
  pesoOculto: true,
  gorduraNoApp: false,
  iaNutri: 'ligada',
  contagens: { 'plano-alimentar': 1, antropometria: 5, atendimentos: 7, documentos: 2, 'exames-enviados': 1, conteudos: 12, diario30d: 9 },
  receitasSugeridas: 3,
  visiveis: {},
};

async function render(): Promise<string> {
  const el = (await NoAppPage({ params: Promise.resolve({ id: PACIENTE }) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}
/** As linhas do <dl>: "{rótulo}|{texto}" (sem as tags). */
const linhas = (html: string) =>
  [...html.matchAll(/<div[^>]*><dt[^>]*>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)].map((m) => `${m[1]}|${m[2].replace(/<[^>]+>/g, '')}`);
const linha = (html: string, rotulo: string) => linhas(html).find((l) => l.startsWith(`${rotulo}|`))?.slice(rotulo.length + 1) ?? null;

describe('página "No app do paciente" (§8.5)', () => {
  beforeEach(() => {
    estado.paciente = { id: PACIENTE, nome: 'Joana Silva', nomeSocial: null, status: 'ativo', anonimizadoEm: null };
    estado.tenant = { fuso: 'America/Sao_Paulo', documentosLiberados: true, examesPacienteAtivadoEm: null };
    estado.noApp = ATIVO;
    estado.pedidos = [];
  });

  it('título, a frase de abertura com o nome e as linhas do esboço, na ordem', async () => {
    const html = await render();
    expect(html).toMatch(/<h2 id="no-app-titulo"[^>]*>No app do paciente<\/h2>/);
    expect(html).toContain('O que Joana Silva vê hoje no app do consultório. As contagens seguem as mesmas regras do app.');
    expect(linhas(html)).toEqual([
      'Acesso|Ativo: o paciente já criou a senha. · Último acesso em 14/11/2026',
      'Notificações|Ativas em 1 aparelho · WhatsApp autorizado',
      'Plano|Publicado em 10/11/2026 · 3 receitas sugeridas · Lista de compras disponível',
      'Lembretes|2 lembretes ligados · 1 desligado pelo paciente',
      'Evolução|5 avaliações · Peso e IMC: ocultos no app (Não mostrar peso no app) · % de gordura: não aparece no app',
      'Jornada|7 atendimentos',
      'Documentos|2 documentos',
      'Conteúdos|12 conteúdos na biblioteca',
      'Exames|1 envio de exame',
      'Diário|9 registros nos últimos 30 dias',
      'IA Nutri|Ligada para este paciente',
    ]);
    // sem os ids do Início: a página só conta
    expect(estado.pedidos).toEqual([[{ tenantId: 't', role: 'nutri' }, PACIENTE]]);
  });

  it('nome social primeiro na frase de abertura (D7)', async () => {
    estado.paciente = { ...estado.paciente, nomeSocial: 'Jo' };
    expect(await render()).toContain('O que Jo vê hoje no app');
  });

  it('nunca acessou, sem push, sem WhatsApp, % de gordura visível, uma receita, IA Nutri desligada', async () => {
    estado.noApp = {
      ...ATIVO,
      acesso: { ...ATIVO.acesso, ultimoAcesso: null },
      notificacoes: { aparelhos: 0, whatsapp: false },
      plano: { publicadoEm: '2026-11-10', listaDeCompras: false },
      receitasSugeridas: 1,
      pesoOculto: false,
      gorduraNoApp: true,
      iaNutri: 'desligada',
    };
    const html = await render();
    expect(linha(html, 'Acesso')).toBe('Ativo: o paciente já criou a senha. · Último acesso: nenhum ainda.');
    expect(linha(html, 'Notificações')).toBe('Notificações: desligadas em todos os aparelhos. · WhatsApp não autorizado');
    expect(linha(html, 'Plano')).toBe('Publicado em 10/11/2026 · 1 receita sugerida');
    expect(linha(html, 'Evolução')).toBe('5 avaliações · Peso e IMC: aparecem no app · % de gordura: aparece no app');
    expect(linha(html, 'IA Nutri')).toBe('Desligada');
  });

  it('sem plano: "Nenhum plano publicado."; sem receita, a parte some', async () => {
    estado.noApp = { ...ATIVO, plano: { publicadoEm: null, listaDeCompras: false }, receitasSugeridas: null };
    expect(linha(await render(), 'Plano')).toBe('Nenhum plano publicado.');
    estado.noApp = { ...ATIVO, receitasSugeridas: 0 };
    expect(linha(await render(), 'Plano')).toBe('Publicado em 10/11/2026 · Lista de compras disponível');
  });

  it('lembretes: um ligado, a pausa; a linha some sem lembrete configurado', async () => {
    estado.noApp = { ...ATIVO, lembretes: { ligados: 1, desligadosPeloPaciente: 0, pausados: true } };
    expect(linha(await render(), 'Lembretes')).toBe('1 lembrete ligado · Pausados pelo paciente');
    estado.noApp = { ...ATIVO, lembretes: { ligados: 0, desligadosPeloPaciente: 2, pausados: false } };
    expect(linha(await render(), 'Lembretes')).toBe('0 lembretes ligados · 2 desligados pelo paciente');
    estado.noApp = { ...ATIVO, lembretes: null };
    expect(linha(await render(), 'Lembretes')).toBeNull();
  });

  it('documentos desligados pelo admin: a linha não aparece; IA Nutri fora do consultório: a linha não aparece', async () => {
    estado.tenant = { ...estado.tenant, documentosLiberados: false };
    estado.noApp = { ...ATIVO, iaNutri: null };
    const html = await render();
    expect(linha(html, 'Documentos')).toBeNull();
    expect(linha(html, 'IA Nutri')).toBeNull();
  });

  it('exames: a linha some sem o recebimento ligado e sem envio (RN-192)', async () => {
    estado.noApp = { ...ATIVO, contagens: { ...ATIVO.contagens!, 'exames-enviados': 0 } };
    expect(linha(await render(), 'Exames')).toBeNull();
    estado.tenant = { ...estado.tenant, examesPacienteAtivadoEm: new Date() };
    expect(linha(await render(), 'Exames')).toBe('0 envios de exame');
  });

  it('Plano 22 (T6, RN-387): os exames liberados entram na linha Exames — também sem o recebimento ligado e sem envio (o menu do app aparece com eles)', async () => {
    estado.noApp = { ...ATIVO, contagens: { ...ATIVO.contagens!, 'exames-enviados': 0, exames: 2 } };
    expect(linha(await render(), 'Exames')).toBe('2 exames liberados');
    estado.noApp = { ...ATIVO, contagens: { ...ATIVO.contagens!, 'exames-enviados': 1, exames: 1 } };
    expect(linha(await render(), 'Exames')).toBe('1 envio de exame · 1 exame liberado');
    estado.tenant = { ...estado.tenant, examesPacienteAtivadoEm: new Date() };
    estado.noApp = { ...ATIVO, contagens: { ...ATIVO.contagens!, 'exames-enviados': 0, exames: 0 } };
    expect(linha(await render(), 'Exames')).toBe('0 envios de exame'); // sem exame liberado, a linha de antes
  });

  it('convite pendente: "Ainda não entrou no app. {texto do convite}" e nenhuma contagem', async () => {
    estado.noApp = { ...ATIVO, acesso: { estado: 'pendente', ultimoAcesso: null, textoDoConvite: 'Convite enviado por e-mail. Vale até 20/11/2026, 10:00.' }, contagens: null };
    const html = await render();
    expect(linha(html, 'Acesso')).toBe('Ainda não entrou no app. Convite enviado por e-mail. Vale até 20/11/2026, 10:00.');
    for (const r of ['Jornada', 'Documentos', 'Conteúdos', 'Exames', 'Diário']) expect(linha(html, r), r).toBeNull();
    expect(linha(html, 'Evolução')).toBe('Peso e IMC: ocultos no app (Não mostrar peso no app) · % de gordura: não aparece no app');
    expect(html).not.toContain('Reenviar o convite no Perfil');
  });

  it('sem convite: "Ainda não entrou no app." e o link "Reenviar o convite no Perfil" (sem prefetch: o Perfil grava a leitura)', async () => {
    estado.noApp = { ...ATIVO, acesso: { estado: 'sem_convite', ultimoAcesso: null, textoDoConvite: null }, contagens: null };
    const html = await render();
    expect(linha(html, 'Acesso')).toBe('Ainda não entrou no app. Reenviar o convite no Perfil');
    const link = html.match(/<a [^>]*>Reenviar o convite no Perfil<\/a>/)?.[0] ?? '';
    expect(link).toContain(`href="${BASE}/perfil"`);
    expect(link).toMatch(/min-h-11/);
  });

  it('convite vencido: o texto do vencimento e o link para reenviar', async () => {
    estado.noApp = { ...ATIVO, acesso: { estado: 'expirado', ultimoAcesso: null, textoDoConvite: 'Convite expirado. Reenvie para o paciente conseguir entrar.' }, contagens: null };
    expect(linha(await render(), 'Acesso')).toBe('Ainda não entrou no app. Convite expirado. Reenvie para o paciente conseguir entrar. Reenviar o convite no Perfil');
  });

  it('arquivado e bloqueado: só a linha do acesso, com o texto da §8.5', async () => {
    estado.noApp = { ...ATIVO, acesso: { estado: 'arquivado', ultimoAcesso: null, textoDoConvite: null }, contagens: null };
    expect(linhas(await render())).toEqual(['Acesso|Paciente arquivado: não vê nada no app até ser reativado.']);
    estado.noApp = { ...ATIVO, acesso: { estado: 'bloqueado', ultimoAcesso: null, textoDoConvite: null }, contagens: null };
    expect(linhas(await render())).toEqual(['Acesso|Paciente bloqueado por pedido de exclusão: sem acesso ao app.']);
  });
});
