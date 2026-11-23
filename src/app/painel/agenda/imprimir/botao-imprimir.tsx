'use client';

import { Botao } from '@/components/ui/botao';
import { MSG_VISOES } from '@/modules/agenda/constantes';

/** US-406: "Imprimir ou salvar em PDF" abre o diálogo de impressão do navegador (a página esconde o resto na impressão). */
export function BotaoImprimir() {
  return (
    <Botao type="button" className="print:hidden" onClick={() => window.print()}>
      {MSG_VISOES.imprimir}
    </Botao>
  );
}
