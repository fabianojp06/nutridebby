import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';

const s = vi.hoisted(() => ({ entrada: 'decidir' as string, crn: 'CRN-3 12345' as string | null, bind: [] as unknown[][] }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'sandbox', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({
    ctx: {},
    tenant: { id: 't1', nomeExibicao: 'Consultório Debby', nomeProfissional: 'Debora Silva', get crn() { return s.crn; }, contatoEmail: 'contato@debby.test', fuso: 'America/Sao_Paulo' },
  }),
}));
vi.mock('@/modules/ia/nutri-paciente/estado', () => ({ entradaDoPaciente: async () => s.entrada }));
vi.mock('../actions', () => {
  const aceitarIaNutriAction = async () => undefined;
  aceitarIaNutriAction.bind = (...args: unknown[]) => {
    s.bind.push(args);
    return async () => undefined;
  };
  return { aceitarIaNutriAction };
});
const { default: AutorizarIaNutri } = await import('./page');
const pagina = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await AutorizarIaNutri({ searchParams: Promise.resolve(busca) } as never));

beforeEach(() => {
  s.entrada = 'decidir';
  s.crn = 'CRN-3 12345';
  s.bind = [];
});

describe('/p/plano/ia/autorizar — antes de usar a IA Nutri (US-171)', () => {
  it('o título, o texto inteiro do consentimento 1.0 com o destino em uso e a responsável; "Autorizo o uso da IA Nutri" e "Agora não" para a origem', async () => {
    const html = await pagina({ de: 'hoje' });
    expect(html).toMatch(/<h1[^>]*>Antes de usar a IA Nutri<\/h1>/);
    for (const t of ['A IA Nutri é uma inteligência artificial, não é a sua nutricionista.', 'Debora Silva, CRN-3 12345, contato: contato@debby.test', 'Versão 1.0, de 14/10/2026.']) expect(html, t).toContain(t);
    expect(html).toMatch(/<button[^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*>Autorizo o uso da IA Nutri<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/p\/inicio"[^>]*>Agora não<\/a>/);
    expect(html).not.toContain('type="checkbox"'); // sem caixa de seleção (padrão da 14A)
    // o texto mostrado (versão e destino) e a origem vão à ação, que confere antes de gravar
    expect(s.bind).toEqual([[null, 't1', { versao: '1.0', destino: 'teste' }, 'hoje']]);
    expect(html).not.toMatch(/role="status"[^>]*>O texto mudou/);
  });

  it('a origem só da lista fechada: plano e refeição → Plano; eu → o bloco de Eu; qualquer outro valor → plano', async () => {
    expect(await pagina({ de: 'eu' })).toMatch(/<a[^>]*href="\/p\/perfil#eu-ia-nutri"[^>]*>Agora não<\/a>/);
    expect(await pagina({ de: 'refeicao' })).toMatch(/<a[^>]*href="\/p\/plano"[^>]*>Agora não<\/a>/);
    const html = await pagina({ de: 'https://fora.example' });
    expect(html).not.toContain('fora.example');
    expect(html).toMatch(/<a[^>]*href="\/p\/plano"[^>]*>Agora não<\/a>/);
    expect(s.bind.at(-1)?.[3]).toBe('plano');
    expect(html).toContain('Voltar para Plano');
  });

  it('texto mudou (nova versão ou destino) → "O texto mudou. Leia e decida de novo."; vindo do toque (mudou=1) → "…Leia de novo antes de decidir."', async () => {
    s.entrada = 'texto_mudou';
    expect(await pagina()).toMatch(new RegExp(`role="status"[^>]*>${MSG_IA_NUTRI.textoMudou}<`));
    s.entrada = 'decidir';
    expect(await pagina({ mudou: '1' })).toMatch(new RegExp(`role="status"[^>]*>${MSG_IA_NUTRI.textoMudouNoToque}<`));
  });

  it('sem nada a decidir (já consentiu, indisponível, sem plano, nenhuma) ou perfil incompleto → volta à origem', async () => {
    for (const e of ['conversa', 'indisponivel', 'sem_plano', 'nenhuma']) {
      s.entrada = e;
      await expect(pagina({ de: 'eu' }), e).rejects.toThrow('redirect /p/perfil#eu-ia-nutri');
    }
    s.entrada = 'decidir';
    s.crn = null;
    await expect(pagina()).rejects.toThrow('redirect /p/plano');
  });
});
