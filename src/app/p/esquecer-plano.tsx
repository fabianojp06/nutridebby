'use client';
import { useEffect } from 'react';
import { esquecerPlanoGuardado, esquecerPlanoGuardadoForaDe } from '../sw-regras';
import { esquecerComprasDoAparelho, esquecerComprasForaDe } from './(portal)/compras/marcacao';

/**
 * Sem acesso ao portal (RN-08: exclusão atendida, arquivado, anonimizado) ou consultório suspenso (RN-15), com a sessão
 * ainda válida: a cópia offline de "Meu plano" e as marcações da lista de compras saem do aparelho (LGPD: minimização) —
 * como no /entrar e no "Sair". O layout do portal redireciona antes do DonoDoAparelho, então nada mais as apagaria.
 * `manter` (/p/escolher): os vínculos que a conta ainda pode escolher — a cópia e as marcações deles ficam; só sai o que é
 * de outro dono (consultório suspenso, vínculo sem acesso, outra conta).
 */
export function EsquecerPlanoGuardado({ manter }: { manter?: readonly string[] }) {
  const chave = manter?.join(',');
  useEffect(() => {
    const lista = chave === undefined ? undefined : chave.split(',').filter(Boolean);
    if (lista) {
      void esquecerPlanoGuardadoForaDe(lista);
      esquecerComprasForaDe(lista);
      return;
    }
    void esquecerPlanoGuardado();
    esquecerComprasDoAparelho();
  }, [chave]);
  return null;
}
