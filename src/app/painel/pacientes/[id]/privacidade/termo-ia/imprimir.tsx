'use client';

import { Botao } from '@/components/ui/botao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';

/** US-108 "Imprimir termo": o diálogo de impressão do navegador (a página esconde o resto na impressão). */
export function Imprimir() {
  return (
    <Botao type="button" className="print:hidden" onClick={() => window.print()}>
      {MSG_AUTORIZACAO.imprimir}
    </Botao>
  );
}
