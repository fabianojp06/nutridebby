import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { MSG_IA } from '@/modules/ia/constantes';
import { IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';

// US-101 "E vejo 'IA ativada.'": a confirmação vem da página (?ia=ativada), não do estado do formulário, que some
// quando a seção passa para o ramo "ativa" (revisão da Tarefa 14, Important 1).
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'fake', IA_MODELO_LEITURA: 'x', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 100 }) }));
vi.mock('@/modules/ia/cota', () => ({ situacaoDaCotaIa: vi.fn(async () => ({ usadoMicroUsd: 0, cotaMicroUsd: 15_000_000, percentual: 0, nivel: 'normal' })) }));
vi.mock('./actions', () => ({ desativarIaAction: vi.fn() }));
vi.mock('./ia-ativar-form', () => ({ IaAtivarForm: ({ rotulo }: { rotulo: string }) => `[IaAtivarForm ${rotulo}]` }));

const { IaSecao } = await import('./ia-secao');

const ctx = { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri' } as TenantContext;
const base = { status: 'ativa', iaLiberada: true, iaAtivadaEm: null, iaAditivoVersao: null, fuso: 'America/Sao_Paulo', iaCotaMensalUsd: 15 };
const ativa = { ...base, iaAtivadaEm: new Date(), iaAditivoVersao: IA_ADITIVO_VERSAO };
const html = async (t: object, ativada?: boolean) => renderToStaticMarkup((await IaSecao({ tenant: t as TenantRow, ctx, ativada }))!);

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
