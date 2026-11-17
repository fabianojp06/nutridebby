import { beforeEach, describe, expect, it, vi } from 'vitest';

// Eu › Lembretes (Plano 17, Tarefa 6): só a costura (sessão, recusa, retorno). As regras de desligarMeuLembrete e
// pausarMeusLembretes (RLS, gatilho do banco) têm os testes delas em src/modules/lembretes/paciente.test.ts, contra o Postgres.
const s = vi.hoisted(() => ({
  ctx: { tenantId: 't1', role: 'paciente', patientId: 'p1', actorUserId: 'u1' } as Record<string, unknown>,
  desligar: vi.fn(),
  pausar: vi.fn(),
  revalidados: [] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async (caminho: string) => (caminho === '/p/perfil/lembretes' ? { ctx: s.ctx } : null) }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => void s.revalidados.push(p) }));
vi.mock('@/modules/lembretes/paciente', async (orig) => ({
  ...(await orig<typeof import('@/modules/lembretes/paciente')>()),
  desligarMeuLembrete: s.desligar,
  pausarMeusLembretes: s.pausar,
}));
const { LembreteDoPacienteError, MSG_LEMBRETES_PACIENTE } = await import('@/modules/lembretes/paciente');
const { desligarLembreteAction, pausarLembretesAction } = await import('./actions');

const ID = '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';

beforeEach(() => {
  s.desligar.mockReset();
  s.pausar.mockReset();
  s.revalidados = [];
});

describe('desligarLembreteAction (interruptor de cada lembrete)', () => {
  it('desliga e religa pela sessão do paciente, com a frase da região de status, e recarrega a tela', async () => {
    expect(await desligarLembreteAction(ID, true)).toEqual({ ok: 'Lembrete desligado.' });
    expect(s.desligar).toHaveBeenLastCalledWith(s.ctx, ID, true);
    expect(await desligarLembreteAction(ID, false)).toEqual({ ok: 'Lembrete ligado.' });
    expect(s.desligar).toHaveBeenLastCalledWith(s.ctx, ID, false);
    expect(s.revalidados).toEqual(['/p/perfil/lembretes', '/p/perfil/lembretes']);
  });

  it('vindo do cliente: só o booleano verdadeiro desliga', async () => {
    await desligarLembreteAction(ID, 'true' as never);
    expect(s.desligar).toHaveBeenLastCalledWith(s.ctx, ID, false);
  });

  it('recusa o id de outro paciente (o módulo não acha o lembrete pela RLS): a mensagem, sem recarregar', async () => {
    s.desligar.mockRejectedValue(new LembreteDoPacienteError());
    expect(await desligarLembreteAction(ID, true)).toEqual({ erro: MSG_LEMBRETES_PACIENTE.naoEncontrado });
    expect(MSG_LEMBRETES_PACIENTE.naoEncontrado).toBe('Lembrete não encontrado. Recarregue a página.');
    expect(s.revalidados).toEqual([]);
  });

  it('outro erro sobe (vira o error.tsx do portal ou o alerta do interruptor)', async () => {
    s.desligar.mockRejectedValue(new Error('banco fora'));
    await expect(desligarLembreteAction(ID, true)).rejects.toThrow('banco fora');
  });
});

describe('pausarLembretesAction ("Pausar todos os lembretes" / "Retomar os lembretes")', () => {
  it('pausa e retoma pela sessão do paciente, com a frase da região de status', async () => {
    expect(await pausarLembretesAction(true)).toEqual({ ok: 'Lembretes pausados.' });
    expect(s.pausar).toHaveBeenLastCalledWith(s.ctx, true);
    expect(await pausarLembretesAction(false)).toEqual({ ok: 'Lembretes retomados.' });
    expect(s.pausar).toHaveBeenLastCalledWith(s.ctx, false);
    await pausarLembretesAction(1 as never);
    expect(s.pausar).toHaveBeenLastCalledWith(s.ctx, false);
    expect(s.revalidados).toContain('/p/perfil/lembretes');
  });
});
