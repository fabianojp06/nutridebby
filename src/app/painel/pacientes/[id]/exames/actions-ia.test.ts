import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sessao = { ctx: { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002' }, tenant: { fuso: 'America/Sao_Paulo' } };
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url: u }); }), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'fake', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
const aplicar = vi.fn();
const pedir = vi.fn();
vi.mock('@/modules/ia/conferencia', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/conferencia')>()), aplicarSugestao: aplicar }));
vi.mock('@/modules/ia/tarefas', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/tarefas')>()), pedirLeituraExame: pedir }));

const { aplicarSugestaoAction, pedirLeituraAction } = await import('./actions');
const { ConferenciaError } = await import('@/modules/ia/conferencia');
const { PedidoIaError } = await import('@/modules/ia/tarefas');

const P = '00000000-0000-4000-8000-0000000000aa';
const TAREFA = '00000000-0000-4000-8000-0000000000bb';
beforeEach(() => vi.clearAllMocks());

describe('ações da IA na aba Exames', () => {
  it('aplicar: monta as linhas marcadas a partir do formulário e redireciona com "Valores salvos."', async () => {
    const fd = new FormData();
    fd.append('sel', '0');
    fd.append('sel', '3');
    for (const [k, v] of Object.entries({ 'nome-0': 'Glicemia de jejum', 'valor-0': '92', 'unidade-0': 'mg/dL', 'referencia-0': '70 a 99', 'nome-3': 'Colesterol total', 'valor-3': '190', 'unidade-3': 'mg/dL', 'referencia-3': '', 'nome-1': 'Plaquetas', 'valor-1': '250.000', usarData: '1' })) fd.set(k, v);
    await expect(aplicarSugestaoAction(P, TAREFA, {}, fd)).rejects.toMatchObject({ url: `/painel/pacientes/${P}/exames?ia=salvo` });
    expect(aplicar).toHaveBeenCalledWith(sessao.ctx, sessao.tenant, P, TAREFA, {
      linhas: [
        { indice: 0, nome: 'Glicemia de jejum', valor: '92', unidade: 'mg/dL', referencia: '70 a 99' },
        { indice: 3, nome: 'Colesterol total', valor: '190', unidade: 'mg/dL', referencia: '' },
      ],
      usarData: true,
    }, { destino: 'teste' });
  });

  it('aplicar: erro de conferência volta para a tela, por linha', async () => {
    aplicar.mockRejectedValueOnce(new ConferenciaError({ 'valor-1': 'Confira o valor: o ponto ou a vírgula pode ser de milhar ou decimal. Edite o valor.' }));
    expect(await aplicarSugestaoAction(P, TAREFA, {}, new FormData())).toEqual({ erros: { 'valor-1': 'Confira o valor: o ponto ou a vírgula pode ser de milhar ou decimal. Edite o valor.' } });
  });

  it('pedir: mensagem pronta do PedidoIaError', async () => {
    pedir.mockRejectedValueOnce(new PedidoIaError('A leitura deste laudo já está em andamento.'));
    expect(await pedirLeituraAction(P, TAREFA, {}, new FormData())).toEqual({ erro: 'A leitura deste laudo já está em andamento.' });
  });
});
