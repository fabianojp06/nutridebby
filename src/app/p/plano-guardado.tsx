'use client';
import { useEffect } from 'react';
import type { MensagemAoSw } from '../sw-regras';
import { conferirDonoDasCompras } from './(portal)/compras/marcacao';

const avisar = (m: MensagemAoSw) => {
  if (!('serviceWorker' in navigator)) return;
  // `ready.active`, não `controller`: na primeira visita a página ainda não é controlada e o pedido não pode se perder
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(m)).catch(() => undefined);
};

/** Layout do portal: a cópia guardada (e as marcações "comprado") é de outra conta ou de outro vínculo? Sai (Review Focus 4). */
export function DonoDoAparelho({ dono }: { dono: string }) {
  useEffect(() => {
    conferirDonoDasCompras(dono);
    avisar({ tipo: 'dono', dono });
  }, [dono]);
  return null;
}

/** "Meu plano" exibida (pelo menu, por atalho ou recarga): o service worker guarda esta versão para esta conta (D6). */
export function GuardarPlano({ dono, versao }: { dono: string; versao: string }) {
  useEffect(() => avisar({ tipo: 'plano', dono, versao }), [dono, versao]);
  return null;
}
