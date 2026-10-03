'use client';
import { useEffect } from 'react';
import { sincronizarAparelho } from './notificacoes';

/**
 * D9: registra o acesso do dia (CS-02) e renova o cookie de sessão (P06-11) uma vez por carga do portal e dono (o layout
 * persiste entre as abas). Review Focus 4: a inscrição de push que o navegador já tem troca de dono aqui, em qualquer
 * página do portal (não só no Início).
 */
export function RegistrarAcesso({ dono }: { dono: string }) {
  useEffect(() => {
    void fetch('/api/p/acesso', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
    void sincronizarAparelho(dono);
  }, [dono]);
  return null;
}
