import { describe, expect, it } from 'vitest';
import { linkDaRecusa, recusaDoPortal } from './recusa-api';

describe('recusaDoPortal (recusas { erro } de requireApiPaciente)', () => {
  it('401: a mensagem do servidor e o login voltando para a tela', () => {
    expect(recusaDoPortal(401, { erro: 'Sessão expirada. Entre de novo.' }, '/p/diario')).toEqual({
      mensagem: 'Sessão expirada. Entre de novo.',
      entrar: '/entrar?volta=%2Fp%2Fdiario',
      escolher: null,
    });
    // corpo perdido: ainda é sessão expirada
    expect(recusaDoPortal(401, null, '/p/inicio')).toEqual({ mensagem: 'Sessão expirada. Entre de novo.', entrar: '/entrar?volta=%2Fp%2Finicio', escolher: null });
  });

  it('403: a mensagem do servidor (termo, consultório indisponível), sem login', () => {
    expect(recusaDoPortal(403, { erro: 'Para continuar, aceite o Termo de Uso e Privacidade.' }, '/p/diario')).toEqual({
      mensagem: 'Para continuar, aceite o Termo de Uso e Privacidade.',
      entrar: null,
      escolher: null,
    });
    expect(recusaDoPortal(403, { erro: 'Conta temporariamente indisponível' }, '/p/diario')?.mensagem).toBe('Conta temporariamente indisponível');
  });

  it('o resto (erros de campo, 403 sem `erro`, 5xx) fica com a tela; volta insegura não vira ?volta', () => {
    expect(recusaDoPortal(400, { erros: { texto: 'x' } }, '/p/diario')).toBeNull();
    expect(recusaDoPortal(403, { erros: { geral: 'Acesso negado' } }, '/p/diario')).toBeNull();
    expect(recusaDoPortal(500, { erro: 'x' }, '/p/diario')).toBeNull();
    expect(recusaDoPortal(401, {}, '//evil.example')?.entrar).toBe('/entrar');
  });

  it('S-4: 403 de vínculo a escolher (motivo "escolher") → link da escolha voltando para a tela; o motivo só vale no 403', () => {
    expect(recusaDoPortal(403, { erro: 'Acesso negado', motivo: 'escolher' }, '/p/diario')).toEqual({
      mensagem: 'Acesso negado',
      entrar: null,
      escolher: '/p/escolher?volta=%2Fp%2Fdiario',
    });
    expect(recusaDoPortal(403, { erro: 'Acesso negado', motivo: 'escolher' }, '//evil.example')?.escolher).toBe('/p/escolher');
    expect(recusaDoPortal(403, { erro: 'Acesso negado' }, '/p/diario')?.escolher).toBeNull(); // sem vínculo nenhum: nada a escolher
    expect(recusaDoPortal(401, { erro: 'Sessão expirada. Entre de novo.', motivo: 'escolher' }, '/p/diario')?.escolher).toBeNull();
  });

  it('linkDaRecusa: "Entrar" no 401, "Escolher nutricionista" no 403 de escolha; nenhum nos outros', () => {
    expect(linkDaRecusa(recusaDoPortal(401, null, '/p/diario'))).toEqual({ href: '/entrar?volta=%2Fp%2Fdiario', texto: 'Entrar' });
    expect(linkDaRecusa(recusaDoPortal(403, { erro: 'Acesso negado', motivo: 'escolher' }, '/p/perfil'))).toEqual({
      href: '/p/escolher?volta=%2Fp%2Fperfil',
      texto: 'Escolher nutricionista',
    });
    expect(linkDaRecusa(recusaDoPortal(403, { erro: 'Conta temporariamente indisponível' }, '/p/diario'))).toBeNull();
    expect(linkDaRecusa(null)).toBeNull();
  });
});
