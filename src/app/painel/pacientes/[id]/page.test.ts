import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecaoNoInicio } from '@/modules/ficha/inicio';
import type { NoApp } from '@/modules/ficha/no-app';

// Plano 18 (US-262, US-263, RN-276): a aba Início — Adicionar (some para bloqueado e anonimizado), o cartão Resumo, o
// bloco da IA (US-120) e as seções na ordem em que o registro as devolve. Prontuário, IA, seções e cartão simulados.
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const BASE = `/painel/pacientes/${PACIENTE}`;
const estado = vi.hoisted(() => ({
  paciente: {} as Record<string, unknown>,
  secoes: [] as unknown[],
  ia: null as unknown,
  chamadas: [] as unknown[][],
  incompleto: null as string | null,
  incompletoPedido: [] as string[],
  noApp: {} as NoApp,
  noAppPedidos: [] as unknown[][],
}));
vi.mock('server-only', () => ({}));
vi.mock('./prontuario', () => ({
  carregarProntuario: async () => ({
    ctx: { tenantId: 't', role: 'nutri' },
    tenant: { fuso: 'America/Sao_Paulo', documentosLiberados: true, examesPacienteAtivadoEm: null, status: 'ativa' },
    paciente: estado.paciente,
  }),
}));
vi.mock('./ia-assistente', () => ({ iaDoAssistente: async () => estado.ia }));
vi.mock('@/modules/ficha/inicio', () => ({
  secoesDoInicio: async (...args: unknown[]) => {
    estado.chamadas.push(args);
    return estado.secoes;
  },
}));
vi.mock('@/modules/ficha/resumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/ficha/resumo')>()),
  cartaoResumo: async () => ({ aniversario: '20 de maio', pacienteDesde: '03/02/2025', planoPublicadoEm: '10/11/2026' }),
}));
// RN-269: a nota "Cadastro incompleto" (o texto vem pronto de incompleto.ts, que só lê a presença dos campos)
vi.mock('@/modules/ficha/incompleto', () => ({
  cadastroIncompleto: async (_ctx: unknown, id: string) => {
    estado.incompletoPedido.push(id);
    return estado.incompleto;
  },
}));
// Tarefa 9 (RN-279, RN-281): o No app (contado no contexto do paciente) devolve os ids com selo e o cartão
vi.mock('@/modules/ficha/no-app', () => ({
  noAppDoPaciente: async (...args: unknown[]) => {
    estado.noAppPedidos.push(args);
    return estado.noApp;
  },
}));
vi.mock('./inicio/acoes', () => ({ acoesDoAdicionar: () => ({ 'criar-receita': vi.fn(), 'criar-parecer': vi.fn() }) }));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({ push: () => undefined }) }));
const { default: InicioPage } = await import('./page');
const { MSG_BLOQUEADO } = await import('@/modules/pacientes/base');

const secao = (id: string, titulo: string, aba: string, total = 0): SecaoNoInicio => ({
  id,
  titulo,
  aba,
  verTodos: `${BASE}/${aba}`,
  podeAdicionar: true,
  resumo: { total, ultimos: total ? [{ id: `${id}-1`, rotulo: 'Item', data: '2026-10-12', noApp: false, href: `${aba}/${id}-1` }] : [] },
});
const REGISTRO = [
  secao('plano-alimentar', 'Plano alimentar', 'plano-alimentar', 1),
  secao('antropometria', 'Antropometria', 'antropometria', 5),
  secao('gasto-energetico', 'Gasto energético', 'gasto-energetico'),
  secao('anamneses', 'Anamneses', 'anamnese', 3),
  secao('atendimentos', 'Atendimentos', 'atendimentos'),
  secao('exames', 'Exames', 'exames'),
  secao('documentos', 'Documentos', 'documentos'),
];

