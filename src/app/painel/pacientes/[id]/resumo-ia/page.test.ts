import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EsperaDaIa } from '@/app/painel/ia/espera-da-ia';
import { MSG_RESUMO } from '@/modules/ia/constantes';

// Revisão da T11: a região viva da espera fica no MESMO lugar da página em todas as situações. Assim, quando o
// EstadoTarefa recarrega a página (router.refresh), o React mantém o mesmo nó e só troca o texto dentro dele, e o
// leitor de tela anuncia o fim da espera. Só a montagem; prontuário, tarefas e resumo simulados.
const estado = vi.hoisted(() => ({ ultima: null as null | { id: string; status: string; erro: string | null }, resumo: null as unknown }));
vi.mock('@/app/painel/ia/estado-tarefa', () => ({ EstadoTarefa: () => null }));
vi.mock('../prontuario', () => ({ carregarProntuario: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' }, paciente: { id: 'p1', status: 'ativo' } }) }));
vi.mock('../ia-assistente', () => ({ iaDoAssistente: async () => ({ podePedir: true, aviso: null }), textoDaFalha: (_e: unknown, o: { padrao: string }) => o.padrao }));
vi.mock('@/env', () => ({ getEnv: () => ({}) }));
vi.mock('@/modules/ia/modo', () => ({ configIA: () => ({ destino: null }) }));
vi.mock('@/modules/ia/resumo', () => ({ ultimaTarefaDoTipo: async () => estado.ultima, abrirResumo: async () => estado.resumo }));
vi.mock('./actions', () => ({ pedirResumoAction: vi.fn(), descartarResumoAction: vi.fn() }));
vi.mock('./copiar', () => ({ Copiar: () => null }));
vi.mock('./resumo-form', () => ({ ResumoForm: () => null }));
const { default: ResumoIaPage } = await import('./page');

const RESUMO = { tarefaId: 't1', geradoEm: new Date('2026-10-14T12:00:00Z'), secoes: [], fontes: [], retiradas: 0, tabela: [], notasPrivadas: false };
const pagina = async (tarefa?: string) =>
  (await ResumoIaPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve(tarefa ? { tarefa } : {}) } as never)) as ReactElement<{ children: ReactNode[] }>;
const posicaoDaEspera = (el: ReactElement<{ children: ReactNode[] }>) => el.props.children.flatMap((c, i) => (isValidElement(c) && c.type === EsperaDaIa ? [i] : []));

describe('/painel/pacientes/[id]/resumo-ia: o fim da espera é anunciado (revisão da T11)', () => {
  beforeEach(() => {
    estado.ultima = null;
    estado.resumo = null;
  });

  it('a região viva fica no mesmo lugar em andamento, pronto, falhou e sem tarefa; o texto troca dentro dela', async () => {
    estado.ultima = { id: 't1', status: 'processando', erro: null };
    const andamento = await pagina('t1');
    estado.ultima = { id: 't1', status: 'pronta', erro: null };
    estado.resumo = RESUMO;
    const pronto = await pagina('t1');
    estado.ultima = { id: 't1', status: 'falhou', erro: 'provedor' };
    estado.resumo = null;
    const falhou = await pagina('t1');
    estado.ultima = null;
    const nada = await pagina();
    const posicoes = [andamento, pronto, falhou, nada].map(posicaoDaEspera);
    expect(posicoes[0]).toHaveLength(1);
    for (const p of posicoes) expect(p).toEqual(posicoes[0]);

    const html = (el: ReactElement) => renderToStaticMarkup(el);
    expect(html(andamento)).toMatch(new RegExp(`<div aria-live="polite"[^>]*><p>${MSG_RESUMO.preparando}</p></div>`));
    expect(html(pronto)).toMatch(new RegExp(`<div aria-live="polite"[^>]*><p class="sr-only">${MSG_RESUMO.pronto}</p></div>`));
    expect(html(falhou)).toMatch(new RegExp(`<div aria-live="polite"[^>]*><p class="[^"]*">${MSG_RESUMO.falha}</p></div>`));
    for (const el of [andamento, pronto, falhou, nada]) expect(html(el).match(/aria-live/g)).toHaveLength(1);
  });
});
