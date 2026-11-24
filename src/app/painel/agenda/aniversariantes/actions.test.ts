import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Plano 23 (US-414, revisão da T10, M5): a costura das ações da lista de aniversariantes — sessão, volta pela URL e o
 * tratamento de `PacienteNaoEncontradoError` (as regras ficam em src/modules/agenda/aniversarios.test.ts, contra o banco).
 */
const s = vi.hoisted(() => ({ retirar: vi.fn(), registrar: vi.fn(), revalidados: [] as string[] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: async () => ({ ctx: { tenantId: 't1', role: 'nutri', actorUserId: 'u1' }, tenant: { fuso: 'America/Sao_Paulo' } }) }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => void s.revalidados.push(p) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));
vi.mock('@/modules/agenda/aniversarios', async (orig) => ({
  ...(await orig<typeof import('@/modules/agenda/aniversarios')>()),
  retirarAutorizacao: s.retirar,
  registrarAutorizacao: s.registrar,
}));
const { PacienteNaoEncontradoError } = await import('@/modules/pacientes/base');
const { registrarAction, retirarAction } = await import('./actions');
const ID = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
const url = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as { url?: string } | null)?.url ?? '';

beforeEach(() => {
  s.retirar.mockReset();
  s.registrar.mockReset();
  s.revalidados = [];
});

describe('ações de Aniversariantes', () => {
  it('"Retirar autorização": volta à lista do mês com "Autorização retirada." (ok=retirada) e o marcador do envio', async () => {
    s.retirar.mockResolvedValue(undefined);
    expect(await url(retirarAction(ID, '2026-11'))).toMatch(/^\/painel\/agenda\/aniversariantes\?mes=2026-11&ok=retirada&envio=\d+$/);
    expect(s.retirar).toHaveBeenCalledWith(expect.objectContaining({ role: 'nutri' }), ID);
    expect(s.revalidados).toContain('/painel/agenda/aniversariantes');
  });

  it('M5: paciente que não existe nesta sessão → volta à lista sem o "Autorização retirada."; outro erro sobe', async () => {
    s.retirar.mockRejectedValue(new PacienteNaoEncontradoError());
    expect(await url(retirarAction(ID, '2026-11'))).toMatch(/^\/painel\/agenda\/aniversariantes\?mes=2026-11&envio=\d+$/);
    s.retirar.mockRejectedValue(new Error('conexão caiu'));
    expect(await url(retirarAction(ID, 'x'))).toBe('');
    // o mês inválido não vai para a URL
    s.retirar.mockResolvedValue(undefined);
    expect(await url(retirarAction(ID, '../x'))).toMatch(/^\/painel\/agenda\/aniversariantes\?ok=retirada&envio=\d+$/);
  });

  it('"Registrar autorização": sem a confirmação → "Confirme que o paciente autorizou." sem gravar; paciente que não existe → erro no diálogo', async () => {
    const fd = new FormData();
    fd.set('forma', 'escrito');
    expect(await registrarAction(ID, '2026-11', {}, fd)).toEqual({ erro: 'Confirme que o paciente autorizou.' });
    expect(s.registrar).not.toHaveBeenCalled();
    fd.set('confirmo', 'on');
    s.registrar.mockRejectedValue(new PacienteNaoEncontradoError());
    expect(await registrarAction(ID, '2026-11', {}, fd)).toEqual({ erro: 'Só paciente ativo pode autorizar mensagens de aniversário.' });
    s.registrar.mockResolvedValue(undefined);
    expect(await url(registrarAction(ID, '2026-11', {}, fd))).toMatch(/ok=autorizada&envio=\d+$/);
    expect(s.registrar).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'nutri' }), ID, 'escrito');
  });
});
