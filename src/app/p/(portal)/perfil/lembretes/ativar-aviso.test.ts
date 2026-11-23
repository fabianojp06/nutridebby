import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NotificacoesNoEstado as Real } from '../../../notificacoes';

// O efeito da detecção não roda na renderização do servidor: AtivarNotificacoes vira o NotificacoesNoEstado de verdade
// no estado pedido, com as props que AtivarAviso passa (a detecção em si está em notificacoes.test.ts).
type Estado = Parameters<typeof Real>[0]['estado'];
const estado = vi.hoisted(() => ({ atual: 'carregando' as string }));
vi.mock('../../../notificacoes', async (orig) => {
  const real = await orig<typeof import('../../../notificacoes')>();
  return {
    ...real,
    AtivarNotificacoes: (p: Parameters<typeof real.AtivarNotificacoes>[0]) =>
      createElement(real.NotificacoesNoEstado, { ...p, estado: estado.atual as Estado, agiu: false, recusa: null, aoAtivar: () => {} }),
  };
});
const { AtivarAviso, MSG_NOTIFICACOES_BLOQUEADAS } = await import('./ativar-aviso');

const montar = (e: Estado) => {
  estado.atual = e;
  return renderToStaticMarkup(createElement(AtivarAviso, { chavePublica: 'chave', dono: 'p1' }));
};

describe('Eu › Lembretes: notificações bloqueadas no aparelho (TRI-17-20 #47, T6-N2)', () => {
  it('"negado" (Notification.permission = denied): o aviso de que os lembretes não chegam e como liberar, sem região de alerta', () => {
    const html = montar('negado');
    expect(MSG_NOTIFICACOES_BLOQUEADAS).toBe(
      'As notificações estão bloqueadas neste aparelho, por isso os lembretes não chegam. Para receber, libere as notificações deste app nas configurações do navegador ou do celular.',
    );
    expect(html).toBe(`<p class="rounded-2xl border border-aviso bg-aviso-fundo p-3 font-semibold text-aviso">${MSG_NOTIFICACOES_BLOQUEADAS}</p>`);
    expect(html).not.toMatch(/role="alert"|aria-live/);
  });

  it('"pode" (default, ou granted sem inscrição desta conta): o cartão de ativar, sem o aviso', () => {
    const html = montar('pode');
    expect(html).toContain('Ative as notificações para receber os lembretes da sua nutricionista.');
    expect(html).toMatch(/<button[^>]*>Ativar notificações<\/button>/);
    expect(html).not.toContain(MSG_NOTIFICACOES_BLOQUEADAS);
  });

  it.each(['ativo', 'indisponivel', 'carregando'] as const)('"%s": nada (nem o aviso)', (e) => {
    expect(montar(e)).toBe('');
  });
});
