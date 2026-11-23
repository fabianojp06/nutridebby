import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { secoesDoPortal } from '@/app/p/navegacao';
import { CABECALHO_PEDIDO_DA_COPIA } from '@/app/sw-regras';
import { MSG_PORTAL_MENSAGENS } from '@/modules/mensagens/constantes';
import { Faixa } from './faixa';

// Plano 25, T7 (§4.1 "Portal", §7.3, RN-473, US-443): o link "Mensagens" na linha do consultório da faixa.
const pedido = vi.hoisted(() => ({ cabecalhos: new Headers(), naFaixa: null as number | null }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => pedido.cabecalhos }));
vi.mock('@/modules/mensagens/conversa', () => ({ mensagensNaFaixa: vi.fn(async () => pedido.naFaixa) }));
vi.mock('@/modules/portal/exames-enviados', () => ({ examesVisiveis: async () => true, temEnvioVisivel: async () => false }));
const { mensagensDaFaixa, molduraComExames, molduraDaSecao } = await import('@/app/p/moldura');

const MARCA = { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null };
const faixa = (mensagens?: number | null) =>
  renderToStaticMarkup(createElement(Faixa, { marca: MARCA, titulo: 'Hoje', secoes: secoesDoPortal({ exames: true }), atual: '/p/inicio', mensagens }));
const link = (h: string) => /<a [^>]*href="\/p\/mensagens"[^>]*>([^<]*)<\/a>/.exec(h);
const P = MSG_PORTAL_MENSAGENS.entrada;

describe('Faixa — o link "Mensagens" (Plano 25, T7)', () => {
  beforeEach(() => {
    pedido.cabecalhos = new Headers();
    pedido.naFaixa = null;
  });

  it('sem conversa (null ou ausente): nenhum link', () => {
    expect(faixa(null)).not.toContain('/p/mensagens');
    expect(faixa()).not.toContain('/p/mensagens');
  });

  it('sem não lidas: "Mensagens", sem aria-label; 44 px, à direita na linha do consultório, que quebra (flex-wrap)', () => {
    const h = faixa(0);
    const a = link(h);
    expect(a?.[1]).toBe(P.rotulo);
    expect(a?.[0]).not.toContain('aria-label');
    expect(a?.[0]).toMatch(/class="[^"]*\bmin-h-11\b/);
    expect(a?.[0]).toMatch(/class="[^"]*\bml-auto\b/);
    // na mesma linha de "Acompanhamento com …", que quebra em telas estreitas
    expect(h).toMatch(/<div class="[^"]*\bflex-wrap\b[^"]*"><p[^>]*>(?:(?!<\/div>).)*Acompanhamento com Consultório Debby(?:(?!<\/div>).)*href="\/p\/mensagens"/);
  });

  it('com não lidas: "Mensagens ({n})" com aria-label no singular e no plural', () => {
    const um = link(faixa(1))!;
    expect(um[1]).toBe('Mensagens (1)');
    expect(um[0]).toContain('aria-label="Mensagens, 1 não lida"');
    const tres = link(faixa(3))!;
    expect(tres[1]).toBe('Mensagens (3)');
    expect(tres[0]).toContain('aria-label="Mensagens, 3 não lidas"');
  });

  it('RN-473: o link não faz prefetch (abrir a conversa grava auditRead e avança o "lido")', () => {
    const fonte = readFileSync('src/components/portal/faixa.tsx', 'utf8');
    expect(fonte).toMatch(/<Link\s+href="\/p\/mensagens"\s+prefetch=\{false\}/);
  });
});

describe('moldura da seção — o número do link (Plano 25, T7)', () => {
  beforeEach(() => {
    pedido.cabecalhos = new Headers();
    pedido.naFaixa = null;
  });
  const acesso = { tenant: { nomeExibicao: 'Consultório Debby', corMarca: '#1d6b5a' }, ctx: { tenantId: 't', role: 'paciente', patientId: 'p', actorUserId: 'u' } } as never;

  it('sem conversa → null; com conversa → as não lidas', async () => {
    expect(await mensagensDaFaixa({} as never)).toBeNull();
    pedido.naFaixa = 2;
    expect(await mensagensDaFaixa({} as never)).toBe(2);
    expect((await molduraDaSecao(acesso)).mensagens).toBe(2);
  });

  it('RN-473: na busca da cópia guardada (cabeçalho do service worker), o link sai sem contador; sem conversa continua sem link', async () => {
    pedido.cabecalhos = new Headers({ [CABECALHO_PEDIDO_DA_COPIA]: '1' });
    pedido.naFaixa = 4;
    expect(await mensagensDaFaixa({} as never)).toBe(0);
    expect((await molduraDaSecao(acesso)).mensagens).toBe(0);
    pedido.naFaixa = null;
    expect(await mensagensDaFaixa({} as never)).toBeNull();
  });

  it('Hoje monta a moldura com o número já lido (molduraComExames); sem o número, sem link', () => {
    expect(molduraComExames({ nomeExibicao: 'X', corMarca: '#1d6b5a' } as never, true, 3).mensagens).toBe(3);
    expect(molduraComExames({ nomeExibicao: 'X', corMarca: '#1d6b5a' } as never, true).mensagens).toBeNull();
  });
});
