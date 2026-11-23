'use client';

import { useEffect, type ReactNode } from 'react';
import { Aviso } from '@/components/ui/aviso';
import { focarTitulo } from '../foco';

/**
 * O erro de um download de Relatórios que volta por redirect (`?erro=origem`, US-306): a página chega do zero, no topo, e
 * um `role="alert"` que já nasce com o texto não é anunciado. Como no `Mensagens` do Financeiro (a região montada com o
 * texto e o foco levado por script), na montagem o foco vai para `controle` — o botão ou o link que causou o erro, que leva
 * `aria-describedby` para este alerta (`id`): o leitor de tela lê o nome do controle e a mensagem, e a página rola até ele.
 */
export function AlertaDoCsv({ id, controle, children }: { id: string; controle: string; children: ReactNode }) {
  useEffect(() => {
    focarTitulo([controle]);
  }, [controle]);
  return (
    <div id={id} className="max-w-2xl">
      <Aviso tipo="erro">{children}</Aviso>
    </div>
  );
}
