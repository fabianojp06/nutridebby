import { beforeEach, describe, expect, it, vi } from 'vitest';

const marcarGuia = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ data: { user: { id: 'conta-do-paciente' } } }) }));
vi.mock('@/modules/plataforma/preferencias', async (orig) => ({ ...(await orig<typeof import('@/modules/plataforma/preferencias')>()), marcarGuia }));
const { marcarGuiaPortalAction } = await import('./actions');

describe('marcarGuiaPortalAction (RN-212, CLAUDE.md regra 1)', () => {
  beforeEach(() => marcarGuia.mockClear());
  it('grava o progresso do guia do portal na conta da SESSÃO (o id do guia e a conta não vêm do cliente)', async () => {
    await marcarGuiaPortalAction(1, 'concluido');
    expect(marcarGuia).toHaveBeenCalledWith('conta-do-paciente', 'portal-novidades', 1, 'concluido');
  });
  it('versão ou estado fora do guia: recusa calada (nada gravado, nenhum 500)', async () => {
    for (const [v, e] of [[2, 'concluido'], [0, 'visto'], [1.5, 'visto'], [1, 'apagado']] as const) await marcarGuiaPortalAction(v, e as never);
    expect(marcarGuia).not.toHaveBeenCalled();
  });
});
