import { notFound, redirect } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';
import { MSG_LEMBRETES } from '@/modules/lembretes/constantes';

vi.mock('./actions', () => ({ desligarLembreteAction: vi.fn(), pausarLembretesAction: vi.fn() }));
const { chamar } = await import('./interruptor');

describe('interruptor do portal: a action que lança (PR #66)', () => {
  it('falha de rede vira { erro }; o redirect e o notFound() da action seguem o caminho do Next', async () => {
    expect(await chamar(() => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ erro: MSG_LEMBRETES.falhou });
    expect(await chamar(async () => ({ ok: 'Lembrete desligado.' }))).toEqual({ ok: 'Lembrete desligado.' });
    for (const lanca of [() => redirect('/entrar'), () => notFound()]) {
      let erro: unknown;
      try {
        lanca();
      } catch (e) {
        erro = e;
      }
      await expect(chamar(() => Promise.reject(erro))).rejects.toBe(erro);
    }
  });
});
