import { describe, expect, it } from 'vitest';
import { recusaDoPortal } from './recusa-api';

describe('recusaDoPortal (recusas { erro } de requireApiPaciente)', () => {
  it('401: a mensagem do servidor e o login voltando para a tela', () => {
    expect(recusaDoPortal(401, { erro: 'Sessão expirada. Entre de novo.' }, '/p/diario')).toEqual({
      mensagem: 'Sessão expirada. Entre de novo.',
      entrar: '/entrar?volta=%2Fp%2Fdiario',
    });
    // corpo perdido: ainda é sessão expirada
    expect(recusaDoPortal(401, null, '/p/inicio')).toEqual({ mensagem: 'Sessão expirada. Entre de novo.', entrar: '/entrar?volta=%2Fp%2Finicio' });
  });

  it('403: a mensagem do servidor (termo, consultório indisponível), sem login', () => {
    expect(recusaDoPortal(403, { erro: 'Para continuar, aceite o Termo de Uso e Privacidade.' }, '/p/diario')).toEqual({
      mensagem: 'Para continuar, aceite o Termo de Uso e Privacidade.',
      entrar: null,
    });
    expect(recusaDoPortal(403, { erro: 'Conta temporariamente indisponível' }, '/p/diario')?.mensagem).toBe('Conta temporariamente indisponível');
  });

  it('o resto (erros de campo, 403 sem `erro`, 5xx) fica com a tela; volta insegura não vira ?volta', () => {
    expect(recusaDoPortal(400, { erros: { texto: 'x' } }, '/p/diario')).toBeNull();
    expect(recusaDoPortal(403, { erros: { geral: 'Acesso negado' } }, '/p/diario')).toBeNull();
    expect(recusaDoPortal(500, { erro: 'x' }, '/p/diario')).toBeNull();
    expect(recusaDoPortal(401, {}, '//evil.example')?.entrar).toBe('/entrar');
  });
});
