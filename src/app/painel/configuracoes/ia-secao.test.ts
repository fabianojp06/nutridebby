import { afterAll, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { closeDb } from '@/db/client';
import { MSG_IA } from '@/modules/ia/constantes';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { TEXTOS_FIXOS } from '@/modules/ia/nutri-paciente/textos';
import { IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import type { PausaIaNutri } from '@/modules/plataforma/ia-nutri-pausa';

// US-101 "E vejo 'IA ativada.'": a confirmação vem da página (?ia=ativada), não do estado do formulário, que some
// quando a seção passa para o ramo "ativa" (revisão da Tarefa 14, Important 1).
vi.mock('server-only', () => ({}));
vi.mock('@/env', async (orig) => ({ ...(await orig<typeof import('@/env')>()), getEnv: () => ({ IA_PROVEDOR: 'fake', IA_MODELO_LEITURA: 'x', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 100, IA_RETENCAO_ZERO: '1' }) }));
// a IA da nutricionista sempre em 0%; a IA Nutri (escopo 'paciente') com o nível pedido pelo teste
const cotaIaNutri = vi.hoisted(() => ({ percentual: 12, nivel: 'ok' as 'ok' | 'aviso' | 'esgotada' }));
vi.mock('@/modules/ia/cota', () => ({
  situacaoDaCotaIa: vi.fn(async (_c: unknown, _t: unknown, _a?: unknown, _d?: unknown, escopo = 'nutri') =>
    escopo === 'paciente' ? { usadoMicroUsd: 0, cotaMicroUsd: 7_000_000, ...cotaIaNutri } : { usadoMicroUsd: 0, cotaMicroUsd: 15_000_000, percentual: 0, nivel: 'normal' }),
}));
vi.mock('./actions', () => ({ desativarIaAction: vi.fn(), ativarIaNutriAction: vi.fn(), desativarIaNutriAction: vi.fn() }));
vi.mock('./ia-ativar-form', () => ({ IaAtivarForm: ({ rotulo }: { rotulo: string }) => `[IaAtivarForm ${rotulo}]` }));
// R5: o componente de servidor assíncrono dos modelos (US-123) lê o banco; aqui só importa onde ele aparece
vi.mock('./modelos-ia', () => ({ ModelosIa: ({ fuso, pedido }: { fuso: string; pedido?: boolean }) => `[ModelosIa ${fuso}${pedido ? ' pedido' : ''}]` }));

// a subseção da IA Nutri é um componente de servidor assíncrono (lê a pausa e a cota): no IaSecao, só importa onde ela
// aparece e o que recebe; o conteúdo dela é conferido abaixo, com o módulo de verdade (vi.importActual)
vi.mock('./ia-nutri-secao', () => ({ IaNutriSecao: ({ retorno }: { retorno?: string | null }) => `[IaNutriSecao ${retorno ?? '-'}]` }));
const { IaSecao } = await import('./ia-secao');
const { IaNutriSecao } = await vi.importActual<typeof import('./ia-nutri-secao')>('./ia-nutri-secao');
afterAll(() => closeDb());

const ctx = { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri' } as TenantContext;
const base = { status: 'ativa', iaLiberada: true, iaAtivadaEm: null, iaAditivoVersao: null, fuso: 'America/Sao_Paulo', iaCotaMensalUsd: 15 };
const ativa = { ...base, iaAtivadaEm: new Date(), iaAditivoVersao: IA_ADITIVO_VERSAO };
const html = async (t: object, ativada?: boolean, modelosPedido?: boolean) => renderToStaticMarkup((await IaSecao({ tenant: t as TenantRow, ctx, ativada, modelosPedido }))!);

describe('Configurações > IA: confirmação "IA ativada." (US-101)', () => {
  it('depois do redirect (?ia=ativada), a seção ativa mostra "IA ativada." como status', async () => {
    const h = await html(ativa, true);
    expect(h).toContain(`role="status" class="rounded-2xl border border-ok bg-ok-fundo p-3 text-ok">${MSG_IA.iaAtivada}</p>`);
    expect(h).toContain(MSG_IA.usoDoMes(0));
  });

  it('sem o parâmetro (visita comum), a seção ativa não repete a confirmação', async () => {
    expect(await html(ativa)).not.toContain(MSG_IA.iaAtivada);
  });

  it('parâmetro forjado com a IA não ativada: nada de "IA ativada.", o formulário continua', async () => {
    const h = await html(base, true);
    expect(h).not.toContain(MSG_IA.iaAtivada);
    expect(h).toContain('[IaAtivarForm Ativar a IA no consultório]');
  });
});

describe('Configurações > IA: modelos sugeridos (US-123 "Onde fica")', () => {
  it('a seção dos modelos aparece só com a IA ativa, com o fuso do consultório', async () => {
    expect(await html(ativa)).toContain('[ModelosIa America/Sao_Paulo]');
    expect(await html(base)).not.toContain('[ModelosIa');
    expect(await html({ ...ativa, iaLiberada: false })).not.toContain('[ModelosIa');
  });

  it('?modelos=pedido chega à seção dos modelos (foco na confirmação "Gerando os modelos de…")', async () => {
    expect(await html(ativa, false, true)).toContain('[ModelosIa America/Sao_Paulo pedido]');
  });
});

// Plano 15 (US-170): a subseção "IA Nutri (pacientes)", dentro da IA ativa, depois dos modelos sugeridos
const PERFIL = { nomeExibicao: 'Consultório Teste', nomeProfissional: 'Debby Silva', crn: 'CRN-3 12345', contatoEmail: 'debby@consultorio.test', iaNutriCotaMensalUsd: 7, iaNutriAtivadaEm: null };
const PAUSADA: PausaIaNutri = { pausadaEm: new Date('2026-10-14T12:00:00Z') };
const nutri = async (t: object, o: { retorno?: 'ativada' | 'desativada' | 'indisponivel' | null; pausa?: PausaIaNutri } = {}) => {
  const el = await IaNutriSecao({ tenant: { ...PERFIL, ...t } as TenantRow, ctx, ...o });
  return el ? renderToStaticMarkup(el) : '';
};
const comAditivo = (v: string) => ({ ...ativa, iaAditivoVersao: v });
/** Os elementos de um tipo na árvore devolvida pelo IaSecao (sem renderizar os componentes assíncronos). */
function acharTodos(no: ReactNode, tipo: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(no)) return no.flatMap((x) => acharTodos(x, tipo));
  if (!isValidElement(no)) return [];
  const el = no as ReactElement<{ children?: ReactNode }>;
  return [...(el.type === tipo ? [el as ReactElement<Record<string, unknown>>] : []), ...acharTodos(el.props.children, tipo)];
}

describe('Configurações > IA Nutri (pacientes) (US-170)', () => {
  it('o IaSecao põe a subseção só com a IA ativa, por último (depois dos modelos e de "Desativar a IA"), e repassa o retorno e a pausa', async () => {
    const { IaNutriSecao: Simulada } = await import('./ia-nutri-secao');
    const el = (await IaSecao({ tenant: ativa as TenantRow, ctx, iaNutriRetorno: 'ativada', pausa: PAUSADA }))!;
    expect(acharTodos(el, Simulada).map((e) => [e.props.retorno, e.props.pausa])).toEqual([['ativada', PAUSADA]]);
    const h = renderToStaticMarkup(el);
    expect(h.indexOf('[ModelosIa')).toBeLessThan(h.indexOf('[IaNutriSecao ativada]'));
    expect(h.indexOf('Desativar a IA<')).toBeLessThan(h.indexOf('[IaNutriSecao ativada]'));
    expect(acharTodos((await IaSecao({ tenant: base as TenantRow, ctx }))!, Simulada)).toEqual([]);
  });

  it('aditivo 1.1 com a IA ativa: o aviso da 1.2 e "Aceitar a versão atual" na subseção; a leitura de laudos continua (o uso do mês da IA)', async () => {
    const h = await nutri(comAditivo('1.1'));
    expect(h).toContain(MSG_IA_NUTRI.aditivoNovo);
    expect(h).toContain('[IaAtivarForm Aceitar a versão atual]');
    expect(h).not.toContain(MSG_IA_NUTRI.ativar);
    expect(renderToStaticMarkup((await IaSecao({ tenant: comAditivo('1.1') as TenantRow, ctx }))!)).toContain(MSG_IA.usoDoMes(0));
  });

  it('desativada (linha real de ia_nutri_pausa, não pausada — ★ DO-1 = não): o que a ativação liga e o protocolo ANTES do botão, sem "rascunho" nem "textos em revisão"', async () => {
    const h = await nutri(ativa);
    const botao = h.indexOf(MSG_IA_NUTRI.ativar);
    expect(botao).toBeGreaterThan(0);
    expect(h.indexOf(MSG_IA_NUTRI.avisoAtivar)).toBeLessThan(botao);
    expect(h.indexOf(MSG_IA_NUTRI.avisoAtivacaoFila.replaceAll('"', '&quot;'))).toBeLessThan(botao);
    for (const l of MSG_IA_NUTRI.protocoloRisco) expect(h.indexOf(l.replaceAll('"', '&quot;')), l).toBeLessThan(botao);
    expect(h.toLowerCase()).not.toContain('rascunho');
    expect(h.toLowerCase()).not.toContain('em revisão');
    // "Veja o que o paciente lê": o consentimento (h4, abaixo do h3 da subseção) e os textos fixos de risco e de recusa
    expect(h).toContain(MSG_IA_NUTRI.vejaOQueOPacienteLe);
    expect(h).toMatch(/<h4 id="consentimento-ia-nutri"/);
    for (const c of ['risco_emergencia', 'risco_transtorno', 'fora_do_escopo'] as const) expect(h).toContain(TEXTOS_FIXOS[c]);
    expect(h).not.toContain(MSG_IA_NUTRI.pausada);
  });

  it('ativada: "Uso da IA Nutri neste mês: {p}% do limite", os avisos de 80% e de esgotada e "Desativar a IA Nutri para pacientes"', async () => {
    const ativada = { ...ativa, iaNutriAtivadaEm: new Date() };
    cotaIaNutri.nivel = 'ok';
    let h = await nutri(ativada);
    expect(h).toContain(MSG_IA_NUTRI.usoDoMes(12));
    expect(h).toContain(MSG_IA_NUTRI.desativarConsultorio);
    expect(h).not.toContain(MSG_IA_NUTRI.ativar);
    expect(h).not.toContain(MSG_IA_NUTRI.aviso80);
    cotaIaNutri.nivel = 'aviso';
    expect(await nutri(ativada)).toContain(MSG_IA_NUTRI.aviso80);
    cotaIaNutri.nivel = 'esgotada';
    h = await nutri(ativada);
    expect(h).toContain(MSG_IA_NUTRI.cotaAcabou);
    cotaIaNutri.nivel = 'ok';
  });

  it('pausa de EMERGÊNCIA num consultório que nunca ativou → nenhuma subseção, nada de "pausada pelo suporte"; já ativada → o aviso de pausa', async () => {
    expect(await nutri(ativa, { pausa: PAUSADA })).toBe('');
    const h = await nutri({ ...ativa, iaNutriAtivadaEm: new Date() }, { pausa: PAUSADA });
    expect(h).toContain(MSG_IA_NUTRI.pausada);
    expect(h).toContain(MSG_IA_NUTRI.desativarConsultorio);
  });

  it('o retorno das actions aparece dentro da subseção, na região role="status" sempre montada logo abaixo do título', async () => {
    expect(await nutri(ativa, { retorno: 'ativada' })).toContain(`<h3 id="ia-nutri-titulo" class="font-semibold">IA Nutri (pacientes)</h3><p role="status">${MSG_IA_NUTRI.ativada}</p>`);
    expect(await nutri(ativa)).toContain('<h3 id="ia-nutri-titulo" class="font-semibold">IA Nutri (pacientes)</h3><p role="status"></p>');
    expect(await nutri(ativa, { retorno: 'indisponivel' })).toContain(`<p role="status">${MSG_IA_NUTRI.naoDisponivel}</p>`);
  });
});
