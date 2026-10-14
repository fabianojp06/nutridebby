import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sessao = { ctx: { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002' }, tenant: { fuso: 'America/Sao_Paulo' } };
const ordem: string[] = [];
const requireNutri = vi.fn(async () => {
  ordem.push('requireNutri');
  return sessao;
});
vi.mock('@/lib/tenant-session', () => ({ requireNutri }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url: u }); }), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'fake', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_MODELO_ASSISTENTE: 'claude-sonnet-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50, IA_TETO_RASCUNHO_USD: 1, IA_RETENCAO_ZERO: '1' }) }));
const pedir = vi.fn(async () => {
  ordem.push('pedirResumo');
  return { tarefaId: TAREFA, reaproveitada: false };
});
const descartar = vi.fn(async () => true);
vi.mock('@/modules/ia/resumo', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/resumo')>()), pedirResumo: pedir }));
vi.mock('@/modules/ia/conferencia', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/conferencia')>()), descartarSugestao: descartar }));

const { pedirResumoAction, descartarResumoAction } = await import('./actions');
const { PedidoIaError } = await import('@/modules/ia/tarefas');
const { PacienteBloqueadoError, MSG_BLOQUEADO } = await import('@/modules/pacientes/base');
const { MSG_RESUMO } = await import('@/modules/ia/constantes');

const P = '00000000-0000-4000-8000-0000000000aa';
const TAREFA = '00000000-0000-4000-8000-0000000000bb';
beforeEach(() => {
  vi.clearAllMocks();
  ordem.length = 0;
});

describe('ações do resumo do histórico (US-120)', () => {
  it('pedir: requireNutri primeiro; notas desmarcadas e sem "de novo" por padrão; redireciona para a tarefa', async () => {
    await expect(pedirResumoAction(P, {}, new FormData())).rejects.toMatchObject({ url: `/painel/pacientes/${P}/resumo-ia?tarefa=${TAREFA}` });
    expect(ordem).toEqual(['requireNutri', 'pedirResumo']);
    expect(pedir).toHaveBeenCalledWith(sessao.ctx, sessao.tenant, P, { notasPrivadas: false, gerarDeNovo: false }, { ia: expect.objectContaining({ modo: 'fake', destino: 'teste' }) });
  });

  it('pedir: "Incluir notas privadas" só com notas=on; "Gerar de novo" só com deNovo=1', async () => {
    const fd = new FormData();
    fd.set('notas', 'on');
    fd.set('deNovo', '1');
    await expect(pedirResumoAction(P, {}, fd)).rejects.toMatchObject({ url: expect.stringContaining('?tarefa=') });
    expect(pedir).toHaveBeenLastCalledWith(sessao.ctx, sessao.tenant, P, { notasPrivadas: true, gerarDeNovo: true }, expect.anything());
    const outro = new FormData();
    outro.set('notas', 'true');
    outro.set('deNovo', 'sim');
    await expect(pedirResumoAction(P, {}, outro)).rejects.toMatchObject({ url: expect.stringContaining('?tarefa=') });
    expect(pedir).toHaveBeenLastCalledWith(sessao.ctx, sessao.tenant, P, { notasPrivadas: false, gerarDeNovo: false }, expect.anything());
  });

  it('pedir: PedidoIaError e paciente bloqueado voltam como { erro } (texto pronto), sem redirecionar', async () => {
    pedir.mockRejectedValueOnce(new PedidoIaError(MSG_RESUMO.vazio));
    expect(await pedirResumoAction(P, {}, new FormData())).toEqual({ erro: MSG_RESUMO.vazio });
    pedir.mockRejectedValueOnce(new PacienteBloqueadoError());
    expect(await pedirResumoAction(P, {}, new FormData())).toEqual({ erro: MSG_BLOQUEADO });
  });

  it('descartar: requireNutri, descartarSugestao e volta à tela do resumo', async () => {
    await expect(descartarResumoAction(P, TAREFA)).rejects.toMatchObject({ url: `/painel/pacientes/${P}/resumo-ia` });
    expect(requireNutri).toHaveBeenCalledTimes(1);
    expect(descartar).toHaveBeenCalledWith(sessao.ctx, P, TAREFA);
  });

  it('descartar: id inválido → 404, nada descartado', async () => {
    await expect(descartarResumoAction(P, 'nao-e-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(descartarResumoAction('x', TAREFA)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(descartar).not.toHaveBeenCalled();
  });
});
