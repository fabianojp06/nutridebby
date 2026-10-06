import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sessao = { data: { user: { id: '00000000-0000-4000-8000-000000000002' } }, tenant: { id: '00000000-0000-4000-8000-000000000001' }, ctx: { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002', ip: '203.0.113.9' } };
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const ativar = vi.fn();
vi.mock('@/modules/ia/ativacao', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/ativacao')>()), ativarIa: ativar }));
const { ativarIaAction } = await import('./actions');
const { AtivacaoIaError } = await import('@/modules/ia/ativacao');

beforeEach(() => vi.clearAllMocks());

describe('Configurações > Inteligência artificial (US-101)', () => {
  it('usa a usuária, o consultório e o IP da SESSÃO (nunca do formulário) e o aceite marcado', async () => {
    const fd = new FormData();
    fd.set('aceite', '1');
    fd.set('tenantId', 'outro'); // ignorado
    expect(await ativarIaAction({}, fd)).toEqual({ ok: true });
    expect(ativar).toHaveBeenCalledWith({ userId: sessao.data.user.id, tenantId: sessao.tenant.id, ip: '203.0.113.9' }, true);
  });

  it('erro de ativação volta como mensagem da tela', async () => {
    ativar.mockRejectedValueOnce(new AtivacaoIaError('A IA ainda não foi liberada para o seu consultório.'));
    expect(await ativarIaAction({}, new FormData())).toEqual({ erro: 'A IA ainda não foi liberada para o seu consultório.' });
  });
});
