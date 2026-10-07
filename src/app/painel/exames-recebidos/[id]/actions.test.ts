import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sessao = { ctx: { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002' }, tenant: { fuso: 'America/Sao_Paulo' } };
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url: u }); }), notFound: vi.fn() }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'fake', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
const aceitar = vi.fn();
const recusar = vi.fn();
const pedir = vi.fn();
vi.mock('@/modules/pacientes/exames-enviados', async (orig) => ({ ...(await orig<typeof import('@/modules/pacientes/exames-enviados')>()), aceitarEnvio: aceitar, recusarEnvio: recusar }));
vi.mock('@/modules/ia/tarefas', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/tarefas')>()), pedirLeituraExame: pedir }));

const { aceitarEnvioAction, recusarEnvioAction } = await import('./actions');
const { RevisaoError } = await import('@/modules/pacientes/exames-enviados');
const { PedidoIaError } = await import('@/modules/ia/tarefas');
const { MSG_IA } = await import('@/modules/ia/constantes');

const ENVIO = '00000000-0000-4000-8000-0000000000e1';
const P = '00000000-0000-4000-8000-0000000000aa';
const EXAME = '00000000-0000-4000-8000-0000000000bb';
const fd = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
beforeEach(() => {
  vi.clearAllMocks();
  aceitar.mockResolvedValue({ examId: EXAME, patientId: P });
});

describe('ações da revisão do envio (US-163, US-164)', () => {
  it('"Salvar no prontuário": aceita com título e data e vai ao prontuário com "Exame salvo no prontuário."; sem leitura por IA', async () => {
    await expect(aceitarEnvioAction(ENVIO, {}, fd({ titulo: 'Hemograma', data: '2026-09-28' }))).rejects.toMatchObject({ url: `/painel/pacientes/${P}/exames?envio=salvo` });
    expect(aceitar).toHaveBeenCalledWith(sessao.ctx, sessao.tenant, ENVIO, { titulo: 'Hemograma', data: '2026-09-28' });
    expect(pedir).not.toHaveBeenCalled();
  });

  it('"Aceitar e ler valores com IA": aceita e DEPOIS pede a leitura; a recusa da IA não desfaz o aceite e vai como chave', async () => {
    await expect(aceitarEnvioAction(ENVIO, {}, fd({ titulo: 'Hemograma', data: '2026-09-28', ler: '1' }))).rejects.toMatchObject({ url: `/painel/pacientes/${P}/exames?envio=salvo` });
    expect(pedir).toHaveBeenCalledWith(sessao.ctx, sessao.tenant, P, EXAME, expect.objectContaining({ ia: expect.objectContaining({ modo: 'fake' }) }));
    pedir.mockRejectedValueOnce(new PedidoIaError(MSG_IA.cotaAcabou));
    await expect(aceitarEnvioAction(ENVIO, {}, fd({ titulo: 'Hemograma', data: '2026-09-28', ler: '1' }))).rejects.toMatchObject({ url: `/painel/pacientes/${P}/exames?envio=salvo&iaMsg=ia.cotaAcabou` });
  });

  it('erros da revisão voltam à tela (corridas, título, motivo); recusa vai à fila com "Envio recusado."', async () => {
    aceitar.mockRejectedValueOnce(new RevisaoError({ geral: 'Este envio foi cancelado pelo paciente.' }));
    expect(await aceitarEnvioAction(ENVIO, {}, fd({ titulo: 'X', data: '2026-09-28' }))).toEqual({ erros: { geral: 'Este envio foi cancelado pelo paciente.' }, valores: { titulo: 'X', data: '2026-09-28' } });
    recusar.mockRejectedValueOnce(new RevisaoError({ texto: 'Escreva o motivo para o paciente' }));
    expect(await recusarEnvioAction(ENVIO, {}, fd({ motivo: 'outro', texto: '' }))).toEqual({ erros: { texto: 'Escreva o motivo para o paciente' }, valores: { motivo: 'outro', texto: '' } });
    await expect(recusarEnvioAction(ENVIO, {}, fd({ motivo: 'ilegivel' }))).rejects.toMatchObject({ url: '/painel/exames-recebidos?recusado=1' });
    expect(recusar).toHaveBeenLastCalledWith(sessao.ctx, ENVIO, { motivo: 'ilegivel', texto: null });
  });
});