async function render(): Promise<string> {
  const el = (await InicioPage({ params: Promise.resolve({ id: PACIENTE }) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}
const h3s = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);

describe('aba Início (Plano 18)', () => {
  beforeEach(() => {
    estado.paciente = { id: PACIENTE, nome: 'Ana Teste', status: 'ativo', anonimizadoEm: null, dataNascimento: '1990-05-20', createdAt: new Date('2025-02-03T15:00:00Z') };
    estado.secoes = REGISTRO;
    estado.ia = null;
    estado.chamadas = [];
    estado.incompleto = null;
    estado.incompletoPedido = [];
    estado.noAppPedidos = [];
    estado.noApp = {
      acesso: { estado: 'ativo', ultimoAcesso: '2026-11-14', textoDoConvite: null },
      notificacoes: { aparelhos: 1, whatsapp: true },
      plano: { publicadoEm: '2026-11-10', listaDeCompras: true },
      lembretes: null,
      pesoOculto: false,
      gorduraNoApp: false,
      iaNutri: null,
      contagens: { 'plano-alimentar': 1, antropometria: 5, atendimentos: 0, documentos: 2, 'exames-enviados': 0, conteudos: 12, diario30d: 0 },
      receitasSugeridas: 0,
      visiveis: { 'plano-alimentar': ['plano-alimentar-1'] },
    };
  });

  it('ativo: o botão Adicionar, o cartão Resumo e as seções na ordem do registro', async () => {
    const html = await render();
    expect(html).toContain('data-guia="adicionar-prontuario"');
    expect(html).toMatch(/<h2[^>]*>Resumo<\/h2>/);
    expect(html).toContain('Aniversário: 20 de maio');
    expect(html).toContain('Paciente desde 03/02/2025');
    expect(html).toContain('Plano alimentar publicado em 10/11/2026');
    expect(html).toContain('data-guia="secoes-inicio"');
    const secoes = h3s(html).filter((t) => /\(\d+\)$/.test(t));
    expect(secoes).toEqual(['Plano alimentar (1)', 'Antropometria (5)', 'Gasto energético (0)', 'Anamneses (3)', 'Atendimentos (0)', 'Exames (0)', 'Documentos (0)']);
    // o Início lê as seções com o tenant e o paciente do prontuário (uma chamada)
    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0][2]).toBe(estado.paciente);
  });

  it('a ordem das seções é a que secoesDoInicio devolve (a página não reordena)', async () => {
    estado.secoes = [...REGISTRO].reverse();
    expect(h3s(await render()).filter((t) => /\(\d+\)$/.test(t))[0]).toBe('Documentos (0)');
  });

  it('bloqueado: sem Adicionar (as seções continuam, só para consulta)', async () => {
    estado.paciente = { ...estado.paciente, status: 'bloqueado' };
    const html = await render();
    expect(html).not.toContain('data-guia="adicionar-prontuario"');
    expect(html).not.toContain('Adicionar ao prontuário');
    expect(html).toContain('Antropometria (5)');
    // o aviso do antigo Resumo (o mesmo do Perfil), no topo do Início
    expect(MSG_BLOQUEADO).toBe('Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.');
    expect(html.startsWith(`<div class="space-y-6"><p role="status">${MSG_BLOQUEADO}</p>`)).toBe(true);
  });

  it('o aviso de bloqueado só aparece para o paciente bloqueado', async () => {
    expect(await render()).not.toContain(MSG_BLOQUEADO);
    estado.paciente = { ...estado.paciente, status: 'arquivado' };
    expect(await render()).not.toContain(MSG_BLOQUEADO);
  });

  it('anonimizado: sem Adicionar', async () => {
    estado.paciente = { ...estado.paciente, status: 'arquivado', anonimizadoEm: new Date('2026-10-01T12:00:00Z') };
    expect(await render()).not.toContain('data-guia="adicionar-prontuario"');
  });

  it('arquivado: com Adicionar (cada aba continua deixando registrar)', async () => {
    estado.paciente = { ...estado.paciente, status: 'arquivado' };
    expect(await render()).toContain('data-guia="adicionar-prontuario"');
  });

  it('o bloco da IA (US-120) continua no Início, como estava', async () => {
    estado.ia = { podePedir: true, aviso: null };
    const html = await render();
    expect(html).toMatch(/<h2 id="ia-titulo"[^>]*>Inteligência artificial<\/h2>/);
    expect(html).toContain(`href="${BASE}/resumo-ia"`);
  });

  describe('nota "Cadastro incompleto" (RN-269, RN-276)', () => {
    const resumo = (html: string) => html.match(/<section aria-labelledby="resumo-titulo"[\s\S]*?<\/section>/)?.[0] ?? '';

    it('no cartão Resumo: o texto exato, sem papel de região viva, e o link "Completar no Perfil" (sem prefetch: o Perfil audita)', async () => {
      estado.incompleto = 'Cadastro incompleto: faltam estado civil e endereço.';
      const html = await render();
      const cartao = resumo(html);
      expect(cartao).toContain('Cadastro incompleto: faltam estado civil e endereço.');
      const nota = cartao.match(/<p[^>]*>Cadastro incompleto:[\s\S]*?<\/p>/)?.[0] ?? '';
      expect(nota).not.toMatch(/role=/);
      expect(nota).toMatch(/class="[^"]*\bbg-aviso-fundo\b/);
      expect(nota).toMatch(new RegExp(`<a[^>]*href="${BASE}/perfil"[^>]*>Completar no Perfil</a>`));
      expect(estado.incompletoPedido).toEqual([PACIENTE]);
    });

    it('com 4 ou mais faltando, o texto com a quantidade', async () => {
      estado.incompleto = 'Cadastro incompleto: faltam 6 dados.';
      const cartao = resumo(await render());
      expect(cartao).toContain('Cadastro incompleto: faltam 6 dados.');
      expect(cartao).toContain('Completar no Perfil');
    });

    it('cadastro completo: sem nota e sem link', async () => {
      const html = await render();
      expect(html).not.toContain('Cadastro incompleto');
      expect(html).not.toContain('Completar no Perfil');
    });

    it('bloqueado ou anonimizado: sem nota (o Perfil é só para consulta) e sem consultar a presença', async () => {
      estado.incompleto = 'Cadastro incompleto: faltam 6 dados.';
      estado.paciente = { ...estado.paciente, status: 'bloqueado' };
      expect(await render()).not.toContain('Cadastro incompleto');
      estado.paciente = { ...estado.paciente, status: 'arquivado', anonimizadoEm: new Date('2026-10-01T12:00:00Z') };
      expect(await render()).not.toContain('Cadastro incompleto');
      expect(estado.incompletoPedido).toEqual([]);
    });
  });

  describe('No app do paciente (Tarefa 9: D16, RN-279, US-264)', () => {
    const cartao = (html: string) => html.match(/<section[^>]*aria-labelledby="no-app-titulo"[\s\S]*?<\/section>/)?.[0] ?? '';
    const secaoHtml = (html: string, titulo: string) => html.match(new RegExp(`<details[^>]*>(?:(?!</details>)[\\s\\S])*?${titulo} \\(\\d+\\)[\\s\\S]*?</details>`))?.[0] ?? '';

    it('o cartão ao lado do Resumo (US-264): acesso ativo, plano, documentos e conteúdos e "Ver detalhes" para a página', async () => {
      const c = cartao(await render());
      expect(c).toContain('data-guia="no-app-cartao"');
      expect(c).toMatch(/<h2 id="no-app-titulo"[^>]*>No app do paciente<\/h2>/);
      expect(c).toContain('Acesso: ativo · último acesso em 14/11/2026');
      expect(c).toContain('Plano alimentar publicado');
      expect(c).toContain('2 documentos · 12 conteúdos');
      expect(c).toMatch(new RegExp(`<a[^>]*href="${BASE}/app"[^>]*>Ver detalhes</a>`));
    });

    it('a contagem recebe os ids dos itens mostrados, por seção, e o selo "No app" sai só nos visíveis', async () => {
      const html = await render();
      expect(estado.noAppPedidos).toHaveLength(1);
      expect(estado.noAppPedidos[0][1]).toBe(PACIENTE);
      expect(estado.noAppPedidos[0][2]).toEqual({ 'plano-alimentar': ['plano-alimentar-1'], antropometria: ['antropometria-1'], 'gasto-energetico': [], anamneses: ['anamneses-1'], atendimentos: [], exames: [], documentos: [] });
      expect(secaoHtml(html, 'Plano alimentar')).toMatch(/<\/a><span[^>]*>No app<\/span>/);
      expect(secaoHtml(html, 'Antropometria')).not.toContain('No app');
      expect(secaoHtml(html, 'Anamneses')).not.toContain('No app');
    });

    it('peso oculto: a seção Antropometria diz "Peso e IMC ocultos no app."; sem ele, não', async () => {
      expect(secaoHtml(await render(), 'Antropometria')).not.toContain('Peso e IMC ocultos no app.');
      estado.noApp = { ...estado.noApp, pesoOculto: true };
      const html = await render();
      expect(secaoHtml(html, 'Antropometria')).toContain('Peso e IMC ocultos no app.');
      expect(secaoHtml(html, 'Plano alimentar')).not.toContain('Peso e IMC');
    });

    it('convite pendente: "Ainda não entrou no app." com o texto do convite, sem contagens', async () => {
      estado.noApp = { ...estado.noApp, acesso: { estado: 'pendente', ultimoAcesso: null, textoDoConvite: 'Convite enviado por e-mail. Vale até 20/11/2026, 10:00.' }, contagens: null, visiveis: {} };
      const c = cartao(await render());
      expect(c).toContain('Ainda não entrou no app. Convite enviado por e-mail. Vale até 20/11/2026, 10:00.');
      expect(c).not.toContain('documentos');
      expect(c).not.toContain('conteúdos');
      expect(c).not.toContain('Plano alimentar publicado');
    });

    it('arquivado: "Paciente arquivado: não vê nada no app até ser reativado."', async () => {
      estado.paciente = { ...estado.paciente, status: 'arquivado' };
      estado.noApp = { ...estado.noApp, acesso: { estado: 'arquivado', ultimoAcesso: null, textoDoConvite: null }, contagens: null, visiveis: {} };
      const c = cartao(await render());
      expect(c).toContain('Paciente arquivado: não vê nada no app até ser reativado.');
      expect(c).not.toContain('conteúdos');
    });
  });
});
