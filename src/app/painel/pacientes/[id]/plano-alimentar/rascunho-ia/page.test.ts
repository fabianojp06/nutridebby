import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EsperaDaIa } from '@/app/painel/ia/espera-da-ia';
import { MSG_RASCUNHO_IA } from '@/modules/ia/constantes';

// Revisão da T11: a região viva da espera fica no MESMO lugar da página em todas as situações (o router.refresh do
// EstadoTarefa mantém o nó e só troca o texto dentro dele). Só a montagem; prontuário, tarefas e prévia simulados.
const estado = vi.hoisted(() => ({ ultima: null as null | { id: string; status: string; erro: string | null }, previa: null as unknown }));
vi.mock('@/app/painel/ia/estado-tarefa', () => ({ EstadoTarefa: () => null }));
vi.mock('../../prontuario', () => ({ carregarProntuario: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' }, paciente: { id: 'p1', status: 'ativo' } }) }));
vi.mock('../../ia-assistente', () => ({ iaDoAssistente: async () => ({ podePedir: true, aviso: null }), textoDaFalha: (_e: unknown, o: { padrao: string }) => o.padrao }));
vi.mock('@/env', () => ({ getEnv: () => ({}) }));
vi.mock('@/modules/ia/modo', () => ({ configIA: () => ({ destino: null }) }));
vi.mock('@/modules/ia/resumo', () => ({ ultimaTarefaDoTipo: async () => estado.ultima }));
vi.mock('@/modules/ia/rascunho-ia', () => ({ abrirRascunhoIa: async () => estado.previa, metasPadrao: () => ({}) }));
vi.mock('@/modules/plano-alimentar/meta', () => ({ contextoDoPaciente: async () => ({ calculos: [] }) }));
vi.mock('@/modules/plano-alimentar/carregar', () => ({ listarPlanosDoPaciente: async () => [], carregarPlano: async () => null }));
vi.mock('./actions', () => ({ pedirRascunhoIaAction: vi.fn(), usarComoRascunhoAction: vi.fn(), descartarRascunhoIaAction: vi.fn() }));
vi.mock('./metas-form', () => ({ MetasForm: () => null }));
vi.mock('./previa', () => ({ Previa: () => null }));
vi.mock('./usar-form', () => ({ UsarForm: () => null }));
const { default: RascunhoIaPage } = await import('./page');

const pagina = async (tarefa?: string) =>
  (await RascunhoIaPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve(tarefa ? { tarefa } : {}) } as never)) as ReactElement<{ children: ReactNode[] }>;
const posicaoDaEspera = (el: ReactElement<{ children: ReactNode[] }>) => el.props.children.flatMap((c, i) => (isValidElement(c) && c.type === EsperaDaIa ? [i] : []));

describe('/painel/pacientes/[id]/plano-alimentar/rascunho-ia: o fim da espera é anunciado (revisão da T11)', () => {
  beforeEach(() => {
    estado.ultima = null;
    estado.previa = null;
  });

  it('a região viva fica no mesmo lugar em andamento, pronto, falhou e sem tarefa; o texto troca dentro dela', async () => {
    estado.ultima = { id: 't1', status: 'na_fila', erro: null };
    const andamento = await pagina('t1');
    estado.ultima = { id: 't1', status: 'pronta', erro: null };
    estado.previa = { tarefaId: 't1' };
    const pronto = await pagina('t1');
    estado.ultima = { id: 't1', status: 'falhou', erro: 'limite_voltas' };
    estado.previa = null;
    const falhou = await pagina('t1');
    estado.ultima = null;
    const nada = await pagina();
    const posicoes = [andamento, pronto, falhou, nada].map(posicaoDaEspera);
    expect(posicoes[0]).toHaveLength(1);
    for (const p of posicoes) expect(p).toEqual(posicoes[0]);

    const html = (el: ReactElement) => renderToStaticMarkup(el);
    expect(html(andamento)).toMatch(new RegExp(`<div aria-live="polite"[^>]*><p>${MSG_RASCUNHO_IA.gerando}</p></div>`));
    expect(html(pronto)).toMatch(new RegExp(`<div aria-live="polite"[^>]*><p class="sr-only">${MSG_RASCUNHO_IA.pronto}</p></div>`));
    expect(html(falhou)).toMatch(new RegExp(`<div aria-live="polite"[^>]*><p class="[^"]*">${MSG_RASCUNHO_IA.falha}</p></div>`));
    for (const el of [andamento, pronto, falhou, nada]) expect(html(el).match(/aria-live/g)).toHaveLength(1);
  });
});
