import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sessao = { data: { user: { id: '00000000-0000-4000-8000-000000000002' } }, tenant: { id: '00000000-0000-4000-8000-000000000001' }, ctx: { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002', ip: '203.0.113.9' } };
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/env', async (orig) => ({ ...(await orig<typeof import('@/env')>()), getEnv: () => ({ IA_PROVEDOR: 'fake', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_MODELO_ASSISTENTE: 'claude-sonnet-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50, IA_TETO_RASCUNHO_USD: 1 }) }));
const ativar = vi.fn();
vi.mock('@/modules/ia/ativacao', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/ativacao')>()), ativarIa: ativar }));
const pedir = vi.fn();
vi.mock('@/modules/ia/modelos-sugeridos', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/modelos-sugeridos')>()), pedirModelos: pedir }));
const ativarNutri = vi.fn();
const desativarNutri = vi.fn();
vi.mock('@/modules/ia/nutri-paciente/participacao', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/nutri-paciente/participacao')>()), ativarIaNutri: ativarNutri, desativarIaNutri: desativarNutri }));
const { ativarIaAction, ativarIaNutriAction, desativarIaNutriAction, pedirModelosAction } = await import('./actions');
const { IaNutriError } = await import('@/modules/ia/nutri-paciente/participacao');
const { MSG_IA_NUTRI } = await import('@/modules/ia/nutri-paciente/constantes');
const { revalidatePath } = await import('next/cache');
const { AtivacaoIaError } = await import('@/modules/ia/ativacao');
const real = await vi.importActual<typeof import('@/modules/ia/modelos-sugeridos')>('@/modules/ia/modelos-sugeridos');
const { PedidoIaError } = await import('@/modules/ia/tarefas');

beforeEach(() => vi.clearAllMocks());

describe('Configurações > Inteligência artificial (US-101)', () => {
  it('usa a usuária, o consultório e o IP da SESSÃO (nunca do formulário) e o aceite marcado', async () => {
    const fd = new FormData();
    fd.set('aceite', '1');
    fd.set('tenantId', 'outro'); // ignorado
    // A confirmação "IA ativada." vai pela URL: o formulário some quando a seção passa para o ramo "ativa".
    await expect(ativarIaAction({}, fd)).rejects.toThrow('redirect /painel/configuracoes?ia=ativada');
    expect(ativar).toHaveBeenCalledWith({ userId: sessao.data.user.id, tenantId: sessao.tenant.id, ip: '203.0.113.9' }, true);
  });

  it('erro de ativação volta como mensagem da tela', async () => {
    ativar.mockRejectedValueOnce(new AtivacaoIaError('A IA ainda não foi liberada para o seu consultório.'));
    expect(await ativarIaAction({}, new FormData())).toEqual({ erro: 'A IA ainda não foi liberada para o seu consultório.' });
  });
});

describe('Configurações > Modelos sugeridos pela IA (US-123)', () => {
  it('área fora da lista (formulário adulterado): "Escolha uma das áreas da lista." pela validação do módulo', async () => {
    pedir.mockImplementationOnce(real.pedirModelos);
    const fd = new FormData();
    fd.set('area', 'cardiologia');
    expect(await pedirModelosAction({}, fd)).toEqual({ erro: 'Escolha uma das áreas da lista.' });
  });

  it('área válida: o consultório e a usuária vêm da sessão; redireciona com ?modelos=pedido para a seção dos modelos', async () => {
    const fd = new FormData();
    fd.set('area', 'diabetes');
    fd.set('tenantId', 'outro'); // ignorado
    // a seção dos modelos é a última de Configurações: a âncora leva a tela até a confirmação (revisão da T5, Important)
    await expect(pedirModelosAction({}, fd)).rejects.toThrow('redirect /painel/configuracoes?modelos=pedido#modelos-ia');
    expect(pedir).toHaveBeenCalledWith(sessao.ctx, sessao.tenant, 'diabetes', { ia: expect.objectContaining({ modo: 'fake', modeloAssistente: 'claude-sonnet-5-5' }) });
  });

  it('recusa do pedido (um por vez, cota, IA indisponível) volta como mensagem da tela', async () => {
    pedir.mockRejectedValueOnce(new PedidoIaError('Já há um pacote de modelos em preparo. Aguarde terminar.'));
    const fd = new FormData();
    fd.set('area', 'diabetes');
    expect(await pedirModelosAction({}, fd)).toEqual({ erro: 'Já há um pacote de modelos em preparo. Aguarde terminar.' });
  });
});

describe('Configurações > IA Nutri (pacientes) (US-170)', () => {
  it('ativar: o consultório da SESSÃO, o retorno na URL com a âncora da subseção e o menu revalidado', async () => {
    await expect(ativarIaNutriAction()).rejects.toThrow('redirect /painel/configuracoes?ia-nutri=ativada#ia-nutri-titulo');
    expect(ativarNutri).toHaveBeenCalledWith(sessao.ctx, { ia: expect.objectContaining({ modo: 'fake', destino: 'teste' }) });
    expect(revalidatePath).toHaveBeenCalledWith('/painel', 'layout');
  });

  it('IaNutriError (IA indisponível ou aditivo antigo) → ?ia-nutri=indisponivel; outro erro sobe', async () => {
    ativarNutri.mockRejectedValueOnce(new IaNutriError(MSG_IA_NUTRI.aditivoNovo));
    await expect(ativarIaNutriAction()).rejects.toThrow('redirect /painel/configuracoes?ia-nutri=indisponivel#ia-nutri-titulo');
    ativarNutri.mockRejectedValueOnce(new Error('banco caiu'));
    await expect(ativarIaNutriAction()).rejects.toThrow('banco caiu');
  });

  it('desativar: o consultório da sessão e ?ia-nutri=desativada', async () => {
    await expect(desativarIaNutriAction()).rejects.toThrow('redirect /painel/configuracoes?ia-nutri=desativada#ia-nutri-titulo');
    expect(desativarNutri).toHaveBeenCalledWith(sessao.ctx);
  });
});
