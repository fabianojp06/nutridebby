import { describe, expect, it, vi } from 'vitest';

// só a regra pura do progresso local; a ação de servidor não é exercitada aqui
vi.mock('../preferencias/actions', () => ({ marcarGuiaAction: vi.fn() }));
const { aplicarMarca } = await import('./guia-do-painel');

describe('aplicarMarca (progresso local do GuiaDoPainel)', () => {
  it('concluir grava; "visto" depois não rebaixa; versão nova volta a valer', () => {
    const a = aplicarMarca({}, 'pacientes', 1, 'concluido');
    expect(a).toEqual({ pacientes: { v: 1, estado: 'concluido' } });
    expect(aplicarMarca(a, 'pacientes', 1, 'visto')).toBe(a);
    const b = aplicarMarca(a, 'pacientes', 2, 'visto');
    expect(b).toEqual({ pacientes: { v: 2, estado: 'visto' } });
    expect(aplicarMarca(b, 'pacientes', 1, 'concluido')).toBe(b); // versão menor não sobrescreve
  });
});
