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
  ordem.push('pedirRascunhoIa');
  return TAREFA;
});
const usar = vi.fn(async () => {
  ordem.push('usarComoRascunho');
  return { planId: PLANO, foraDoCatalogo: 0 };
});
const descartar = vi.fn(async () => true);
vi.mock('@/modules/ia/rascunho-ia', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/rascunho-ia')>()), pedirRascunhoIa: pedir, usarComoRascunho: usar }));
vi.mock('@/modules/ia/conferencia', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/conferencia')>()), descartarSugestao: descartar }));

const { pedirRascunhoIaAction, usarComoRascunhoAction, descartarRascunhoIaAction } = await import('./actions');
const { MetasError, RascunhoExisteError, RascunhoIaError } = await import('@/modules/ia/rascunho-ia');
const { PedidoIaError } = await import('@/modules/ia/tarefas');
const { MSG_IA, MSG_RASCUNHO_IA } = await import('@/modules/ia/constantes');

const P = '00000000-0000-4000-8000-0000000000aa';
const TAREFA = '00000000-0000-4000-8000-0000000000bb';
const PLANO = '00000000-0000-4000-8000-0000000000cc';
beforeEach(() => {
  vi.clearAllMocks();
  ordem.length = 0;
});

function formularioDasMetas(): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ metaKcal: '1800', proteinaPct: '20', carboidratoPct: '50', lipidioPct: '30', restricoes: 'Sem lactose' })) fd.set(k, v);
  fd.append('refeicaoNome', 'Café da manhã');
  fd.append('refeicaoHorario', '07:00');
  fd.append('refeicaoNome', 'Almoço');
  fd.append('refeicaoHorario', '12:30');
  return fd;
}

describe('ações do rascunho com IA (US-121, US-122)', () => {
  it('pedir: requireNutri primeiro; monta as metas do formulário (refeições na ordem) e redireciona para a tarefa', async () => {
    const fd = formularioDasMetas();
    fd.set('considerarAnamnese', 'on');
    await expect(pedirRascunhoIaAction(P, {}, fd)).rejects.toMatchObject({ url: `/painel/pacientes/${P}/plano-alimentar/rascunho-ia?tarefa=${TAREFA}` });
    expect(ordem).toEqual(['requireNutri', 'pedirRascunhoIa']);
    expect(pedir).toHaveBeenCalledWith(
      sessao.ctx,
      sessao.tenant,
      P,
      {
        metaKcal: '1800', proteinaPct: '20', carboidratoPct: '50', lipidioPct: '30', restricoes: 'Sem lactose', considerarAnamnese: true,
        refeicoes: [{ nome: 'Café da manhã', horario: '07:00' }, { nome: 'Almoço', horario: '12:30' }],
      },
      { ia: expect.objectContaining({ modo: 'fake', destino: 'teste' }) },
    );
  });

  it('pedir: "Considerar a anamnese" desmarcada vai como false', async () => {
    await expect(pedirRascunhoIaAction(P, {}, formularioDasMetas())).rejects.toMatchObject({ url: expect.stringContaining('?tarefa=') });
    expect(pedir).toHaveBeenLastCalledWith(sessao.ctx, sessao.tenant, P, expect.objectContaining({ considerarAnamnese: false }), expect.anything());
  });

  it('pedir: MetasError volta com os erros por campo; PedidoIaError com { erro }', async () => {
    pedir.mockRejectedValueOnce(new MetasError({ metaKcal: MSG_RASCUNHO_IA.meta, macros: MSG_RASCUNHO_IA.soma, 'refeicao:1:horario': 'x' }));
    expect(await pedirRascunhoIaAction(P, {}, formularioDasMetas())).toEqual({ erros: { metaKcal: MSG_RASCUNHO_IA.meta, macros: MSG_RASCUNHO_IA.soma, 'refeicao:1:horario': 'x' } });
    pedir.mockRejectedValueOnce(new PedidoIaError(MSG_RASCUNHO_IA.emAndamento));
    expect(await pedirRascunhoIaAction(P, {}, formularioDasMetas())).toEqual({ erro: MSG_RASCUNHO_IA.emAndamento });
  });

  it('usar: requireNutri primeiro; sem rascunho → editor com "?ia=criado"; substituir só com substituir=1', async () => {
    await expect(usarComoRascunhoAction(P, TAREFA, {}, new FormData())).rejects.toMatchObject({ url: `/painel/pacientes/${P}/plano-alimentar/${PLANO}?ia=criado` });
    expect(ordem).toEqual(['requireNutri', 'usarComoRascunho']);
    expect(usar).toHaveBeenLastCalledWith(sessao.ctx, P, TAREFA, { substituir: false }, { destino: 'teste' });
    const fd = new FormData();
    fd.set('substituir', 'sim');
    await expect(usarComoRascunhoAction(P, TAREFA, {}, fd)).rejects.toMatchObject({ url: expect.stringContaining('?ia=criado') });
    expect(usar).toHaveBeenLastCalledWith(sessao.ctx, P, TAREFA, { substituir: false }, expect.anything());
    fd.set('substituir', '1');
    await expect(usarComoRascunhoAction(P, TAREFA, {}, fd)).rejects.toMatchObject({ url: expect.stringContaining('?ia=criado') });
    expect(usar).toHaveBeenLastCalledWith(sessao.ctx, P, TAREFA, { substituir: true }, expect.anything());
  });

  it('usar: itens fora do catálogo vão na URL (&fora=n)', async () => {
    usar.mockResolvedValueOnce({ planId: PLANO, foraDoCatalogo: 2 });
    await expect(usarComoRascunhoAction(P, TAREFA, {}, new FormData())).rejects.toMatchObject({ url: `/painel/pacientes/${P}/plano-alimentar/${PLANO}?ia=criado&fora=2` });
  });

  it('usar: já existe rascunho → { confirmar: true }; sugestão indisponível → "Esta sugestão não está mais disponível."', async () => {
    usar.mockRejectedValueOnce(new RascunhoExisteError());
    expect(await usarComoRascunhoAction(P, TAREFA, {}, new FormData())).toEqual({ confirmar: true });
    usar.mockRejectedValueOnce(new RascunhoIaError(MSG_IA.indisponivelSugestao));
    expect(await usarComoRascunhoAction(P, TAREFA, {}, new FormData())).toEqual({ erro: 'Esta sugestão não está mais disponível.' });
  });

  it('descartar a sugestão: descartarSugestao e volta à tela; id inválido → 404', async () => {
    await expect(descartarRascunhoIaAction(P, TAREFA)).rejects.toMatchObject({ url: `/painel/pacientes/${P}/plano-alimentar/rascunho-ia` });
    expect(descartar).toHaveBeenCalledWith(sessao.ctx, P, TAREFA);
    await expect(descartarRascunhoIaAction(P, 'nao-e-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(descartar).toHaveBeenCalledTimes(1);
  });
});
