'use client';
import { useEffect } from 'react';
import { esquecerPlanoGuardado } from '../sw-regras';
import { esquecerComprasDoAparelho } from './(portal)/compras/marcacao';

/**
 * Sem acesso ao portal (RN-08: exclusão atendida, arquivado, anonimizado) ou consultório suspenso (RN-15), com a sessão
 * ainda válida: a cópia offline de "Meu plano" e as marcações da lista de compras saem do aparelho (LGPD: minimização) —
 * como no /entrar e no "Sair". O layout do portal redireciona antes do DonoDoAparelho, então nada mais as apagaria.
 */
export function EsquecerPlanoGuardado() {
  useEffect(() => {
    void esquecerPlanoGuardado();
    esquecerComprasDoAparelho();
  }, []);
  return null;
}
